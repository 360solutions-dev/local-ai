"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiDownload, apiGet, apiPatch, apiPost } from "@/lib/api";

interface InstanceInfo {
  version: string;
  instance_id: string;
  uptime_seconds: number;
  uptime_display: string;
  last_updated: string;
}

interface LoggingSettings {
  request_logging: boolean;
  debug_mode: boolean;
}

export function useInstanceInfo() {
  return useQuery({
    queryKey: ["system", "info"],
    queryFn: async () => {
      const res = await apiGet<InstanceInfo>("/api/system/info/");
      if (!res.ok) return null;
      return res.data;
    },
    refetchInterval: 60_000,
  });
}

export function useInstanceSettings() {
  return useQuery({
    queryKey: ["system", "settings"],
    queryFn: async () => {
      const res = await apiGet<{ settings: LoggingSettings }>("/api/system/settings/");
      if (!res.ok) return null;
      return res.data.settings;
    },
  });
}

export function useUpdateInstanceSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<LoggingSettings>) => {
      const res = await apiPatch<{ settings: LoggingSettings; error?: { message?: string } }>(
        "/api/system/settings/",
        data,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to update settings.",
        );
      }
      return res.data;
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["system", "settings"] });
      const previous = queryClient.getQueryData<LoggingSettings | null>(["system", "settings"]);
      queryClient.setQueryData(["system", "settings"], (old: LoggingSettings | null) => {
        if (!old) return old;
        return { ...old, ...data };
      });
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["system", "settings"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "settings"] });
    },
  });
}

export function useExportChatHistory() {
  return useMutation({
    mutationFn: () => apiDownload("/api/system/export/chat-history/", "chat-history.json"),
  });
}

export function useExportSettings() {
  return useMutation({
    mutationFn: () => apiDownload("/api/system/export/settings/", "settings.json"),
  });
}

export function useExportAllData() {
  return useMutation({
    mutationFn: () => apiDownload("/api/system/export/all/", "local-ai-export.zip"),
  });
}

export function useResetInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ message?: string; error?: { message?: string } }>(
        "/api/system/danger/reset-instance/",
        { confirm: true },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message || "Reset failed.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useDeleteAllData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ message?: string; error?: { message?: string } }>(
        "/api/system/danger/delete-all-data/",
        { confirm: true },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message || "Deletion failed.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system"] });
    },
  });
}

export function useFactoryReset() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ message?: string; error?: { message?: string } }>(
        "/api/system/danger/factory-reset/",
        { confirm: true },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Factory reset failed.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      document.cookie = "setup_complete=; path=/; max-age=0";
      document.cookie = "access_token=; path=/; max-age=0";
      document.cookie = "refresh_token=; path=/api/auth/token/refresh/; max-age=0";
      queryClient.cancelQueries();
      queryClient.clear();
      window.location.href = "/onboarding";
    },
  });
}
