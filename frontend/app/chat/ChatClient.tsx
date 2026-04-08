"use client";

import Link from "next/link";
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  useConversations,
  useConversationMessages,
  useCreateConversation,
  useSendMessage,
  useDeleteConversation,
  useRenameConversation,
  useIndexedFiles,
  useUploadFile,
  useDeleteFile,
  useOllamaModels,
  type ChatMessage,
} from "@/hooks/use-chat";

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
  const { t } = useTranslation();
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [modelOverlayOpen, setModelOverlayOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [showFileMention, setShowFileMention] = useState(false);
  const [fileMentionQuery, setFileMentionQuery] = useState("");
  const [taggedFile, setTaggedFile] = useState<{ id: string; name: string } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Optimistic messages shown before server confirms
  const [pendingMessages, setPendingMessages] = useState<
    { id: string; role: "user" | "assistant"; content: string }[]
  >([]);

  // API hooks
  const { data: conversations = [], isLoading: convLoading } = useConversations();
  const { data: messages = [], isLoading: msgsLoading } = useConversationMessages(activeChatId);
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const { data: indexedFiles = [], isLoading: filesLoading } = useIndexedFiles();
  const uploadFile = useUploadFile();
  const deleteFile = useDeleteFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: ollamaModels = [], isLoading: modelsLoading } = useOllamaModels();

  // Clear pending messages when active chat changes (navigation, switching chats)
  useEffect(() => {
    setPendingMessages([]);
  }, [activeChatId]);

  // Auto-select first available model
  useEffect(() => {
    if (!selectedModel && ollamaModels.length > 0) {
      setSelectedModel(ollamaModels[0].id);
    }
  }, [selectedModel, ollamaModels]);

  // Auto-select first conversation
  useEffect(() => {
    if (!activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0].id);
    }
  }, [activeChatId, conversations]);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingMessages, scrollToBottom]);

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

  async function handleSend() {
    const text = input.trim();
    if (!text) return;

    let chatId = activeChatId;

    // If no active conversation, create one first
    if (!chatId) {
      try {
        const conv = await createConversation.mutateAsync(undefined);
        chatId = conv.id;
        setActiveChatId(chatId);
      } catch {
        return;
      }
    }

    // Use tagged file as filter
    const fileFilter = taggedFile?.name;
    const displayText = taggedFile ? `@${taggedFile.name} ${text}` : text;

    // Optimistic: show user message immediately
    const tempId = `pending-${Date.now()}`;
    setPendingMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content: displayText },
      { id: `${tempId}-thinking`, role: "assistant", content: "Thinking..." },
    ]);
    setInput("");
    setTaggedFile(null);
    setShowFileMention(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    sendMessage.mutate(
      {
        conversationId: chatId,
        content: text,
        model: selectedModel || undefined,
        signal: controller.signal,
        file_filter: fileFilter,
      },
      {
        onSettled: () => {
          setPendingMessages([]);
          abortControllerRef.current = null;
        },
      },
    );
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPendingMessages([]);
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

  async function handleNewChat() {
    try {
      const conv = await createConversation.mutateAsync(undefined);
      setActiveChatId(conv.id);
      setPendingMessages([]);
    } catch {
      // error handled by hook
    }
  }

  function handleDeleteConversation(convId: number) {
    setMenuOpenId(null);
    deleteConversation.mutate(convId, {
      onSuccess: () => {
        if (activeChatId === convId) {
          setActiveChatId(null);
          setPendingMessages([]);
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

  // Close menu on outside click
  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [menuOpenId]);


  // Group conversations by date
  const grouped = groupByDate(conversations);

  // Combine server messages with optimistic pending messages
  const allMessages: (ChatMessage | { id: string; role: "user" | "assistant"; content: string; sources?: null; created_at?: null })[] = [
    ...messages,
    ...pendingMessages,
  ];

  const isSending = sendMessage.isPending;

  function renderMessage(m: { id: string | number; role: string; content: string; sources?: string[] | null; created_at?: string | null }, isPending?: boolean) {
    const isUser = m.role === "user";
    const sourceList = parseSources(m.sources ?? null);
    const isThinking = isPending && m.role === "assistant";

    if (isUser) {
      return (
        <div key={m.id} className="max-w-[720px] w-full mx-auto flex gap-3 flex-row-reverse animate-[msgIn_0.3s_ease]">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-linear-to-br from-indigo-500 to-indigo-400 text-white font-bold">A</div>
          <div className="flex-1 text-right">
            <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2 justify-end">
              {t("chat.you")} <span className="font-mono text-[0.68rem] text-text-dim font-normal">{m.created_at ? formatTime(m.created_at) : "now"}</span>
            </div>
            <div className={`inline-block text-left px-4 py-3 rounded-xl bg-indigo-500/[0.12] border border-indigo-500/20 rounded-tr-sm ${isPending ? "opacity-70" : ""}`}>
              <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">{m.content}</div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={m.id} className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
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
            className="mx-3 mt-3 mb-1 py-2.5 bg-accent/15 border border-dashed border-border-accent rounded-lg text-accent font-body text-[0.88rem] font-medium cursor-pointer transition-all text-center hover:bg-accent/30 hover:border-solid disabled:opacity-50"
            onClick={handleNewChat}
            disabled={createConversation.isPending}
          >
            {createConversation.isPending ? "Creating..." : t("chat.newChat")}
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
                      onClick={() => { setActiveChatId(c.id); setPendingMessages([]); }}
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
                            Rename
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.82rem] text-danger bg-transparent border-none cursor-pointer transition-colors hover:bg-danger/10 text-left"
                            onClick={() => handleDeleteConversation(c.id)}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
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
              <span className="font-mono text-[0.72rem] text-accent bg-accent/15 px-2 py-0.5 rounded">{selectedModel} · Ollama</span>
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
            {!modelsLoading && ollamaModels.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-[400px]">
                  <div className="text-4xl mb-3">🤖</div>
                  <div className="text-[1.1rem] font-semibold mb-2">No AI model installed</div>
                  <div className="text-[0.85rem] text-text-muted mb-4 leading-relaxed">
                    You need to install a language model before you can chat. Go to Model Engines to download one.
                  </div>
                  <Link
                    href="/model-engines"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.88rem] font-semibold no-underline transition-all hover:-translate-y-0.5"
                  >
                    Go to Model Engines
                  </Link>
                </div>
              </div>
            )}

            {!modelsLoading && ollamaModels.length > 0 && !activeChatId && !convLoading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-text-dim">
                  <div className="text-4xl mb-3">💬</div>
                  <div className="text-[0.95rem] font-medium mb-1">Start a conversation</div>
                  <div className="text-[0.82rem]">Click &quot;+ New Chat&quot; or type a message below</div>
                </div>
              </div>
            )}

            {ollamaModels.length > 0 && activeChatId && msgsLoading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-text-dim text-[0.85rem]">Loading messages...</div>
              </div>
            )}

            {ollamaModels.length > 0 && activeChatId && !msgsLoading && allMessages.length === 0 && (
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

            {ollamaModels.length > 0 && allMessages.map((m) => {
              const isPending = typeof m.id === "string" && (m.id as string).startsWith("pending-");
              return renderMessage(
                { ...m, id: m.id, sources: "sources" in m ? m.sources : null, created_at: "created_at" in m ? m.created_at : null },
                isPending,
              );
            })}
          </div>

          {/* Input area — hidden when no models */}
          {ollamaModels.length > 0 && (
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
              <div className="flex items-center gap-2 w-full bg-bg-card border border-border rounded-xl min-h-[48px] max-h-[150px] pr-[4.5rem] pl-3 py-1 focus-within:border-border-focus transition-colors">
                {taggedFile && (
                  <span className="inline-flex items-center gap-1.5 bg-accent/15 text-accent border border-accent/30 rounded-md px-2.5 py-1 text-[0.78rem] font-mono whitespace-nowrap shrink-0">
                    📄 @{taggedFile.name}
                    <button
                      type="button"
                      className="bg-transparent border-none text-accent/60 cursor-pointer text-[0.7rem] p-0 ml-0.5 hover:text-accent"
                      onClick={() => setTaggedFile(null)}
                    >
                      ✕
                    </button>
                  </span>
                )}
                <textarea
                  className="flex-1 py-2.5 bg-transparent text-text font-body text-[0.95rem] outline-none resize-none leading-relaxed placeholder:text-text-dim border-none"
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
                    onClick={handleSend}
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

        {/* File Panel */}
        <div className={`w-[300px] bg-bg-elevated border-l border-border flex-col shrink-0 ${filePanelOpen ? "flex" : "hidden"}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="text-[0.9rem] font-semibold">📁 {t("chat.files")}</div>
            <button type="button" className="bg-transparent border-none text-text-dim cursor-pointer text-lg px-1.5 py-0.5 rounded transition-colors hover:text-danger" onClick={() => setFilePanelOpen(false)}>✕</button>
          </div>

          <div
            className={`mx-3 mt-3 p-6 border border-dashed border-border rounded-[10px] text-center cursor-pointer transition-all hover:border-accent hover:bg-accent/15 ${uploadFile.isPending ? "opacity-50 pointer-events-none" : ""}`}
            onClick={() => fileInputRef.current?.click()}
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
                  uploadFile.mutate(file);
                });
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3">
            {filesLoading ? (
              <div className="py-4 text-center text-[0.82rem] text-text-dim">Loading...</div>
            ) : indexedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="text-2xl mb-2 opacity-40">📁</div>
                <div className="text-[0.82rem] text-text-dim font-light">No files indexed yet</div>
                <div className="text-[0.72rem] text-text-dim mt-1">Upload files above to get started</div>
              </div>
            ) : (
              <>
                <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-1 pt-2.5 pb-1">
                  {t("chat.indexedFiles", { count: String(indexedFiles.length) })}
                </div>
                {indexedFiles.map((f) => (
                  <div key={f.id} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors mb-px hover:bg-bg-card">
                    <span className="text-[0.9rem]">{f.type === ".pdf" ? "📄" : f.type === ".docx" ? "📝" : "📃"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.82rem] whitespace-nowrap overflow-hidden text-ellipsis">{f.name}</div>
                      <div className="font-mono text-[0.68rem] text-text-dim">
                        {f.size > 1024 * 1024
                          ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                          : `${Math.round(f.size / 1024)} KB`}
                        {" · "}{f.chunks} chunks
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
                ))}
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
              <button type="button" className="bg-transparent border-none text-text-dim cursor-pointer text-xl px-2 py-1 rounded transition-colors hover:text-danger" onClick={() => setModelOverlayOpen(false)}>✕</button>
            </div>

            {ollamaModels.length === 0 ? (
              <div className="text-center py-8 text-text-dim">
                <div className="text-2xl mb-2">🤖</div>
                <div className="text-[0.85rem]">No models found in Ollama</div>
                <div className="text-[0.75rem] mt-1">Run: docker compose exec ollama ollama pull llama3.1:8b</div>
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
    </div>
  );
}
