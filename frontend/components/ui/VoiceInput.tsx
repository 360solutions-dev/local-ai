"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { useTranscribeAudio } from "@/hooks/use-chat";
import { useTranslation } from "@/lib/i18n";
import ErrorAlert from "./ErrorAlert";

interface VoiceInputProps {
  open: boolean;
  onClose: () => void;
  onTranscribed: (text: string) => void;
  language?: string;
  /** Active whisper model name shown as a badge, e.g. "base" */
  activeModel?: string;
}

// Hard cap on recording length — keeps the upload bounded and matches the
// Django /api/chat/transcribe/ size guard.
const MAX_RECORD_SECONDS = 60;

type Phase = "idle" | "recording" | "transcribing";

export default function VoiceInput({ open, onClose, onTranscribed, language, activeModel }: VoiceInputProps) {
  const { t } = useTranslation();
  const transcribe = useTranscribeAudio();

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  // Tracks whether the user explicitly cancelled (via X) so the recorder's
  // onstop handler skips the upload + auto-send path. Refs (not state) because
  // onstop fires asynchronously after setState would have batched.
  const cancelledRef = useRef(false);

  // Reset when the overlay closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setElapsed(0);
      setError("");
    }
  }, [open]);

  // Tear down any active recording when the component unmounts or closes.
  useEffect(() => {
    return () => {
      stopTracks();
      clearTimer();
    };
  }, []);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function handleStart() {
    setError("");
    cancelledRef.current = false;
    chunksRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t("chat.voiceNotSupported"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Whisper downsamples to 16kHz internally — request mono at 16kHz
          // when the browser/OS allows so we upload less data.
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      setError(t("chat.micPermissionDenied"));
      return;
    }

    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      // webm/opus is the most widely supported MediaRecorder format and
      // ffmpeg in the whisper container decodes it natively.
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    } catch {
      // Fall back to whatever default the browser supports (Safari, etc.).
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        stopTracks();
        setError(t("chat.voiceNotSupported"));
        return;
      }
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stopTracks();
      clearTimer();

      if (cancelledRef.current) {
        setPhase("idle");
        setElapsed(0);
        return;
      }

      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];

      if (blob.size === 0) {
        setPhase("idle");
        setError(t("chat.voiceError"));
        return;
      }

      setPhase("transcribing");
      try {
        const result = await transcribe.mutateAsync({ blob, language });
        const text = result.text.trim();
        if (!text) {
          setPhase("idle");
          setError(t("chat.voiceNoSpeech"));
          return;
        }
        onTranscribed(text);
        onClose();
      } catch (err) {
        setPhase("idle");
        setError(err instanceof Error ? err.message : t("chat.voiceError"));
      }
    };

    recorder.start();
    setPhase("recording");
    setElapsed(0);

    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(secs);
      if (secs >= MAX_RECORD_SECONDS) {
        // Auto-stop on the cap so we never send oversized uploads.
        handleStop();
      }
    }, 250);
  }

  function handleStop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop(); // triggers onstop, which will short-circuit
    } else {
      stopTracks();
      clearTimer();
    }
    onClose();
  }

  if (!open) return null;

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.voiceInput")}
    >
      <div className="w-[min(420px,90vw)] bg-bg-elevated border border-border rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-5">
        <div className="w-full flex items-center justify-between">
          <div className="text-[0.95rem] font-semibold text-text flex items-center gap-2">
            {t("chat.voiceInput")}
            {activeModel && (
              <span className="font-mono text-[0.72rem] text-accent bg-accent/15 px-2 py-0.5 rounded">{activeModel} · Whisper</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="bg-transparent border-none text-text-dim cursor-pointer p-1 rounded transition-colors hover:text-danger"
            title={t("chat.cancel")}
            aria-label={t("chat.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Mic visualization */}
        <div className="relative flex items-center justify-center w-32 h-32">
          {phase === "recording" && (
            <span className="absolute inset-0 rounded-full bg-danger/20 animate-ping" />
          )}
          <div
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-colors ${
              phase === "recording"
                ? "bg-danger/15 text-danger border-2 border-danger"
                : phase === "transcribing"
                  ? "bg-accent/15 text-accent border-2 border-accent"
                  : "bg-bg-card text-text-muted border-2 border-border"
            }`}
          >
            {phase === "transcribing" ? (
              <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              <Mic size={36} />
            )}
          </div>
        </div>

        {/* Status text */}
        <div className="text-center min-h-[2.5rem] flex flex-col items-center justify-center">
          {phase === "idle" && (
            <div className="text-[0.85rem] text-text-muted">{t("chat.tapToSpeak")}</div>
          )}
          {phase === "recording" && (
            <>
              <div className="text-[0.85rem] text-danger font-medium">{t("chat.listening")}</div>
              <div className="font-mono text-[0.78rem] text-text-dim mt-0.5">{mmss}</div>
            </>
          )}
          {phase === "transcribing" && (
            <div className="text-[0.85rem] text-accent">{t("chat.transcribing")}</div>
          )}
        </div>

        {error && <ErrorAlert message={error} className="w-full" />}

        {/* Controls */}
        <div className="flex gap-2 w-full">
          {phase === "idle" && (
            <button
              type="button"
              onClick={handleStart}
              disabled={transcribe.isPending}
              className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-bg border-none cursor-pointer text-[0.88rem] font-medium transition-opacity hover:opacity-85 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Mic size={16} />
              {t("chat.startRecording")}
            </button>
          )}
          {phase === "recording" && (
            <button
              type="button"
              onClick={handleStop}
              className="flex-1 px-4 py-2.5 rounded-lg bg-danger text-white border-none cursor-pointer text-[0.88rem] font-medium transition-opacity hover:opacity-85 flex items-center justify-center gap-2"
            >
              <Square size={14} />
              {t("chat.stopRecording")}
            </button>
          )}
          {phase === "transcribing" && (
            <button
              type="button"
              disabled
              className="flex-1 px-4 py-2.5 rounded-lg bg-bg-card text-text-dim border border-border text-[0.88rem] font-medium cursor-not-allowed"
            >
              {t("chat.transcribing")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
