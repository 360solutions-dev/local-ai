"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import type { UpdateInfo } from "./use-updates";

const CACHE_KEY = "updateNotifierCache";
const DISMISSED_KEY = "updateNotifierDismissed";
const POLL_INTERVAL_MS = 30 * 60 * 1000;

interface CachedUpdate {
  current_version: string;
  latest_version: string;
  update_available: boolean;
}

export function useUpdateNotifier() {
  const [info, setInfo] = useState<CachedUpdate | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setInfo(JSON.parse(cached) as CachedUpdate);
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (dismissed) setDismissedVersion(dismissed);
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  const check = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const res = await apiGet<UpdateInfo>("/api/system/updates/check/");
    if (!res.ok || !res.data || res.data.error) return;
    const next: CachedUpdate = {
      current_version: res.data.current_version,
      latest_version: res.data.latest_version,
      update_available: res.data.update_available,
    };
    setInfo(next);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void check();
    window.addEventListener("online", check);
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", check);
      clearInterval(interval);
    };
  }, [check]);

  const dismiss = useCallback(() => {
    if (!info?.latest_version) return;
    try {
      localStorage.setItem(DISMISSED_KEY, info.latest_version);
    } catch {
      // ignore
    }
    setDismissedVersion(info.latest_version);
  }, [info]);

  const shouldShow =
    !!info?.update_available &&
    !!info.latest_version &&
    info.latest_version !== dismissedVersion;

  return {
    shouldShow,
    latestVersion: info?.latest_version ?? null,
    currentVersion: info?.current_version ?? null,
    dismiss,
    refresh: check,
  };
}
