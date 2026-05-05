"use client";

import Link from "next/link";
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight, Check, Copy, Ellipsis, Mic, Pencil, Trash2 } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import VoiceInput from "@/components/ui/VoiceInput";
import Toast from "@/components/ui/Toast";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTranslation } from "@/lib/i18n";
import {
  useFlatConversations,
  useConversationMessages,
  useFlatMessages,
  useCreateConversation,
  useSendMessage,
  useDeleteConversation,
  useDuplicateConversation,
  useRenameConversation,
  useIndexedFiles,
  useUploadFile,
  useDeleteFile,
  useOllamaModels,
  useHasActiveProvider,
  useModelConfig,
  useUpdateModelConfig,
  useProviders,
  useWhisperHealth,
  useWhisperModels,
  useEmbeddingModelsStatus,
  OPTIMISTIC_PREFIX,
  type ChatMessage,
  type EmbeddingModelsStatus,
} from "@/hooks/use-chat";
import { useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useDownload } from "@/lib/download-provider";
function modelNameBase(name: string): string {
  return name.split(":")[0].trim().toLowerCase();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupByDate(
  items: { id: number; title: string; created_at: string }[],
): { label: string; items: { id: number; title: string; created_at: string }[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: Record<string, { id: number; title: string; created_at: string }[]> = {};

  for (const item of items) {
    const d = new Date(item.created_at);
    const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label: string;
    if (itemDate >= today) label = "today";
    else if (itemDate >= yesterday) label = "yesterday";
    else label = "older";

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  const result: { label: string; items: typeof items }[] = [];
  if (groups["today"]?.length) result.push({ label: "today", items: groups["today"] });
  if (groups["yesterday"]?.length) result.push({ label: "yesterday", items: groups["yesterday"] });
  if (groups["older"]?.length) result.push({ label: "older", items: groups["older"] });
  return result;
}

function parseSources(sources: string[] | null): string[] {
  let list: string[] = [];
  if (!sources) return list;
  if (Array.isArray(sources)) {
    list = sources;
  } else {
    try {
      const parsed = JSON.parse(sources as unknown as string);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  // Deduplicate sources
  return [...new Set(list)];
}

export default function ChatClient() {
  const { t, locale } = useTranslation();
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [whisperAlert, setWhisperAlert] = useState(false);
  const [showWhisperPullModal, setShowWhisperPullModal] = useState(false);
  const [whisperPullName, setWhisperPullName] = useState("");
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [modelOverlayOpen, setModelOverlayOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [showFileMention, setShowFileMention] = useState(false);
  const [fileMentionQuery, setFileMentionQuery] = useState("");
  const [taggedFile, setTaggedFile] = useState<{ id: string; name: string } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeTurnRef = useRef<{ turnId: string; conversationId: number } | null>(null);
  // Per-chat unsent drafts. Key is the conversation id as string, or "__new__" for
  // the new-chat/empty-state input. Kept in a ref because draft values do not need
  // to trigger re-renders — they're read/written only on chat switch.
  const draftsRef = useRef<Record<string, string>>({});
  const prevChatIdRef = useRef<number | null>(null);
  const DRAFT_NEW_KEY = "__new__";
  const draftKey = (id: number | null) => (id === null ? DRAFT_NEW_KEY : String(id));

  // API hooks
  const queryClient = useQueryClient();
  const { conversations, isLoading: convLoading, hasNextPage: hasMoreConvs, fetchNextPage: fetchMoreConvs, isFetchingNextPage: isFetchingMoreConvs } = useFlatConversations();
  const { messages, isLoading: msgsLoading, hasNextPage: hasOlderMsgs, fetchNextPage: fetchOlderMsgs, isFetchingNextPage: isFetchingOlderMsgs } = useFlatMessages(activeChatId);
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const [copiedMessageId, setCopiedMessageId] = useState<string | number | null>(null);
  const deleteConversation = useDeleteConversation();
  const duplicateConversation = useDuplicateConversation();
  const renameConversation = useRenameConversation();
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);
  const { data: indexedFiles = [], isLoading: filesLoading } = useIndexedFiles();
  const uploadFile = useUploadFile();
  const deleteFile = useDeleteFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: ollamaModels = [], isLoading: modelsLoading } = useOllamaModels();
  const { active: hasActiveProvider, isLoading: providerLoading } = useHasActiveProvider();
  const { data: modelConfig } = useModelConfig();
  const updateModelConfig = useUpdateModelConfig();
  const { data: providers = [] } = useProviders();
  const { data: whisperHealth } = useWhisperHealth();
  const { data: whisperModels = [] } = useWhisperModels();
  const { download, isPulling, startPull, whisperDownload, isWhisperPulling, startWhisperPull } = useDownload();
  const { data: embeddingModelsStatus } = useEmbeddingModelsStatus();
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullInput, setPullInput] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [embeddingChoice, setEmbeddingChoice] = useState("nomic-embed-text");
  const [embeddingModalError, setEmbeddingModalError] = useState<string | null>(null);
  const [embeddingBusy, setEmbeddingBusy] = useState(false);
  const [embeddingStatusSnapshot, setEmbeddingStatusSnapshot] =
    useState<EmbeddingModelsStatus | null>(null);
  // Track that we started an embedding pull so the completion effect knows to finish up
  const embeddingPullPendingRef = useRef<{ model: string; file: File | null } | null>(null);

  const processFileForUpload = useCallback(
    async (file: File) => {
      const res = await apiGet<EmbeddingModelsStatus>("/api/chat/embedding-models/");
      if (!res.ok || !res.data) {
        uploadFile.mutate(file);
        return;
      }
      if (res.data.installed) {
        uploadFile.mutate(file);
        return;
      }
      setEmbeddingStatusSnapshot(res.data);
      const fallback =
        res.data.recommended[0] || res.data.configured_embedding_model || "nomic-embed-text";
      const initial =
        (modelConfig?.embedding_model || "").trim() || res.data.configured_embedding_model || fallback;
      setEmbeddingChoice(modelNameBase(initial));
      setEmbeddingModalError(null);
      setPendingPdfFile(file);
      setEmbeddingModalOpen(true);
    },
    [modelConfig?.embedding_model, uploadFile],
  );

  const embeddingChoices = useMemo(() => {
    const s = embeddingStatusSnapshot;
    if (!s) return [];
    const seen = new Set<string>();
    const out: { label: string; value: string; installed: boolean; recommended: boolean }[] = [];
    for (const m of s.installed_embedding_models) {
      const b = modelNameBase(m.name);
      if (seen.has(b)) continue;
      seen.add(b);
      out.push({ label: m.name, value: b, installed: true, recommended: false });
    }
    let isFirst = true;
    for (const r of s.recommended) {
      const b = modelNameBase(r);
      if (seen.has(b)) continue;
      seen.add(b);
      out.push({ label: r, value: b, installed: false, recommended: isFirst });
      isFirst = false;
    }
    return out;
  }, [embeddingStatusSnapshot]);

  const handleEmbeddingModalContinue = async () => {
    setEmbeddingModalError(null);
    const status = embeddingStatusSnapshot;
    const base = embeddingChoice.trim().toLowerCase();
    const installedBases = new Set(
      (status?.installed_embedding_models ?? []).map((m) => modelNameBase(m.name)),
    );
    if (!installedBases.has(base)) {
      // Use global startPull so progress shows on Model Engines page too
      embeddingPullPendingRef.current = { model: base, file: pendingPdfFile };
      setEmbeddingBusy(true);
      startPull(base);
      return;
    }
    // Already installed — just save config and upload
    setEmbeddingBusy(true);
    try {
      const ollamaProvider = providers.find((p) => p.name === "Ollama");
      await updateModelConfig.mutateAsync({
        embedding_model: base,
        embedding_provider_id: ollamaProvider?.id ?? null,
      });
      const file = pendingPdfFile;
      setEmbeddingModalOpen(false);
      setPendingPdfFile(null);
      setEmbeddingStatusSnapshot(null);
      if (file) {
        uploadFile.mutate(file);
      }
    } catch (err) {
      setEmbeddingModalError(err instanceof Error ? err.message : "Failed to prepare embedding model.");
    } finally {
      setEmbeddingBusy(false);
    }
  };

  // When a global embedding pull finishes, save config + upload file
  const wasEmbeddingPulling = useRef(false);
  useEffect(() => {
    if (isPulling && embeddingPullPendingRef.current) {
      wasEmbeddingPulling.current = true;
    } else if (!isPulling && wasEmbeddingPulling.current && embeddingPullPendingRef.current) {
      wasEmbeddingPulling.current = false;
      const { model, file } = embeddingPullPendingRef.current;
      embeddingPullPendingRef.current = null;
      // Save config and upload
      (async () => {
        try {
          const ollamaProvider = providers.find((p) => p.name === "Ollama");
          await updateModelConfig.mutateAsync({
            embedding_model: model,
            embedding_provider_id: ollamaProvider?.id ?? null,
          });
          setEmbeddingModalOpen(false);
          setPendingPdfFile(null);
          setEmbeddingStatusSnapshot(null);
          if (file) {
            uploadFile.mutate(file);
          }
        } catch (err) {
          setEmbeddingModalError(err instanceof Error ? err.message : "Failed to save config.");
        } finally {
          setEmbeddingBusy(false);
        }
      })();
    }
  }, [isPulling, providers, updateModelConfig, uploadFile]);

  // `isSwitchingRef` is set to true just before `setActiveChatId` inside
  // handleSend so the ambient chat-switch cleanup effect doesn't nuke the
  // newly-inserted optimistic bubbles. No-op unless that flag is set.
  const isSwitchingRef = useRef(false);
  useEffect(() => {
    if (isSwitchingRef.current) {
      isSwitchingRef.current = false;
    }
  }, [activeChatId]);

  // Auto-close whisper pull modal only when a pull transitions from active → done
  const wasWhisperPulling = useRef(false);
  useEffect(() => {
    if (isWhisperPulling) {
      wasWhisperPulling.current = true;
    } else if (wasWhisperPulling.current) {
      wasWhisperPulling.current = false;
      if (whisperAlert) setWhisperAlert(false);
      if (showWhisperPullModal) {
        setShowWhisperPullModal(false);
        setWhisperPullName("");
        setVoiceOpen(true);
      }
    }
  }, [isWhisperPulling, whisperAlert, showWhisperPullModal]);

  // Auto-select first available model
  useEffect(() => {
    if (!selectedModel && ollamaModels.length > 0) {
      setSelectedModel(ollamaModels[0].id);
    }
  }, [selectedModel, ollamaModels]);

  function validateModelName(name: string): string | null {
    if (!name) return t("modelEngines.modelNameRequired");
    if (name.length > 200) return t("modelEngines.modelNameTooLong");
    const pattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\/[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)?(:[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
    if (!pattern.test(name)) return t("modelEngines.invalidModelName");
    return null;
  }

  async function handlePullModel() {
    const name = pullInput.trim();
    if (!name || isPulling || isValidating) return;

    const error = validateModelName(name);
    if (error) {
      setPullError(error);
      return;
    }

    const nameWithTag = name.includes(":") ? name : `${name}:latest`;
    const nameWithoutTag = name.split(":")[0];
    const alreadyExists = ollamaModels.some(
      (m) => m.name === name || m.name === nameWithTag || m.name === nameWithoutTag || m.name.split(":")[0] === nameWithoutTag,
    );
    if (alreadyExists) {
      setPullError(t("modelEngines.modelAlreadyExists"));
      return;
    }

    setIsValidating(true);
    setPullError(null);
    try {
      const res = await fetch(`/api/models/validate?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`Validation failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.valid) {
        setPullError(data.error || t("modelEngines.modelNotFound"));
        return;
      }
    } catch {
      // If validation endpoint is unreachable, proceed anyway
    } finally {
      setIsValidating(false);
    }

    setShowPullModal(false);
    setPullInput("");
    setPullError(null);
    startPull(name);
  }

  // Note: we intentionally do NOT auto-select the first conversation. Opening the
  // Chat page should land the user in a fresh "new chat" state (activeChatId = null)
  // so they see the empty UI and can either type a message or click an existing
  // conversation in the sidebar.

  // Save/restore unsent input drafts when the active conversation changes.
  useEffect(() => {
    const prev = prevChatIdRef.current;
    const next = activeChatId;
    if (prev === next) return;
    // Save the current editor value under the previous chat's key.
    draftsRef.current[draftKey(prev)] = input;
    // Restore the draft (if any) for the new chat; fall back to empty.
    setInput(draftsRef.current[draftKey(next)] ?? "");
    prevChatIdRef.current = next;
    // Clearing the @mention state avoids stale autocomplete leaking across chats.
    setShowFileMention(false);
    setFileMentionQuery("");
    setTaggedFile(null);
    // We intentionally only depend on activeChatId: `input` is captured fresh at the
    // moment activeChatId changes, and we don't want this effect to fire on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle input changes for @file autocomplete
  function handleInputChange(value: string) {
    setInput(value);
    const atMatch = value.match(/@(\S*)$/);
    if (atMatch) {
      setShowFileMention(true);
      setFileMentionQuery(atMatch[1].toLowerCase());
    } else {
      setShowFileMention(false);
      setFileMentionQuery("");
    }
  }

  // Select a file from autocomplete → set as tag chip
  function insertFileMention(file: { id: string; name: string }) {
    setTaggedFile(file);
    setInput(input.replace(/@\S*$/, ""));
    setShowFileMention(false);
    setFileMentionQuery("");
  }

  // Filtered file list for autocomplete
  const mentionFiles = indexedFiles.filter((f) =>
    f.name.toLowerCase().includes(fileMentionQuery),
  );

  async function handleSend(textOverride?: string) {
    // Voice transcription path passes text directly because setInput() is async
    // and we can't rely on the input state being updated before this runs.
    const text = (textOverride ?? input).trim();
    if (!text) return;

    let chatId = activeChatId;

    // If no active conversation, create one first.
    if (!chatId) {
      try {
        const conv = await createConversation.mutateAsync(undefined);
        chatId = conv.id;
        isSwitchingRef.current = true;
        setActiveChatId(chatId);
      } catch {
        return;
      }
    }

    const fileFilter = taggedFile?.name;
    const displayText = taggedFile ? `@${taggedFile.name} ${text}` : text;

    setInput("");
    setTaggedFile(null);
    setShowFileMention(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const turnId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeTurnRef.current = { turnId, conversationId: chatId };

    sendMessage.mutate(
      {
        conversationId: chatId,
        content: text,
        displayContent: displayText,
        model: selectedModel || undefined,
        signal: controller.signal,
        file_filter: fileFilter,
        turn_id: turnId,
      },
      {
        onSettled: () => {
          abortControllerRef.current = null;
          activeTurnRef.current = null;
        },
      },
    );
  }

  function stripOptimisticAssistantFromCache(conversationId: number) {
    // Remove only the in-flight assistant placeholder ("Thinking...") so the
    // user message stays visible. Per UX requirement: hitting Stop must NOT
    // delete the user's message — they can still copy or edit it.
    type InfiniteMessages = { pages: { messages: ChatMessage[]; next_cursor: number | null; has_more: boolean }[]; pageParams: (number | null)[] };
    queryClient.setQueryData<InfiniteMessages>(
      ["chat", "messages", conversationId],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.filter(
              (m) =>
                !(
                  m.role === "assistant" &&
                  typeof m.id === "string" &&
                  (m.id as unknown as string).startsWith(OPTIMISTIC_PREFIX)
                ),
            ),
          })),
        };
      },
    );
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Intentionally do NOT delete the turn — preserve the user's message so
    // they can edit/copy it. We just drop the optimistic "Thinking..." bubble.
    const active = activeTurnRef.current;
    if (active) {
      stripOptimisticAssistantFromCache(active.conversationId);
      activeTurnRef.current = null;
    }
  }

  async function handleCopyMessage(id: string | number, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId((current) => (current === id ? null : current)), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; silently ignore.
    }
  }

  function handleEditMessage(content: string) {
    setInput(content);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showFileMention) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFileMention(false);
        return;
      }
      // Don't send while autocomplete is visible on Enter
      if (e.key === "Enter") {
        e.preventDefault();
        // Select first matching file
        if (mentionFiles.length > 0) {
          insertFileMention(mentionFiles[0]);
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleNewChat() {
    // Lazy creation: no API call here; a conversation is only created in
    // handleSend when the user actually submits their first message. This
    // prevents empty "Untitled" chats from cluttering the sidebar when the
    // user clicks New Chat but never sends anything.

    // Abort any in-flight request from the previous chat. We do NOT call
    // deleteTurn here — the user only asked to start a new chat, not to
    // throw away the message they already sent. The backend will finish
    // persisting, and the full conversation will be visible on return.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeTurnRef.current) {
      // Drop only the optimistic "Thinking..." assistant bubble; keep the
      // user message so they can return and copy/edit it.
      stripOptimisticAssistantFromCache(activeTurnRef.current.conversationId);
      activeTurnRef.current = null;
    }
    setActiveChatId(null);
  }

  function handleDeleteConversation(convId: number) {
    setMenuOpenId(null);
    deleteConversation.mutate(convId, {
      onSuccess: () => {
        if (activeChatId === convId) {
          setActiveChatId(null);
        }
      },
    });
  }

  function handleStartRename(convId: number, currentTitle: string) {
    setMenuOpenId(null);
    setRenamingId(convId);
    setRenameValue(currentTitle);
  }

  function handleSubmitRename(convId: number) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      renameConversation.mutate({ conversationId: convId, title: trimmed });
    }
    setRenamingId(null);
    setRenameValue("");
  }

  function handleDuplicateConversation(convId: number) {
    setMenuOpenId(null);
    if (duplicateConversation.isPending) return;
    showToast(t("chat.duplicating"));
    duplicateConversation.mutate(convId, {
      onSuccess: (conv) => {
        setActiveChatId(conv.id);
        showToast(t("chat.duplicated"));
      },
      onError: () => showToast(t("chat.duplicateError")),
    });
  }

  useKeyboardShortcut({ key: "o", meta: true, shift: true, handler: handleNewChat });

  // Close menu on outside click
  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [menuOpenId]);


  // Group conversations by date
  const grouped = groupByDate(conversations);

  // Single source of truth: the cache already contains the optimistic rows
  // (inserted by `useSendMessage.onMutate`). No separate pending state means
  // no duplicate-bubble race.
  const isSending = sendMessage.isPending;

  function renderMessage(m: { id: string | number; role: string; content: string; sources?: string[] | null; created_at?: string | null }, isPending?: boolean) {
    const isUser = m.role === "user";
    const sourceList = parseSources(m.sources ?? null);
    const isThinking = isPending && m.role === "assistant";
    const wasCopied = copiedMessageId === m.id;

    if (isUser) {
      return (
        <div key={m.id} className="group max-w-[720px] w-full mx-auto flex gap-3 flex-row-reverse animate-[msgIn_0.3s_ease]">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-linear-to-br from-indigo-500 to-indigo-400 text-white font-bold">A</div>
          <div className="flex-1 text-right">
            <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2 justify-end">
              {t("chat.you")} <span className="font-mono text-[0.68rem] text-text-dim font-normal">{m.created_at ? formatTime(m.created_at) : "now"}</span>
            </div>
            <div className={`inline-block text-left px-4 py-3 rounded-xl bg-indigo-500/[0.12] border border-indigo-500/20 rounded-tr-sm ${isPending ? "opacity-70" : ""}`}>
              <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">{m.content}</div>
            </div>
            <div className="flex gap-1 justify-end mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded text-[0.72rem] text-text-dim bg-transparent border border-transparent hover:text-accent hover:border-border cursor-pointer transition-colors"
                title={t("chat.copy")}
                onClick={() => handleCopyMessage(m.id, m.content)}
              >
                {wasCopied ? <Check size={12} /> : <Copy size={12} />}
                {wasCopied ? t("chat.copied") : t("chat.copy")}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded text-[0.72rem] text-text-dim bg-transparent border border-transparent hover:text-accent hover:border-border cursor-pointer transition-colors"
                title={t("chat.edit")}
                onClick={() => handleEditMessage(m.content)}
              >
                <Pencil size={12} />
                {t("chat.edit")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={m.id} className="group max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
        <div className="flex-1">
          <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">
            local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">{m.created_at ? formatTime(m.created_at) : "now"}</span>
          </div>
          <div className={`inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm ${isThinking ? "animate-pulse" : ""}`}>
            <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
              {m.content.split("\n").map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </div>
            {sourceList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {sourceList.map((src, i) => (
                  <span key={i} className="inline-flex items-center gap-1 font-mono text-[0.7rem] text-accent-secondary bg-accent-secondary/[0.08] px-2 py-0.5 rounded">
                    📄 {src}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!isThinking && m.content.length > 0 && (
            <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded text-[0.72rem] text-text-dim bg-transparent border border-transparent hover:text-accent hover:border-border cursor-pointer transition-colors"
                title={t("chat.copy")}
                onClick={() => handleCopyMessage(m.id, m.content)}
              >
                {wasCopied ? <Check size={12} /> : <Copy size={12} />}
                {wasCopied ? t("chat.copied") : t("chat.copy")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show spinner while provider/model state is still loading (prevents flicker)
  if (providerLoading || modelsLoading) {
    return (
      <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Block entire page if no provider or no model — show inside layout with Sidebar
  if (!hasActiveProvider || ollamaModels.length === 0) {
    const noProvider = !hasActiveProvider;
    return (
      <div className="font-body bg-bg text-text h-screen overflow-hidden relative">
        <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

        <div className="flex h-screen">
          <Sidebar activePage="chat" />

          <main className="flex-1 flex items-center justify-center overflow-y-auto relative">
            {/* Ambient glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse,rgba(52,211,153,0.15)_0%,transparent_65%)] pointer-events-none z-0" />

            <div className="relative z-1 w-full max-w-[480px] px-8 text-center animate-[cardIn_0.5s_ease]">
              {/* Icon */}
              <div className="w-[72px] h-[72px] rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center text-3xl mx-auto mb-6 animate-[scaleIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">
                {noProvider ? "\u26A0\uFE0F" : "\uD83E\uDD16"}
              </div>

              {/* Heading */}
              <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">
                {noProvider ? t("modelEngines.noProviderWarning") : t("chat.chooseModel")}
              </h1>
              <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
                {noProvider
                  ? t("modelEngines.noProviderWarningDesc")
                  : t("chat.chooseModelDesc")}
              </p>

              {/* Info cards */}
              <div className="flex flex-col gap-2.5 mb-8">
                {noProvider ? (
                  <>
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">1</div>
                      Go to Model Engines
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">2</div>
                      Connect a provider (e.g. Ollama)
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">3</div>
                      Pull a model and start chatting
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">1</div>
                      Go to Model Engines
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">2</div>
                      Pull a model (e.g. llama3.2, mistral, phi3)
                    </div>
                  </>
                )}
              </div>

              {/* CTA */}
              <Link
                href="/model-engines"
                className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-8 bg-accent text-bg border-none rounded-lg font-body text-base font-semibold no-underline cursor-pointer transition-all duration-200 shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 hover:shadow-[0_0_50px_rgba(52,211,153,0.3)]"
              >
                {t("sidebar.modelEngines")} <ArrowRight size={18} />
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="font-body bg-bg text-text h-screen overflow-hidden relative">
      {/* Noise overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

      <div className="flex h-screen">
        {/* Chat Sidebar */}
        <aside className="w-[260px] bg-bg-elevated border-r border-border flex flex-col shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4 font-mono text-base text-accent no-underline border-b border-border">
            <svg viewBox="0 0 28 28" fill="none" className="w-[22px] h-[22px]">
              <path d="M14 2.5L4 7v7c0 6.1 4.3 11.5 10 13 5.7-1.5 10-6.9 10-13V7L14 2.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="14" cy="11" r="2" fill="currentColor" />
              <circle cx="9" cy="17" r="1.3" fill="currentColor" />
              <circle cx="19" cy="17" r="1.3" fill="currentColor" />
              <circle cx="14" cy="21" r="1.3" fill="currentColor" />
              <path d="M14 13v2.5l-4 2M14 15.5l4 2M9 17l5 4M19 17l-5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-accent">local</span>
            <span className="text-text-dim animate-[cursorBlink_1.2s_step-end_infinite]">-</span>
            <span className="text-accent">ai</span>
            <span className="text-text-dim">.run</span>
          </Link>

          <button
            type="button"
            className="mx-3 mt-3 mb-1 py-2.5 bg-accent/15 border border-dashed border-border-accent rounded-lg text-accent font-body text-[0.88rem] font-medium cursor-pointer transition-all text-center hover:bg-accent/30 hover:border-solid"
            onClick={handleNewChat}
            title={t("chat.newChatShortcut")}
          >
            {t("chat.newChat")}
          </button>

          <div className="flex-1 overflow-y-auto px-2.5">
            {convLoading ? (
              <div className="px-3 py-4 text-[0.82rem] text-text-dim">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="px-3 py-4 text-[0.82rem] text-text-dim text-center">No conversations yet</div>
            ) : (
              grouped.map((group) => (
                <div key={group.label}>
                  <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-2 pt-3 pb-1">
                    {group.label === "today" ? t("chat.today") : group.label === "yesterday" ? t("chat.yesterday") : "Older"}
                  </div>
                  {group.items.map((c) => (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.85rem] cursor-pointer transition-all mb-px ${activeChatId === c.id ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-bg-card hover:text-text"}`}
                      onClick={() => { setActiveChatId(c.id); }}
                      onKeyDown={(e) => e.key === "Enter" && setActiveChatId(c.id)}
                    >
                      <span className="text-[0.8rem] opacity-60">💬</span>
                      {renamingId === c.id ? (
                        <input
                          className="flex-1 bg-bg-card border border-border-accent rounded px-2 py-0.5 text-[0.82rem] text-text outline-none"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") handleSubmitRename(c.id);
                            if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                          }}
                          onBlur={() => handleSubmitRename(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{c.title}</span>
                      )}
                      {renamingId !== c.id && (
                        <span
                          className="opacity-0 group-hover:opacity-100 text-[0.85rem] text-text-dim cursor-pointer px-1 py-0.5 rounded transition-all hover:text-accent hover:bg-accent/10"
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                          role="presentation"
                        >
                          <Ellipsis size={16} />
                        </span>
                      )}
                      {menuOpenId === c.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded-lg shadow-lg py-1 min-w-[140px] animate-[fadeIn_0.15s_ease]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.82rem] text-text-muted bg-transparent border-none cursor-pointer transition-colors hover:bg-bg-card hover:text-text text-left"
                            onClick={() => handleStartRename(c.id, c.title)}
                          >
                            <Pencil size={14} />
                            {t("chat.rename")}
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.82rem] text-text-muted bg-transparent border-none cursor-pointer transition-colors hover:bg-bg-card hover:text-text text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handleDuplicateConversation(c.id)}
                            disabled={duplicateConversation.isPending}
                          >
                            <Copy size={14} />
                            {t("chat.duplicate")}
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.82rem] text-danger bg-transparent border-none cursor-pointer transition-colors hover:bg-danger/10 text-left"
                            onClick={() => handleDeleteConversation(c.id)}
                          >
                            <Trash2 size={14} />
                            {t("chat.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
            {hasMoreConvs && (
              <button
                type="button"
                className="w-full py-2 mt-1 mb-2 text-[0.78rem] text-accent bg-transparent border border-dashed border-border-accent rounded-lg cursor-pointer transition-all hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => fetchMoreConvs()}
                disabled={isFetchingMoreConvs}
              >
                {isFetchingMoreConvs ? t("chat.loading") : t("chat.loadMore")}
              </button>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border">
            <Link href="/dashboard" className="text-text-dim no-underline text-[0.85rem] transition-colors flex items-center gap-2 hover:text-accent">{t("chat.backToDashboard")}</Link>
          </div>
        </aside>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col relative">
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated">
            <div className="text-[0.95rem] font-semibold flex items-center gap-2">
              💬 {t("chat.chatWithFiles")}
              <span className="font-mono text-[0.72rem] text-accent bg-accent/15 px-2 py-0.5 rounded">
                {selectedModel}
              </span>
            </div>
            <div className="flex gap-2">
              <button type="button" className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent" onClick={() => setFilePanelOpen((o) => !o)}>
                📁 {t("chat.files")}
              </button>
              <button type="button" className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent" onClick={() => setModelOverlayOpen(true)}>
                ⚙️ {t("chat.model")}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6" ref={messagesContainerRef}>
            {!activeChatId && !convLoading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-text-dim">
                  <div className="text-4xl mb-3">💬</div>
                  <div className="text-[0.95rem] font-medium mb-1">Start a conversation</div>
                  <div className="text-[0.82rem]">Click &quot;+ New Chat&quot; or type a message below</div>
                </div>
              </div>
            )}

            {activeChatId && msgsLoading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-text-dim text-[0.85rem]">Loading messages...</div>
              </div>
            )}

            {activeChatId && !msgsLoading && hasOlderMsgs && (
              <button
                type="button"
                className="self-center py-1.5 px-4 mb-2 text-[0.78rem] text-accent bg-transparent border border-dashed border-border-accent rounded-lg cursor-pointer transition-all hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => fetchOlderMsgs()}
                disabled={isFetchingOlderMsgs}
              >
                {isFetchingOlderMsgs ? t("chat.loading") : t("chat.loadOlderMessages")}
              </button>
            )}

            {activeChatId && !msgsLoading && messages.length === 0 && (
              <div className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
                <div className="flex-1">
                  <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">now</span></div>
                  <div className="inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm">
                    <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
                      Ask me anything about your indexed files. I&apos;ll use local embeddings to find the most relevant sections for your questions.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => {
              // Optimistic rows from useSendMessage carry a string id with the
              // OPTIMISTIC_PREFIX; real server rows have a numeric id.
              const isPending =
                typeof m.id === "string" &&
                (m.id as unknown as string).startsWith(OPTIMISTIC_PREFIX);
              return renderMessage(m, isPending);
            })}
          </div>

          {/* Input area */}
          {(
          <div className="px-8 py-4 pb-6 border-t border-border bg-bg-elevated">
            <div className="max-w-[720px] mx-auto relative">
              {/* @file autocomplete dropdown */}
              {showFileMention && mentionFiles.length > 0 && (
                <div className="absolute bottom-full mb-1 left-0 right-0 bg-bg-elevated border border-border rounded-lg shadow-lg py-1 z-50 max-h-[200px] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[0.68rem] font-mono text-text-dim uppercase tracking-wider">Mention a file</div>
                  {mentionFiles.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.82rem] text-text-muted bg-transparent border-none cursor-pointer transition-colors hover:bg-bg-card hover:text-text text-left"
                      onMouseDown={(e) => { e.preventDefault(); insertFileMention(f); }}
                    >
                      <span className="text-[0.85rem]">{f.type === ".pdf" ? "📄" : f.type === ".docx" ? "📝" : "📃"}</span>
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="font-mono text-[0.65rem] text-text-dim">{f.chunks} chunks</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-col w-full bg-bg-card border border-border rounded-xl min-h-[48px] max-h-[150px] overflow-y-auto pr-[4.5rem] pl-3 py-1 focus-within:border-border-focus transition-colors">
                {taggedFile && (
                  <div className="flex items-center pt-1.5 px-0.5">
                    <span className="inline-flex items-center gap-1.5 bg-accent/15 text-accent border border-accent/30 rounded-md px-2.5 py-1 text-[0.78rem] font-mono max-w-full">
                      <span className="truncate">📄 @{taggedFile.name}</span>
                      <button
                        type="button"
                        className="bg-transparent border-none text-accent/60 cursor-pointer text-[0.7rem] p-0 ml-0.5 hover:text-accent shrink-0"
                        onClick={() => setTaggedFile(null)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                )}
                <textarea
                  className="w-full py-2.5 bg-transparent text-text font-body text-[0.95rem] outline-none resize-none leading-relaxed placeholder:text-text-dim border-none"
                  placeholder={taggedFile ? "Ask about this file..." : t("chat.askAboutFiles")}
                  rows={1}
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  readOnly={isSending}
                />
              </div>
              <div className="absolute right-2.5 bottom-2.5 flex gap-1">
                <button type="button" className="w-[34px] h-[34px] rounded-lg border border-border bg-bg-elevated text-text-muted cursor-pointer flex items-center justify-center text-[0.9rem] transition-all hover:border-accent hover:text-accent" title={t("chat.attachFile")} onClick={() => setFilePanelOpen((o) => !o)}>📎</button>
                <button
                  type="button"
                  className="w-[34px] h-[34px] rounded-lg border border-border bg-bg-elevated text-text-muted cursor-pointer flex items-center justify-center transition-all hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t("chat.voiceInput")}
                  aria-label={t("chat.voiceInput")}
                  onClick={() => {
                    const disabled = typeof window !== "undefined" && localStorage.getItem("whisper_disabled") === "true";
                    if (disabled || !whisperHealth?.connected || !whisperHealth?.has_model) {
                      setWhisperAlert(true);
                    } else {
                      setVoiceOpen(true);
                    }
                  }}
                  disabled={isSending}
                >
                  <Mic size={16} />
                </button>
                {isSending ? (
                  <button
                    type="button"
                    className="w-[34px] h-[34px] rounded-lg border-none bg-danger text-white cursor-pointer flex items-center justify-center transition-all hover:opacity-85"
                    title="Stop generating"
                    onClick={handleStop}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect width="14" height="14" rx="2" /></svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w-[34px] h-[34px] rounded-lg border-none bg-accent text-bg cursor-pointer flex items-center justify-center text-[0.9rem] transition-all hover:opacity-85 disabled:opacity-50"
                    title={t("chat.send")}
                    onClick={() => handleSend()}
                    disabled={!input.trim()}
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
            <div className="text-center mt-2 font-mono text-[0.68rem] text-text-dim">{t("chat.enterToSend")}</div>
          </div>
          )}
        </div>

        <VoiceInput
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onTranscribed={(text) => {
            setInput(text);
          }}
          language={locale}
          activeModel={whisperHealth?.model || ""}
        />

        {/* File Panel */}
        <div className={`w-[300px] bg-bg-elevated border-l border-border flex-col shrink-0 ${filePanelOpen ? "flex" : "hidden"}`}>
          <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <span className="text-[0.9rem] shrink-0 pt-0.5" aria-hidden>
                📁
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[0.9rem] font-semibold font-mono truncate">
                    {embeddingModelsStatus?.installed
                      ? embeddingModelsStatus.configured_embedding_model
                      : t("chat.files")}
                  </span>
                  {embeddingModelsStatus?.installed && (
                    <span className="font-mono text-[0.6rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded shrink-0">
                      {t("common.active")}
                    </span>
                  )}
                </div>
                {embeddingModelsStatus?.installed ? (
                  <div className="text-[0.65rem] font-mono text-text-dim truncate mt-0.5">
                    Ollama
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="bg-transparent border-none text-text-dim cursor-pointer text-lg px-1.5 py-0.5 rounded transition-colors hover:text-danger shrink-0"
              onClick={() => setFilePanelOpen(false)}
            >
              ✕
            </button>
          </div>

          {embeddingModelsStatus && !embeddingModelsStatus.installed ? (
            <div className="mx-3 mt-3 p-6 border border-dashed border-border rounded-[10px] text-center">
              {isPulling && download && /embed/i.test(download.modelName) ? (
                <>
                  <div className="text-2xl mb-2">⏳</div>
                  <div className="text-[0.85rem] font-semibold mb-1">{download.modelName}</div>
                  <div className="w-full h-1.5 bg-border rounded-full overflow-hidden mb-2 mt-3">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${download.percent}%` }}
                    />
                  </div>
                  <div className="font-mono text-[0.75rem] text-accent font-semibold">
                    {download.percent}%
                  </div>
                  <div className="font-mono text-[0.65rem] text-text-dim mt-1">
                    {download.status}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl mb-2">🧩</div>
                  <div className="text-[0.85rem] font-semibold mb-1">{t("chat.noEmbeddingModel")}</div>
                  <div className="text-[0.75rem] text-text-dim font-light mb-3">{t("chat.noEmbeddingModelDesc")}</div>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const res = await apiGet<EmbeddingModelsStatus>("/api/chat/embedding-models/");
                        if (!res.ok || !res.data) return;
                        setEmbeddingStatusSnapshot(res.data);
                        const fallback =
                          res.data.recommended[0] || res.data.configured_embedding_model || "nomic-embed-text";
                        const initial =
                          (modelConfig?.embedding_model || "").trim() || res.data.configured_embedding_model || fallback;
                        setEmbeddingChoice(modelNameBase(initial));
                        setEmbeddingModalError(null);
                        setPendingPdfFile(null);
                        setEmbeddingModalOpen(true);
                      })();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:opacity-85"
                  >
                    <span className="text-[0.9rem] leading-none">+</span> {t("chat.pullEmbeddingModel")}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div
              className={`mx-3 mt-3 p-6 border border-dashed border-border rounded-[10px] text-center cursor-pointer transition-all hover:border-accent hover:bg-accent/15 ${uploadFile.isPending || embeddingBusy ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (uploadFile.isPending || embeddingBusy) return;
                const fl = e.dataTransfer.files;
                if (!fl?.length) return;
                Array.from(fl).forEach((f) => {
                  void processFileForUpload(f);
                });
              }}
              role="presentation"
            >
              <div className="text-2xl mb-2">{uploadFile.isPending ? "⏳" : "📤"}</div>
              <div className="text-[0.82rem] text-text-muted font-light">
                {uploadFile.isPending ? "Uploading & indexing..." : t("chat.dropFiles")}
              </div>
              <div className="font-mono text-[0.68rem] text-text-dim mt-1">{t("chat.supportedFormats")}</div>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  Array.from(files).forEach((file) => {
                    void processFileForUpload(file);
                  });
                  e.target.value = "";
                }}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3">
            {filesLoading ? (
              <div className="py-4 text-center text-[0.82rem] text-text-dim">Loading...</div>
            ) : (
              <>
                <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-1 pt-2.5 pb-1">
                  {t("chat.indexedFiles", { count: String(indexedFiles.length) })}
                </div>
                {indexedFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="text-2xl mb-2 opacity-40">📄</div>
                    <div className="text-[0.82rem] text-text-dim font-light">No files indexed yet</div>
                    <div className="text-[0.72rem] text-text-dim mt-1">Upload files above to get started</div>
                  </div>
                ) : (
                  indexedFiles.map((f) => (
                    <div key={f.id} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors mb-px hover:bg-bg-card">
                      <span className="text-[0.9rem]">{f.type === ".pdf" ? "📄" : f.type === ".docx" ? "📝" : "📃"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.82rem] whitespace-nowrap overflow-hidden text-ellipsis">{f.name}</div>
                        <div className="font-mono text-[0.68rem] text-text-dim">
                          {f.size > 1024 * 1024
                            ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                            : `${Math.round(f.size / 1024)} KB`}
                          {" · "}
                          {f.chunks} chunks
                        </div>
                      </div>
                      <span className="font-mono text-[0.65rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded">{t("chat.indexed")}</span>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 bg-transparent border-none text-text-dim cursor-pointer text-[0.8rem] px-1 py-0.5 rounded transition-all hover:text-danger"
                        onClick={() => deleteFile.mutate(f.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Model Selector Overlay */}
      {modelOverlayOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-[8px] animate-[fadeIn_0.3s_ease]">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-[1.4rem] font-bold mb-1.5">{t("chat.chooseModel")}</h2>
                <p className="text-text-muted text-[0.92rem] font-light leading-relaxed">
                  Showing models installed in Ollama
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setShowPullModal(true); setPullError(null); }}
                  disabled={isPulling}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg border-none rounded-lg font-body text-[0.8rem] font-semibold cursor-pointer transition-all hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPulling ? t("modelEngines.downloading") : t("modelEngines.pullModel")}
                </button>
                <button type="button" className="bg-transparent border-none text-text-dim cursor-pointer text-xl px-2 py-1 rounded transition-colors hover:text-danger" onClick={() => setModelOverlayOpen(false)}>✕</button>
              </div>
            </div>

            {download && (
              <div className="mb-4 bg-bg-card border border-border rounded-xl p-3">
                <div className="flex justify-between font-mono text-xs text-text-muted mb-1.5">
                  <span>{download.status} — {download.modelName}</span>
                  <span>{download.percent}%</span>
                </div>
                <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${download.percent}%` }} />
                </div>
              </div>
            )}

            {ollamaModels.length === 0 && !download ? (
              <div className="text-center py-8 text-text-dim">
                <div className="text-2xl mb-2">🤖</div>
                <div className="text-[0.85rem]">No models found in Ollama</div>
                <button
                  type="button"
                  onClick={() => { setShowPullModal(true); setPullError(null); }}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.85rem] font-semibold cursor-pointer transition-all hover:opacity-85"
                >
                  {t("modelEngines.pullModel")}
                </button>
              </div>
            ) : (
              <div>
                {ollamaModels.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    className={`flex items-center gap-4 p-4 border rounded-[10px] cursor-pointer transition-all mb-2.5 ${selectedModel === m.id ? "border-accent bg-accent/15" : "border-border hover:border-border-accent hover:bg-bg-card"}`}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelOverlayOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSelectedModel(m.id);
                        setModelOverlayOpen(false);
                      }
                    }}
                  >
                    <div className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${selectedModel === m.id ? "border-accent" : "border-border"}`}>
                      <div className={`w-2 h-2 rounded-full bg-accent transition-opacity ${selectedModel === m.id ? "opacity-100" : "opacity-0"}`} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[0.95rem] font-semibold">{m.name}</div>
                    </div>
                    <div className="font-mono text-[0.72rem] text-text-dim shrink-0">{m.size}</div>
                    {selectedModel === m.id && <span className="font-mono text-[0.65rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded">Active</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pull Modal */}
      {showPullModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] backdrop-blur-sm">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[460px] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative">
            <button
              onClick={() => setShowPullModal(false)}
              className="absolute top-4 right-4 bg-transparent border-none text-text-dim text-xl cursor-pointer"
            >
              &times;
            </button>
            <h3 className="text-xl font-semibold mb-1">{t("modelEngines.pullNewModel")}</h3>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">
              {t("modelEngines.pullModelDesc")}{" "}
              <a
                href="https://ollama.com/library"
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                ollama.com/library
              </a>
              .
            </p>
            <div className="flex gap-2">
              <input
                value={pullInput}
                onChange={(e) => {
                  setPullInput(e.target.value);
                  if (pullError) setPullError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handlePullModel()}
                placeholder={t("modelEngines.pullPlaceholder")}
                className={`flex-1 px-4 py-3 bg-bg-card border rounded-lg text-text font-mono text-[0.88rem] outline-none focus:border-border-focus ${
                  pullError ? "border-danger" : "border-border"
                }`}
              />
              <button
                onClick={handlePullModel}
                disabled={isValidating}
                className="px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.88rem] cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isValidating ? t("modelEngines.validating") : t("modelEngines.pull")}
              </button>
            </div>
            {pullError && (
              <div className="font-mono text-[0.78rem] text-danger mt-2">
                {pullError}
              </div>
            )}
            <div className="font-mono text-[0.72rem] text-text-dim mt-2">
              {t("modelEngines.popular")}
            </div>
          </div>
        </div>
      )}

      {embeddingModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-[8px] animate-[fadeIn_0.3s_ease]">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-[1.4rem] font-bold mb-1.5">{t("chat.embeddingModalTitle")}</h2>
                <p className="text-text-muted text-[0.92rem] font-light leading-relaxed">
                  {t("chat.embeddingModalDesc")}
                </p>
              </div>
              <button
                type="button"
                className="bg-transparent border-none text-text-dim cursor-pointer text-xl px-2 py-1 rounded transition-colors hover:text-danger"
                onClick={() => {
                  setEmbeddingModalOpen(false);
                  setPendingPdfFile(null);
                  setEmbeddingStatusSnapshot(null);
                  setEmbeddingModalError(null);
                }}
              >
                ✕
              </button>
            </div>

            {embeddingModalError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-[0.85rem]">
                {embeddingModalError}
              </div>
            )}

            <div className="flex flex-col gap-2 mb-6">
              {embeddingChoices.map((c) => {
                const isDownloading = isPulling && download?.modelName === c.value && embeddingChoice === c.value;
                const disabledByPull = isPulling && !isDownloading;
                return (
                <div
                  key={c.value}
                  role="button"
                  tabIndex={disabledByPull ? -1 : 0}
                  className={`flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                    disabledByPull
                      ? "border-border opacity-40 cursor-not-allowed"
                      : embeddingChoice === c.value
                        ? "border-accent bg-accent/10 cursor-pointer"
                        : "border-border hover:border-border-accent hover:bg-bg-card cursor-pointer"
                  }`}
                  onClick={() => { if (!disabledByPull) setEmbeddingChoice(c.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !disabledByPull) setEmbeddingChoice(c.value); }}
                >
                  <div className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${embeddingChoice === c.value ? "border-accent" : "border-border"}`}>
                    <div className={`w-2 h-2 rounded-full bg-accent transition-opacity ${embeddingChoice === c.value ? "opacity-100" : "opacity-0"}`} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.95rem] font-semibold">{c.label}</span>
                      {c.recommended && !isDownloading && (
                        <span className="font-mono text-[0.62rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded tracking-wide uppercase">{t("modelEngines.recommended")}</span>
                      )}
                      {isDownloading && (
                        <span className="font-mono text-[0.62rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded tracking-wide">{download.percent}%</span>
                      )}
                    </div>
                    <div className="font-mono text-[0.72rem] text-text-dim mt-0.5">
                      {isDownloading
                        ? download.status
                        : c.installed ? t("chat.embeddingInstalled") : t("chat.embeddingWillDownload")}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={isPulling || embeddingBusy || embeddingChoices.length === 0}
              className="w-full px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.9rem] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:opacity-85"
              onClick={() => void handleEmbeddingModalContinue()}
            >
              {isPulling ? t("modelEngines.downloading") : t("chat.embeddingContinue")}
            </button>
          </div>
        </div>
      )}

      {/* Whisper not connected / no model alert */}
      {whisperAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-[min(420px,90vw)] bg-bg-elevated border border-border rounded-2xl shadow-2xl p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-accent-warm/15 border-2 border-accent-warm flex items-center justify-center text-2xl mx-auto mb-4">
              🎙️
            </div>
            <h2 className="text-[1.1rem] font-bold mb-2">
              {isWhisperPulling
                ? t("chat.whisperNoModel")
                : whisperHealth?.connected && !whisperHealth?.has_model
                  ? t("chat.whisperNoModel")
                  : t("chat.whisperDisconnected")}
            </h2>
            <p className="text-text-muted text-[0.85rem] font-light mb-4">
              {isWhisperPulling
                ? t("chat.whisperNoModelDesc")
                : whisperHealth?.connected && !whisperHealth?.has_model
                  ? t("chat.whisperNoModelDesc")
                  : t("chat.whisperDisconnectedDesc")}
            </p>

            {/* Progress bar while pulling */}
            {whisperDownload && (
              <div className="mb-5">
                <div className="flex justify-between font-mono text-xs text-text-muted mb-2">
                  <span>🎙️ {whisperDownload.status}</span>
                  <span>{whisperDownload.percent}%</span>
                </div>
                <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${whisperDownload.percent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setWhisperAlert(false)}
                className="flex-1 px-4 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.85rem] cursor-pointer transition-all hover:border-text-muted"
              >
                {t("common.close")}
              </button>
              {isWhisperPulling ? null : whisperHealth?.connected && !whisperHealth?.has_model ? (
                <button
                  type="button"
                  onClick={() => { setWhisperAlert(false); setShowWhisperPullModal(true); setWhisperPullName(""); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.85rem] font-semibold cursor-pointer transition-all hover:opacity-85"
                >
                  <span className="text-[0.95rem] leading-none">+</span> {t("modelEngines.pullWhisperModel")}
                </button>
              ) : !whisperHealth?.connected ? (
                <Link
                  href="/model-engines"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.85rem] font-semibold no-underline cursor-pointer transition-all hover:opacity-85"
                >
                  {t("sidebar.modelEngines")} <ArrowRight size={16} />
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Whisper Pull Modal — styled model list (same as Model Engines page) */}
      {showWhisperPullModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-sm">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[520px] max-h-[85vh] overflow-y-auto p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative">
            <button
              type="button"
              onClick={() => setShowWhisperPullModal(false)}
              className="absolute top-4 right-4 bg-transparent border-none text-text-dim text-xl cursor-pointer"
            >
              &times;
            </button>
            <h3 className="text-xl font-semibold mb-1">{t("modelEngines.pullWhisperModelTitle")}</h3>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">
              {t("modelEngines.pullWhisperModelDesc")}
            </p>

            <div className="flex flex-col gap-2">
              {[
                { name: "tiny", speed: "Fastest", quality: "Basic" },
                { name: "base", speed: "Fast", quality: "Good", recommended: true },
                { name: "small", speed: "Medium", quality: "Better" },
                { name: "medium", speed: "Slow", quality: "Great" },
                { name: "large-v3", speed: "Slowest", quality: "Best" },
              ]
                .filter((m) => !whisperModels.some((wm) => wm.name === m.name))
                .map((m) => {
                const isDownloading = isWhisperPulling && whisperDownload?.modelName === m.name;
                const disabledByPull = isWhisperPulling && !isDownloading;
                return (
                <div
                  key={m.name}
                  className={`flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                    disabledByPull
                      ? "border-border opacity-40 cursor-not-allowed"
                      : whisperPullName === m.name
                        ? "border-accent bg-accent/10 cursor-pointer"
                        : "border-border hover:border-border-accent hover:bg-bg-card cursor-pointer"
                  }`}
                  onClick={() => { if (!disabledByPull) setWhisperPullName(m.name); }}
                  role="button"
                  tabIndex={disabledByPull ? -1 : 0}
                  onKeyDown={(e) => { if (e.key === "Enter" && !disabledByPull) setWhisperPullName(m.name); }}
                >
                  <div className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${whisperPullName === m.name ? "border-accent" : "border-border"}`}>
                    <div className={`w-2 h-2 rounded-full bg-accent transition-opacity ${whisperPullName === m.name ? "opacity-100" : "opacity-0"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.95rem] font-semibold">{m.name}</span>
                      {m.recommended && (
                        <span className="font-mono text-[0.62rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded tracking-wide uppercase">{t("chat.whisperRecommended")}</span>
                      )}
                      {isDownloading && (
                        <span className="font-mono text-[0.62rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded tracking-wide">{whisperDownload.percent}%</span>
                      )}
                    </div>
                    <div className="font-mono text-[0.72rem] text-text-dim mt-0.5">
                      {isDownloading
                        ? whisperDownload.status
                        : `${m.speed} · ${m.quality}`}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => {
                  if (!whisperPullName || isWhisperPulling) return;
                  startWhisperPull(whisperPullName);
                }}
                disabled={!whisperPullName || isWhisperPulling}
                className="w-full px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.9rem] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:opacity-85"
              >
                {isWhisperPulling ? t("modelEngines.downloading") : t("modelEngines.pull")}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast message={toast} />
    </div>
  );
}
