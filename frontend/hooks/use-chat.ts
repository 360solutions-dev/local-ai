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
    staleTime: 0,
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

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      content,
      model,
      signal,
      file_filter,
    }: {
      conversationId: number;
      content: string;
      model?: string;
      signal?: AbortSignal;
      file_filter?: string;
    }) => {
      const body: Record<string, unknown> = { content };
      if (model) body.model = model;
      if (file_filter) body.file_filter = file_filter;
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["chat", "messages", variables.conversationId],
      });
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
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

export function useDeleteMessage() {
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
      queryClient.invalidateQueries({ queryKey: ["chat", "messages"] });
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
