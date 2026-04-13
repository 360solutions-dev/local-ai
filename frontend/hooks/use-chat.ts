"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: string[] | null;
  turn_id: string | null;
  created_at: string;
}

interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  ai_error?: string;
}

export function useConversations() {
  return useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: async () => {
      const res = await apiGet<{ conversations: Conversation[] }>(
        "/api/chat/conversations/",
      );
      if (!res.ok) return [];
      return res.data.conversations;
    },
    refetchOnWindowFocus: true,
  });
}

export function useConversationMessages(conversationId: number | null) {
  return useQuery({
    queryKey: ["chat", "messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const res = await apiGet<{ messages: ChatMessage[] }>(
        `/api/chat/conversations/${conversationId}/messages/`,
      );
      if (!res.ok) return [];
      return res.data.messages;
    },
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
      const key = ["chat", "messages", variables.conversationId] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatMessage[]>(key) ?? [];
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
      queryClient.setQueryData<ChatMessage[]>(key, [
        ...previous,
        optimisticUser,
        optimisticAssistant,
      ]);
      return { previous, userId, assistantId };
    },
    onError: (_err, variables, context) => {
      // Roll back to the state before the optimistic insert.
      if (!context) return;
      queryClient.setQueryData<ChatMessage[]>(
        ["chat", "messages", variables.conversationId],
        context.previous,
      );
    },
    onSuccess: (data, variables, context) => {
      // Replace the optimistic rows with the real messages returned by the
      // server. Any concurrent optimistic entries for different turns stay
      // intact.
      const key = ["chat", "messages", variables.conversationId] as const;
      queryClient.setQueryData<ChatMessage[]>(key, (old = []) => {
        const filtered = context
          ? old.filter(
              (m) =>
                (m.id as unknown as string) !== context.userId &&
                (m.id as unknown as string) !== context.assistantId,
            )
          : old;
        return [...filtered, data.user_message, data.assistant_message];
      });
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
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
      const res = await apiGet<{ models: OllamaModel[] }>("/api/chat/models/");
      if (!res.ok) return [];
      return res.data.models;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
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

export function useIndexedFiles() {
  return useQuery({
    queryKey: ["chat", "files"],
    queryFn: async () => {
      const res = await apiGet<{ files: IndexedFile[] }>("/api/chat/files/");
      if (!res.ok) return [];
      return res.data.files;
    },
    refetchOnWindowFocus: true,
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const res = await apiUpload<{ file: IndexedFile }>(
        "/api/chat/files/upload/",
        file,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as unknown as { error?: { message?: string } })?.error
            ?.message || "Failed to upload file.",
        );
      }
      return res.data.file;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "files"] });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      const res = await apiDelete(`/api/chat/files/${fileId}/`);
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to delete file.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "files"] });
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
      if (!res.ok) return [];
      return res.data.providers;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useHasActiveProvider(): { active: boolean; isLoading: boolean } {
  const { data: providers = [], isLoading: providersLoading } = useProviders();
  const { data: health, isLoading: healthLoading } = useSystemHealth();
  const isLoading = providersLoading || healthLoading;
  const active = providers.some((p) => {
    if (p.name === "Ollama") return p.is_connected && (health?.ollama ?? true);
    return p.is_connected;
  });
  return { active, isLoading };
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "model-config"] });
    },
  });
}
