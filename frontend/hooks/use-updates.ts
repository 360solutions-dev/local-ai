"use client";

import { useMutation } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  changelog: string[];
  error: string | null;
}

export interface UpdateEvent {
  stage: string;
  status: string;
  percent: number | null;
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
 * Open the update SSE stream and invoke onEvent for every parsed event.
 * Resolves once the stream ends (either complete, error, or connection drop
 * during container restart). Connection drop is expected — the updater
 * itself restarts as part of `docker compose up -d`.
 */
export async function streamUpdate(
  onEvent: (event: UpdateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch("/api/system/updates/apply/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ confirm: true }),
    signal,
  });

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      message = data?.error?.message || data?.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
      try {
        const data = JSON.parse(jsonStr) as UpdateEvent;
        onEvent(data);
      } catch {
        // Non-JSON line (SSE comment / keep-alive) — skip
      }
    }
  }
}
