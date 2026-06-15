"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiUpload,
  apiUploadBlob,
  apiUploadWithProgress,
  type UploadProgressUpdate,
} from "@/lib/api";

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: string[] | null;
  turn_id: string | null;
  created_at: string;
  // Which model generated this assistant message. Null for user messages and
  // for older rows created before model tracking was added.
  model?: string | null;
}

interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  ai_error?: string;
}

interface PaginatedConversations {
  conversations: Conversation[];
  next_cursor: string | null;
  has_more: boolean;
}

export function useConversations() {
  return useInfiniteQuery({
    queryKey: ["chat", "conversations"],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "30");
      const res = await apiGet<PaginatedConversations>(
        `/api/chat/conversations/?${params.toString()}`,
      );
      if (!res.ok) return { conversations: [], next_cursor: null, has_more: false } as PaginatedConversations;
      return res.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    refetchOnWindowFocus: true,
  });
}

/** Archived conversations (for the "Archived chats" modal). */
export function useArchivedConversations(enabled = true) {
  return useQuery({
    queryKey: ["chat", "conversations", "archived"],
    queryFn: async () => {
      const res = await apiGet<PaginatedConversations>(
        "/api/chat/conversations/?archived=true&limit=100",
      );
      if (!res.ok) return [];
      return res.data.conversations;
    },
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Flattened conversation list from all loaded pages. */
export function useFlatConversations() {
  const query = useConversations();
  const conversations = query.data?.pages.flatMap((p) => p.conversations) ?? [];
  return { ...query, conversations };
}

interface PaginatedMessages {
  messages: ChatMessage[];
  next_cursor: number | null;
  has_more: boolean;
}

export function useConversationMessages(conversationId: number | null) {
  return useInfiniteQuery({
    queryKey: ["chat", "messages", conversationId],
    queryFn: async ({ pageParam }: { pageParam: number | null }) => {
      if (!conversationId) return { messages: [], next_cursor: null, has_more: false } as PaginatedMessages;
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", String(pageParam));
      params.set("limit", "50");
      const res = await apiGet<PaginatedMessages>(
        `/api/chat/conversations/${conversationId}/messages/?${params.toString()}`,
      );
      if (!res.ok) return { messages: [], next_cursor: null, has_more: false } as PaginatedMessages;
      return res.data;
    },
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    enabled: !!conversationId,
    // Avoid `staleTime: 0`, which causes refetches to fire during an in-flight
    // send and overwrites the optimistic "Thinking..." row before the mutation
    // completes. We explicitly call setQueryData or invalidateQueries after
    // sends/edits/deletes, so treating cached data as fresh for 5 minutes is
    // safe and matches the behavior of other queries in this app.
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/** Flattened message list from all loaded pages (older pages first, then newest). */
export function useFlatMessages(conversationId: number | null) {
  const query = useConversationMessages(conversationId);
  // Pages are loaded newest-first (page 0 = latest, page 1 = older, etc.)
  // Reverse page order so older messages come first, then flatten.
  const messages = query.data?.pages ? [...query.data.pages].reverse().flatMap((p) => p.messages) : [];
  return { ...query, messages };
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (title?: string) => {
      const res = await apiPost<{ conversation: Conversation }>(
        "/api/chat/conversations/",
        title ? { title } : {},
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to create conversation.",
        );
      }
      return res.data.conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

// Marker prefix for optimistic messages so the UI can render a pending style.
// Real messages always have a numeric id from the server.
export const OPTIMISTIC_PREFIX = "optimistic-";

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      content,
      model,
      signal,
      file_filter,
      turn_id,
    }: {
      conversationId: number;
      content: string;
      model?: string;
      signal?: AbortSignal;
      file_filter?: string;
      turn_id?: string;
      displayContent?: string;
    }) => {
      const body: Record<string, unknown> = { content };
      if (model) body.model = model;
      if (file_filter) body.file_filter = file_filter;
      if (turn_id) body.turn_id = turn_id;
      const res = await apiPost<SendMessageResponse>(
        `/api/chat/conversations/${conversationId}/messages/`,
        body,
        signal,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to send message.",
        );
      }
      return res.data;
    },
    // Optimistic update pattern: write the placeholder user + "Thinking..."
    // assistant bubble directly into the messages cache so the UI renders
    // from a single source of truth. onSuccess replaces the placeholders
    // with real server data; onError rolls back. This eliminates the
    // duplicate-bubble race that happens when the component keeps a second
    // `pendingMessages` state in parallel with the query cache.
    onMutate: async (variables) => {
      type InfiniteMessages = { pages: PaginatedMessages[]; pageParams: (number | null)[] };
      const key = ["chat", "messages", variables.conversationId] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InfiniteMessages>(key);
      const stamp = Date.now();
      // Use a high-entropy id so a rapid double-send never collides.
      const nonce = Math.random().toString(36).slice(2, 8);
      const userId = `${OPTIMISTIC_PREFIX}user-${stamp}-${nonce}`;
      const assistantId = `${OPTIMISTIC_PREFIX}asst-${stamp}-${nonce}`;
      const optimisticUser: ChatMessage = {
        // We cast to number to satisfy the ChatMessage type — the UI detects
        // optimistic rows via the string prefix on the id before treating it
        // as a real numeric id.
        id: userId as unknown as number,
        role: "user",
        content: variables.displayContent ?? variables.content,
        sources: null,
        turn_id: variables.turn_id ?? null,
        created_at: new Date().toISOString(),
      };
      const optimisticAssistant: ChatMessage = {
        id: assistantId as unknown as number,
        role: "assistant",
        content: "Thinking...",
        sources: null,
        turn_id: variables.turn_id ?? null,
        created_at: new Date().toISOString(),
      };
      // Append optimistic rows to the first page (most recent messages).
      queryClient.setQueryData<InfiniteMessages>(key, (old) => {
        const emptyPage: PaginatedMessages = { messages: [], next_cursor: null, has_more: false };
        const pages = old?.pages?.length ? [...old.pages] : [emptyPage];
        const pageParams = old?.pageParams?.length ? [...old.pageParams] : [null];
        // Page 0 = most recent messages — append to its end.
        pages[0] = { ...pages[0], messages: [...pages[0].messages, optimisticUser, optimisticAssistant] };
        return { pages, pageParams };
      });
      return { previous, userId, assistantId };
    },
    onError: (_err, variables, context) => {
      // Roll back to the state before the optimistic insert.
      if (!context) return;
      type InfiniteMessages = { pages: PaginatedMessages[]; pageParams: (number | null)[] };
      queryClient.setQueryData<InfiniteMessages>(
        ["chat", "messages", variables.conversationId],
        context.previous ?? undefined,
      );
    },
    onSuccess: (data, variables, context) => {
      // Replace the optimistic rows with the real messages returned by the
      // server. Any concurrent optimistic entries for different turns stay
      // intact.
      type InfiniteMessages = { pages: PaginatedMessages[]; pageParams: (number | null)[] };
      const key = ["chat", "messages", variables.conversationId] as const;
      queryClient.setQueryData<InfiniteMessages>(key, (old) => {
        if (!old) return old;
        const pages = old.pages.map((page, i) => {
          if (i !== 0) return page;
          let msgs = page.messages;
          if (context) {
            msgs = msgs.filter(
              (m) =>
                (m.id as unknown as string) !== context.userId &&
                (m.id as unknown as string) !== context.assistantId,
            );
          }
          return { ...page, messages: [...msgs, data.user_message, data.assistant_message] };
        });
        return { ...old, pages };
      });
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

type InfiniteMessages = { pages: PaginatedMessages[]; pageParams: (number | null)[] };

/**
 * Streaming send: shows the assistant answer token-by-token as the model
 * generates it, instead of blocking until the full response is ready.
 *
 * Mirrors useSendMessage's optimistic-cache pattern: insert a user bubble + an
 * empty assistant bubble, then append tokens to the assistant bubble as SSE
 * events arrive. On completion, swap the optimistic pair for the real
 * server-persisted messages.
 */
export function useStreamingSend() {
  const queryClient = useQueryClient();
  // Track which conversations currently have an in-flight stream. A Set (not a
  // boolean) lets multiple chats stream concurrently — switching to another
  // chat no longer cancels an in-progress generation, and the sidebar can show
  // a per-chat loader.
  const [streamingIds, setStreamingIds] = useState<Set<number>>(new Set());
  // Per-turn response timing (keyed by turn_id). `end === null` while the
  // stream is in flight so the UI can tick a live timer; it freezes on
  // completion. Session-only — not persisted across a full page refresh.
  const [timings, setTimings] = useState<Record<string, { start: number; end: number | null }>>({});

  const markStreaming = useCallback((id: number, on: boolean) => {
    setStreamingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const streamSend = useCallback(
    async (params: {
      conversationId: number;
      content: string;
      displayContent?: string;
      model?: string;
      file_filter?: string;
      turn_id: string;
      signal?: AbortSignal;
    }) => {
      const { conversationId, content, displayContent, model, file_filter, turn_id, signal } = params;
      const key = ["chat", "messages", conversationId] as const;

      const stamp = Date.now();
      const nonce = Math.random().toString(36).slice(2, 8);
      const userId = `${OPTIMISTIC_PREFIX}user-${stamp}-${nonce}`;
      const assistantId = `${OPTIMISTIC_PREFIX}asst-${stamp}-${nonce}`;

      const optimisticUser: ChatMessage = {
        id: userId as unknown as number,
        role: "user",
        content: displayContent ?? content,
        sources: null,
        turn_id,
        created_at: new Date().toISOString(),
      };
      const optimisticAssistant: ChatMessage = {
        id: assistantId as unknown as number,
        role: "assistant",
        content: "",
        sources: null,
        turn_id,
        created_at: new Date().toISOString(),
        model: model ?? null,
      };

      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InfiniteMessages>(key);
      queryClient.setQueryData<InfiniteMessages>(key, (old) => {
        const emptyPage: PaginatedMessages = { messages: [], next_cursor: null, has_more: false };
        const pages = old?.pages?.length ? [...old.pages] : [emptyPage];
        const pageParams = old?.pageParams?.length ? [...old.pageParams] : [null];
        pages[0] = { ...pages[0], messages: [...pages[0].messages, optimisticUser, optimisticAssistant] };
        return { pages, pageParams };
      });

      // Update the optimistic assistant bubble's content in place.
      const setAssistant = (mutator: (m: ChatMessage) => ChatMessage) => {
        queryClient.setQueryData<InfiniteMessages>(key, (old) => {
          if (!old) return old;
          const pages = old.pages.map((page, i) => {
            if (i !== 0) return page;
            return {
              ...page,
              messages: page.messages.map((m) =>
                (m.id as unknown as string) === assistantId ? mutator(m) : m,
              ),
            };
          });
          return { ...old, pages };
        });
      };

      let accumulated = "";
      let aiError: string | null = null;

      setTimings((prev) => ({ ...prev, [turn_id]: { start: Date.now(), end: null } }));
      markStreaming(conversationId, true);
      try {
        const res = await fetch(`/api/chat-stream?conversation_id=${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal,
          body: JSON.stringify({
            content,
            turn_id,
            ...(model ? { model } : {}),
            ...(file_filter ? { file_filter } : {}),
          }),
        });

        if (res.status === 401 && typeof window !== "undefined") {
          // Session expired mid-session — bounce to login (matches api.ts).
          window.location.href = "/login";
          throw new Error("Session expired.");
        }
        if (!res.ok || !res.body) {
          let msg = "Failed to send message.";
          try {
            const j = await res.json();
            msg = j?.error?.message || j?.error || msg;
          } catch { /* ignore */ }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Parse the SSE stream: events are separated by a blank line, each
        // payload line starts with "data: ".
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const lineRaw = evt.split("\n").find((l) => l.startsWith("data: "));
            if (!lineRaw) continue;
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(lineRaw.slice(6));
            } catch {
              continue;
            }
            if (typeof data.token === "string") {
              accumulated += data.token;
              setAssistant((m) => ({ ...m, content: accumulated }));
            }
            if (data.ai_error) aiError = String(data.ai_error);
            if (data.done) {
              const assistantMsg = data.assistant_message as ChatMessage | undefined;
              const userMsg = data.user_message as ChatMessage | undefined;
              // Replace optimistic pair with real persisted messages.
              queryClient.setQueryData<InfiniteMessages>(key, (old) => {
                if (!old) return old;
                const pages = old.pages.map((page, i) => {
                  if (i !== 0) return page;
                  const msgs = page.messages.filter(
                    (m) =>
                      (m.id as unknown as string) !== userId &&
                      (m.id as unknown as string) !== assistantId,
                  );
                  const finalUser = userMsg ?? optimisticUser;
                  const finalAssistant = assistantMsg ?? {
                    ...optimisticAssistant,
                    content: accumulated,
                  };
                  return { ...page, messages: [...msgs, finalUser, finalAssistant] };
                });
                return { ...old, pages };
              });
            }
          }
        }
        queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
        return { aiError };
      } catch (err) {
        // On abort, keep what streamed so far but finalize the assistant bubble
        // with whatever text arrived. On hard error, roll back to previous.
        if ((err as Error)?.name === "AbortError") {
          setAssistant((m) => ({ ...m, content: accumulated || m.content }));
          return { aiError: null, aborted: true };
        }
        if (previous !== undefined) {
          queryClient.setQueryData<InfiniteMessages>(key, previous);
        }
        throw err;
      } finally {
        setTimings((prev) =>
          prev[turn_id] ? { ...prev, [turn_id]: { ...prev[turn_id], end: Date.now() } } : prev,
        );
        markStreaming(conversationId, false);
      }
    },
    [queryClient, markStreaming],
  );

  return { streamSend, streamingIds, timings };
}

export function useDeleteTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      turnId,
    }: {
      turnId: string;
      conversationId?: number | null;
    }) => {
      const res = await apiDelete(`/api/chat/turns/${encodeURIComponent(turnId)}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to cancel turn.",
        );
      }
      return res.data;
    },
    onSuccess: (_data, variables) => {
      if (variables.conversationId) {
        queryClient.invalidateQueries({
          queryKey: ["chat", "messages", variables.conversationId],
        });
      }
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: number; title: string }) => {
      const res = await apiPatch<{ conversation: Conversation }>(
        `/api/chat/conversations/${conversationId}/`,
        { title },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to rename conversation.",
        );
      }
      return res.data.conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/** Toggle pin (and re-order the sidebar — pinned chats float to the top). */
export function useSetPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, pinned }: { conversationId: number; pinned: boolean }) => {
      const res = await apiPatch<{ conversation: Conversation }>(
        `/api/chat/conversations/${conversationId}/`,
        { pinned },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to update pin.",
        );
      }
      return res.data.conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/** Archive / unarchive — archived chats drop out of the default sidebar list. */
export function useSetArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, archived }: { conversationId: number; archived: boolean }) => {
      const res = await apiPatch<{ conversation: Conversation }>(
        `/api/chat/conversations/${conversationId}/`,
        { archived },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to archive conversation.",
        );
      }
      return res.data.conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

export function useDuplicateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await apiPost<{ conversation: Conversation }>(
        `/api/chat/conversations/${conversationId}/duplicate/`,
        {},
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to duplicate conversation.",
        );
      }
      return res.data.conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await apiDelete(
        `/api/chat/conversations/${conversationId}/`,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete conversation.",
        );
      }
      return res.data;
    },
    // Optimistically remove the conversation from the sidebar immediately so
    // it disappears on click — the user can't trigger a second delete on a
    // row that's already gone. Rolled back if the server call fails.
    onMutate: async (conversationId: number) => {
      type InfiniteConvs = { pages: PaginatedConversations[]; pageParams: (string | null)[] };
      const key = ["chat", "conversations"] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InfiniteConvs>(key);
      queryClient.setQueryData<InfiniteConvs>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            conversations: p.conversations.filter((c) => c.id !== conversationId),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      const ctx = context as { previous?: unknown } | undefined;
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(["chat", "conversations"], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}

export function useDeleteMessage(conversationId?: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: number) => {
      const res = await apiDelete(`/api/chat/messages/${messageId}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete message.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["chat", "messages"] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Voice transcription hook (offline whisper)
// ---------------------------------------------------------------------------

export interface TranscribeResult {
  text: string;
  language: string;
  duration_ms: number;
}

export function useTranscribeAudio() {
  return useMutation({
    mutationFn: async ({ blob, language }: { blob: Blob; language?: string }) => {
      const res = await apiUploadBlob<TranscribeResult>(
        "/api/chat/transcribe/",
        blob,
        "audio",
        "voice.webm",
        language ? { language } : undefined,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to transcribe audio.",
        );
      }
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// System health hook
// ---------------------------------------------------------------------------

export interface SystemHealth {
  status: string;
  ollama: boolean;
  database: boolean;
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => {
      const res = await apiGet<SystemHealth>("/api/rag/health");
      if (!res.ok) return { status: "offline", ollama: false, database: false } as SystemHealth;
      return res.data;
    },
    refetchInterval: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Whisper service health hook
// ---------------------------------------------------------------------------

export interface WhisperModelInfo {
  name: string;
  size: number;
  size_label: string;
}

export interface WhisperAvailableModel {
  name: string;
}

export interface WhisperHealth {
  connected: boolean;
  model: string;
  has_model: boolean;
  models: WhisperModelInfo[];
  available_models: WhisperAvailableModel[];
  endpoint: string;
  latency_ms?: number;
}

export function useWhisperHealth() {
  return useQuery({
    queryKey: ["system", "whisper-health"],
    queryFn: async () => {
      const res = await apiGet<WhisperHealth>("/api/system/services/whisper/health/");
      if (!res.ok) return { connected: false, model: "", has_model: false, models: [], available_models: [], endpoint: "" } as WhisperHealth;
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useWhisperModels() {
  return useQuery({
    queryKey: ["system", "whisper-models"],
    queryFn: async () => {
      const res = await apiGet<{ models: WhisperModelInfo[] }>("/api/system/services/whisper/models/");
      if (!res.ok) return [];
      return res.data.models;
    },
    // No interval — installed models only change on pull/delete, and those
    // mutations invalidate this query. Window focus catches cross-tab changes.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullWhisperModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiPost<{ status: string; model: string }>("/api/system/services/whisper/models/pull/", { name });
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message || "Failed to pull whisper model.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "whisper-models"] });
      queryClient.invalidateQueries({ queryKey: ["system", "whisper-health"] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}

export function useDeleteWhisperModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiDelete(`/api/system/services/whisper/models/${encodeURIComponent(name)}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message || "Failed to delete whisper model.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "whisper-models"] });
      queryClient.invalidateQueries({ queryKey: ["system", "whisper-health"] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}


// ---------------------------------------------------------------------------
// Provider connection test hook
// ---------------------------------------------------------------------------

export interface ProviderTestResult {
  connected: boolean;
  latency_ms?: number;
  error?: string;
}

export function useTestProvider() {
  return useMutation({
    mutationFn: async ({ endpoint, type }: { endpoint: string; type?: "ollama" | "openai" }) => {
      const res = await apiPost<ProviderTestResult>("/api/system/providers/test/", { endpoint, type });
      if (!res.ok) {
        throw new Error("Failed to test provider connection.");
      }
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Model hooks
// ---------------------------------------------------------------------------

export interface OllamaModel {
  id: string;
  name: string;
  size: string;
}

export function useOllamaModels() {
  return useQuery({
    queryKey: ["chat", "models"],
    queryFn: async () => {
      const res = await apiGet<{ models: OllamaModel[]; error?: string }>("/api/chat/models/");
      // The backend returns HTTP 200 with {models: [], error} when Ollama is
      // unreachable/busy (e.g. while generating embeddings for a large upload).
      // Throw so React Query keeps the last good list (keepPreviousData) and
      // retries — otherwise a transient empty would flip the chat page into the
      // "no model / download a model" guard even though models are installed.
      if (!res.ok) throw new Error("models fetch failed");
      if (res.data.error) throw new Error(res.data.error);
      return res.data.models;
    },
    // Installed models change only on pull/delete (those invalidate this
    // query). 30s interval + focus refetch is a cheap safety net.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: 2,
  });
}

/** All Ollama models including embeddings (Model Engines → Downloaded Models). */
export function useOllamaAllModels() {
  return useQuery({
    queryKey: ["chat", "models", "all"],
    queryFn: async () => {
      const res = await apiGet<{ models: OllamaModel[] }>("/api/chat/models/all/");
      if (!res.ok) return [];
      return res.data.models;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export interface EmbeddingModelsStatus {
  configured_embedding_model: string;
  installed: boolean;
  installed_embedding_models: { name: string; size: string }[];
  recommended: string[];
  error?: string;
}

export function useEmbeddingModelsStatus(enabled = true) {
  return useQuery({
    queryKey: ["chat", "embedding-models"],
    queryFn: async () => {
      const res = await apiGet<EmbeddingModelsStatus>("/api/chat/embedding-models/");
      if (!res.ok) {
        return {
          configured_embedding_model: "nomic-embed-text",
          installed: false,
          installed_embedding_models: [],
          recommended: [],
        } satisfies EmbeddingModelsStatus;
      }
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Check whether the machine can reach the Ollama model registry. Used to warn
 * the user before a model pull that would otherwise fail offline. Returns true
 * if online, false if not. Falls back to navigator.onLine if the backend probe
 * itself can't be reached.
 */
export async function checkOnline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false; // device has no network at all — fast path
  }
  try {
    const res = await apiGet<{ online: boolean }>("/api/system/connectivity/");
    if (res.ok && typeof res.data?.online === "boolean") {
      return res.data.online;
    }
  } catch {
    /* fall through */
  }
  // Backend probe unreachable — defer to the browser's coarse signal.
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function usePullModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiPost<{ status: string; model: string; error?: string }>(
        "/api/chat/models/pull/",
        { name },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to pull model.",
        );
      }
      if (res.data.status === "error") {
        throw new Error(res.data.error || "Failed to pull model.");
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "models", "all"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "embedding-models"] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiDelete(`/api/chat/models/${encodeURIComponent(name)}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete model.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "models", "all"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "embedding-models"] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
      queryClient.invalidateQueries({ queryKey: ["system", "model-config"] });
    },
  });
}

// ---------------------------------------------------------------------------
// File management hooks
// ---------------------------------------------------------------------------

export interface IndexedFile {
  id: string;
  name: string;
  size: number;
  chunks: number;
  type: string;
}

/**
 * List files indexed for a specific chat. When conversationId is null
 * (e.g., a new chat before any message), returns an empty list — the
 * backend strictly scopes by conversation_id, no global file access.
 */
export function useIndexedFiles(conversationId: number | null) {
  return useQuery({
    queryKey: ["chat", "files", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const res = await apiGet<{ files: IndexedFile[] }>(
        `/api/chat/files/?conversation_id=${conversationId}`,
      );
      if (!res.ok) return [];
      return res.data.files;
    },
    enabled: conversationId !== null,
    refetchOnWindowFocus: true,
  });
}

/** All indexed files across every chat (distinct) — for the dashboard total. */
export function useAllIndexedFiles() {
  return useQuery({
    queryKey: ["chat", "files", "all"],
    queryFn: async () => {
      const res = await apiGet<{ files: IndexedFile[] }>("/api/chat/files/?scope=all");
      if (!res.ok) return [];
      return res.data.files;
    },
    refetchOnWindowFocus: true,
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      conversationId,
      onProgress,
    }: {
      file: File;
      conversationId: number;
      onProgress?: (update: UploadProgressUpdate) => void;
    }) => {
      const res = await apiUploadWithProgress<{ file: IndexedFile }>(
        "/api/chat/files/upload/",
        file,
        { conversation_id: String(conversationId) },
        onProgress,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to upload file.",
        );
      }
      return { file: res.data.file, conversationId };
    },
    onSuccess: ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: ["chat", "files", conversationId],
      });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fileId,
      conversationId,
    }: {
      fileId: string;
      conversationId: number;
    }) => {
      const res = await apiDelete(
        `/api/chat/files/${fileId}/?conversation_id=${conversationId}`,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete file.",
        );
      }
      return { ...res.data, conversationId };
    },
    onSuccess: (data) => {
      const cid = (data as { conversationId: number }).conversationId;
      queryClient.invalidateQueries({ queryKey: ["chat", "files", cid] });
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Provider hooks
// ---------------------------------------------------------------------------

export interface ProviderData {
  id: string;
  name: string;
  icon: string;
  description: string;
  endpoint: string;
  type: "ollama" | "openai";
  is_default: boolean;
  is_connected: boolean;
  created_at: string;
  updated_at: string;
}

export function useProviders() {
  return useQuery({
    queryKey: ["system", "providers"],
    queryFn: async () => {
      const res = await apiGet<{ providers: ProviderData[] }>("/api/system/providers/");
      // Keep the last good provider list on a transient failure so the chat
      // page doesn't flash the "no active provider" guard while Ollama is busy.
      if (!res.ok) throw new Error("providers fetch failed");
      return res.data.providers;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: 2,
  });
}

export function useHasActiveProvider(): { active: boolean; isLoading: boolean } {
  const { data: providers = [], isLoading: providersLoading } = useProviders();
  // NOTE: intentionally NOT gating on live system health here. While Ollama is
  // busy (e.g. embedding a large upload) its health ping can transiently fail,
  // which would otherwise flip the chat page into the "no active provider"
  // guard. provider.is_connected is the sticky, user-meaningful signal — a
  // connected provider stays "active" through transient busy periods.
  const active = providers.some((p) => p.is_connected);
  return { active, isLoading: providersLoading };
}

export function useCreateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      icon?: string;
      description?: string;
      endpoint: string;
      type: "ollama" | "openai";
      is_default?: boolean;
    }) => {
      const res = await apiPost<{ provider: ProviderData }>("/api/system/providers/", data);
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to create provider.",
        );
      }
      return res.data.provider;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "providers"] });
    },
  });
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<{
      name: string;
      icon: string;
      description: string;
      endpoint: string;
      type: "ollama" | "openai";
      is_default: boolean;
      is_connected: boolean;
    }>) => {
      const res = await apiPatch<{ provider: ProviderData }>(`/api/system/providers/${id}/`, data);
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to update provider.",
        );
      }
      return res.data.provider;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "providers"] });
    },
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiDelete(`/api/system/providers/${id}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete provider.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "providers"] });
    },
  });
}

export function useSetDefaultProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiPost<{ provider: ProviderData }>(`/api/system/providers/${id}/set-default/`, {});
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to set default provider.",
        );
      }
      return res.data.provider;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "providers"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Provider models hook
// ---------------------------------------------------------------------------

export interface ProviderModelData {
  id: string;
  name: string;
  size: number;
  provider_id: string;
  provider_name: string;
}

export function useProviderModels(providerId: string | undefined) {
  return useQuery({
    queryKey: ["system", "provider-models", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const res = await apiGet<{ models: ProviderModelData[] }>(`/api/system/providers/${providerId}/models/`);
      if (!res.ok) return [];
      return res.data.models;
    },
    enabled: !!providerId,
  });
}

export function useAllProviderModels(providers: ProviderData[]) {
  const connectedIds = providers
    .filter((p) => p.is_connected)
    .map((p) => p.id)
    .sort()
    .join(",");

  return useQuery({
    queryKey: ["system", "all-provider-models", connectedIds],
    queryFn: async () => {
      const connected = providers.filter((p) => p.is_connected);
      if (connected.length === 0) return [];

      const results = await Promise.all(
        connected.map(async (p) => {
          const res = await apiGet<{ models: ProviderModelData[] }>(
            `/api/system/providers/${p.id}/models/`,
          );
          return res.ok ? res.data.models : [];
        }),
      );
      return results.flat();
    },
    enabled: connectedIds.length > 0,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Model config hooks
// ---------------------------------------------------------------------------

export interface ModelConfigData {
  chat_model: string;
  chat_provider_id: string | null;
  chat_provider_name: string;
  embedding_model: string;
  embedding_provider_id: string | null;
  embedding_provider_name: string;
  tts_model: string;
  tts_provider_id: string | null;
  tts_provider_name: string;
  summarizer_model: string;
}

const EMPTY_MODEL_CONFIG: ModelConfigData = {
  chat_model: "", chat_provider_id: null, chat_provider_name: "",
  embedding_model: "", embedding_provider_id: null, embedding_provider_name: "",
  tts_model: "", tts_provider_id: null, tts_provider_name: "",
  summarizer_model: "",
};

export function useModelConfig() {
  return useQuery({
    queryKey: ["system", "model-config"],
    queryFn: async () => {
      const res = await apiGet<{ config: ModelConfigData }>("/api/system/model-config/");
      if (!res.ok) return EMPTY_MODEL_CONFIG;
      return res.data.config;
    },
    refetchOnWindowFocus: true,
  });
}

export function useUpdateModelConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<ModelConfigData>) => {
      const res = await apiPatch<{ config: ModelConfigData }>("/api/system/model-config/", data);
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error?.message ||
            "Failed to save model configuration.",
        );
      }
      return res.data.config;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["system", "model-config"], data);
      queryClient.invalidateQueries({ queryKey: ["system", "model-config"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "embedding-models"] });
    },
  });
}
