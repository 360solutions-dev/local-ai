"use client";

import { useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  changelog: string[];
  error: string | null;
}

interface ApplyUpdateResponse {
  status: string;
  target_version: string;
}

/**
 * Check whether a newer version is available.
 * Uses useMutation (not useQuery) because this is triggered by
 * the user clicking a button, not auto-fetched on mount.
 */
export function useCheckUpdate() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiGet<UpdateInfo>("/api/system/updates/check/");
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: string })?.error || "Failed to check for updates.",
        );
      }
      return res.data;
    },
  });
}

/**
 * Trigger the update — pulls latest code and rebuilds all containers.
 * Returns immediately; the frontend then polls /api/system/info/ until
 * the backend comes back with the new version.
 */
export function useApplyUpdate() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<ApplyUpdateResponse>(
        "/api/system/updates/apply/",
        { confirm: true },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to apply update.",
        );
      }
      return res.data;
    },
  });
}
