"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

interface StorageDisk {
  total: number;
  used: number;
  free: number;
}

interface StorageBreakdown {
  models: number;
  system_models: number;
  uploaded_files: number;
  vector_embeddings: number;
  chat_history: number;
}

export interface StorageInfo {
  disk: StorageDisk;
  breakdown: StorageBreakdown;
  total_tracked: number;
}

export function useStorageInfo() {
  return useQuery({
    queryKey: ["system", "storage"],
    queryFn: async () => {
      const res = await apiGet<StorageInfo>("/api/system/storage/");
      if (!res.ok) return null;
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useClearCache() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ message?: string; cleared_bytes?: number; error?: { message?: string } }>(
        "/api/system/storage/clear-cache/",
        {},
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to clear cache.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "storage"] });
    },
  });
}

/**
 * Format bytes into a human-readable string (e.g., "1.2 GB", "340 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
