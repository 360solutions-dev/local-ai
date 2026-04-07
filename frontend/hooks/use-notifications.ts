"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "@/lib/api";

interface NotificationPreferences {
  model_download: boolean;
  file_indexing: boolean;
  system_errors: boolean;
}

// Query: fetch notification preferences
export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: async () => {
      const res = await apiGet<{ preferences: NotificationPreferences }>(
        "/api/notifications/preferences/",
      );
      if (!res.ok) return null;
      return res.data.preferences;
    },
  });
}

// Mutation: update notification preferences with optimistic updates
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<NotificationPreferences>) => {
      const res = await apiPatch<{ preferences: NotificationPreferences }>(
        "/api/notifications/preferences/",
        data as Record<string, unknown>,
      );
      if (!res.ok) {
        throw new Error("Failed to update notification preferences.");
      }
      return res.data.preferences;
    },
    // Optimistic update: toggle instantly in UI before API responds
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["notifications", "preferences"] });
      const previous = queryClient.getQueryData<NotificationPreferences | null>(["notifications", "preferences"]);
      queryClient.setQueryData(["notifications", "preferences"], (old: NotificationPreferences | null) => {
        if (!old) return { model_download: true, file_indexing: true, system_errors: true, ...data };
        return { ...old, ...data };
      });
      return { previous };
    },
    // Revert on error
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["notifications", "preferences"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] });
    },
  });
}
