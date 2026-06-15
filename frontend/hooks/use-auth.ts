"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

export interface NotificationPreferences {
  model_download: boolean;
  file_indexing: boolean;
  system_errors: boolean;
}

interface UserInfo {
  id: number;
  email: string;
  display_name: string;
  is_staff: boolean;
  date_joined: string;
  notification_preferences: NotificationPreferences;
  has_recovery_code: boolean;
}

// Query: fetch current user (shared across SidebarUser + Settings)
export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await apiGet<{ user: UserInfo }>("/api/auth/me/");
      if (!res.ok) return null;
      return res.data.user;
    },
  });
}

// Mutation: login
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await apiPost<{ user: UserInfo; error?: { message: string } }>(
        "/api/auth/login/",
        credentials,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Invalid email or password.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      router.push("/dashboard");
    },
  });
}

// Mutation: logout
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiPost("/api/auth/logout/", {});
    },
    onSuccess: () => {
      document.cookie = "setup_complete=; path=/; max-age=0";
      queryClient.clear();
      router.push("/login");
    },
  });
}

// Mutation: register (onboarding)
export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { display_name: string; email: string; password: string }) => {
      const res = await apiPost<{ user: UserInfo; recovery_code?: string; error?: { message?: string; details?: Record<string, string[]> } }>(
        "/api/auth/register/",
        data,
      );
      if (!res.ok) {
        const err = res.data as { error?: { message?: string; details?: Record<string, string[]> } };
        const details = err?.error?.details;
        if (details) {
          const firstField = Object.keys(details)[0];
          throw new Error(details[firstField]?.[0] || err?.error?.message || "Registration failed.");
        }
        throw new Error(err?.error?.message || "Registration failed.");
      }
      return res.data;
    },
    onSuccess: () => {
      document.cookie = "setup_complete=true; path=/; max-age=31536000";
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

// Mutation: update profile (display name)
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { display_name: string }) => {
      const res = await apiPatch<{ user: UserInfo; error?: { message?: string } }>(
        "/api/auth/me/",
        data,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to update profile.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

// Mutation: update notification preferences (via /api/auth/me/) with optimistic update
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (prefs: Partial<NotificationPreferences>) => {
      const res = await apiPatch<{ user: UserInfo; error?: { message?: string } }>(
        "/api/auth/me/",
        { notification_preferences: prefs },
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to update notification preferences.",
        );
      }
      return res.data;
    },
    onMutate: async (prefs) => {
      await queryClient.cancelQueries({ queryKey: ["auth", "me"] });
      const previous = queryClient.getQueryData<UserInfo | null>(["auth", "me"]);
      queryClient.setQueryData(["auth", "me"], (old: UserInfo | null) => {
        if (!old) return old;
        return {
          ...old,
          notification_preferences: {
            ...old.notification_preferences,
            ...prefs,
          },
        };
      });
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["auth", "me"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

// Mutation: change password (from settings)
export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: { current_password: string; new_password: string }) => {
      const res = await apiPost<{ message?: string; error?: { message?: string } }>(
        "/api/auth/change-password/",
        data,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to change password.",
        );
      }
      return res.data;
    },
  });
}

// Mutation: reset password (step 2 — token + new password → returns next recovery_code)
export function useResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { token: string; new_password: string }) => {
      const res = await apiPost<{ message?: string; recovery_code?: string; error?: { message?: string } }>(
        "/api/auth/reset-password/",
        data,
      );
      if (!res.ok) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to reset password.",
        );
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

// Mutation: verify recovery code (step 1 — email + code → short-lived reset token)
export function useVerifyRecoveryCode() {
  return useMutation({
    mutationFn: async (data: { email: string; recovery_code: string }) => {
      const res = await apiPost<{ reset_token?: string; error?: { message?: string } }>(
        "/api/auth/recovery/verify/",
        data,
      );
      if (!res.ok || !res.data?.reset_token) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Invalid email or recovery code.",
        );
      }
      return res.data as { reset_token: string };
    },
  });
}

// Mutation: regenerate recovery code (authenticated — from Settings → Security)
export function useRegenerateRecoveryCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ recovery_code?: string; error?: { message?: string } }>(
        "/api/auth/recovery/regenerate/",
        {},
      );
      if (!res.ok || !res.data?.recovery_code) {
        throw new Error(
          (res.data as { error?: { message?: string } })?.error?.message ||
            "Failed to regenerate recovery code.",
        );
      }
      return res.data as { recovery_code: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
