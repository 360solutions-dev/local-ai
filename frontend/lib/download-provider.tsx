"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

interface DownloadState {
  modelName: string;
  percent: number;
  status: string;
}

interface DownloadContextValue {
  download: DownloadState | null;
  isPulling: boolean;
  startPull: (name: string) => void;
  whisperDownload: DownloadState | null;
  isWhisperPulling: boolean;
  startWhisperPull: (name: string) => void;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Warn user before closing/reloading tab during download
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isPulling) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isPulling]);

  const startPull = useCallback(
    async (name: string) => {
      if (isPulling) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setIsPulling(true);
      setDownload({ modelName: name, percent: 0, status: `Pulling ${name}...` });

      try {
        const resp = await fetch("/api/models/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
          signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

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
            // Extract JSON from SSE "data: " prefix or try raw line
            const jsonStr = trimmed.startsWith("data: ")
              ? trimmed.slice(6)
              : trimmed;
            try {
              const data = JSON.parse(jsonStr);
              if (data.status === "error") {
                throw new Error(data.error || "Pull failed");
              }
              setDownload((prev) => ({
                modelName: prev?.modelName || name,
                percent: data.percent ?? prev?.percent ?? 0,
                status:
                  data.status === "success"
                    ? "Complete!"
                    : data.status || prev?.status || "",
              }));
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                (parseErr.message === "Pull failed" ||
                  parseErr.message.startsWith("Pull failed"))
              ) {
                throw parseErr;
              }
              // Non-JSON line — skip (e.g. SSE comments or keep-alive)
            }
          }
        }

        setDownload((prev) => ({
          modelName: prev?.modelName || name,
          percent: 100,
          status: "Complete!",
        }));
        queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
        queryClient.invalidateQueries({ queryKey: ["chat", "models", "all"] });
        queryClient.invalidateQueries({ queryKey: ["chat", "embedding-models"] });
        queryClient.invalidateQueries({ queryKey: ["system", "storage"] });

        // Keep "Complete!" visible briefly
        setTimeout(() => {
          setDownload(null);
          setIsPulling(false);
        }, 2000);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setDownload((prev) => ({
            modelName: prev?.modelName || name,
            percent: 0,
            status: `Error: ${(err as Error).message}`,
          }));
          setTimeout(() => {
            setDownload(null);
            setIsPulling(false);
          }, 3000);
        } else {
          setDownload(null);
          setIsPulling(false);
        }
      }
    },
    [isPulling, queryClient],
  );

  // ---- Whisper model pull (SSE, same pattern) ----
  const [whisperDownload, setWhisperDownload] = useState<DownloadState | null>(null);
  const [isWhisperPulling, setIsWhisperPulling] = useState(false);
  const whisperAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isWhisperPulling) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isWhisperPulling]);

  const startWhisperPull = useCallback(
    async (name: string) => {
      if (isWhisperPulling) return;

      const controller = new AbortController();
      whisperAbortRef.current = controller;
      setIsWhisperPulling(true);
      setWhisperDownload({ modelName: name, percent: 0, status: `Pulling ${name}...` });

      try {
        const resp = await fetch("/api/whisper-pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
          signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
            try {
              const data = JSON.parse(jsonStr);
              if (data.status === "error") {
                throw new Error(data.error || "Pull failed");
              }
              setWhisperDownload((prev) => ({
                modelName: prev?.modelName || name,
                percent: data.percent ?? prev?.percent ?? 0,
                status:
                  data.status === "success"
                    ? "Complete!"
                    : data.status || prev?.status || "",
              }));
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                (parseErr.message === "Pull failed" ||
                  parseErr.message.startsWith("Pull failed"))
              ) {
                throw parseErr;
              }
            }
          }
        }

        setWhisperDownload((prev) => ({
          modelName: prev?.modelName || name,
          percent: 100,
          status: "Complete!",
        }));
        queryClient.invalidateQueries({ queryKey: ["system", "whisper-models"] });
        queryClient.invalidateQueries({ queryKey: ["system", "whisper-health"] });
        queryClient.invalidateQueries({ queryKey: ["system", "storage"] });

        setTimeout(() => {
          setWhisperDownload(null);
          setIsWhisperPulling(false);
        }, 2000);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setWhisperDownload((prev) => ({
            modelName: prev?.modelName || name,
            percent: 0,
            status: `Error: ${(err as Error).message}`,
          }));
          setTimeout(() => {
            setWhisperDownload(null);
            setIsWhisperPulling(false);
          }, 3000);
        } else {
          setWhisperDownload(null);
          setIsWhisperPulling(false);
        }
      }
    },
    [isWhisperPulling, queryClient],
  );

  return (
    <DownloadContext.Provider value={{ download, isPulling, startPull, whisperDownload, isWhisperPulling, startWhisperPull }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error("useDownload must be used within DownloadProvider");
  return ctx;
}
