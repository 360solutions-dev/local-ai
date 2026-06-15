"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useHasActiveProvider } from "@/hooks/use-chat";

interface HistoryEntry {
  id: number;
  text: string;
  voice: string;
  voiceShort: string;
  format: string;
  duration: number;
  speed: number;
}

const voices = [
  "Amy (English, Female)",
  "James (English, Male)",
  "Sofia (Spanish, Female)",
  "Hans (German, Male)",
  "Yuki (Japanese, Female)",
  "Wei (Chinese, Male)",
  "Marie (French, Female)",
];

const formats = [".wav", ".mp3", ".ogg"];

const initialHistory: HistoryEntry[] = [
  {
    id: 1,
    text: "Welcome to local-ai.run \u2014 your private, self-hosted AI platform...",
    voice: "Amy (English, Female)",
    voiceShort: "Amy \u00B7 English",
    format: ".wav",
    duration: 12,
    speed: 1,
  },
  {
    id: 2,
    text: "An open-source platform for running AI models locally on your own hardware...",
    voice: "James (English, Male)",
    voiceShort: "James \u00B7 English",
    format: ".mp3",
    duration: 8,
    speed: 1,
  },
  {
    id: 3,
    text: "Bienvenido a la plataforma de inteligencia artificial local...",
    voice: "Sofia (Spanish, Female)",
    voiceShort: "Sofia \u00B7 Spanish",
    format: ".wav",
    duration: 15,
    speed: 1,
  },
  {
    id: 4,
    text: "Chapter one: The fundamentals of privacy-first artificial intelligence...",
    voice: "Amy (English, Female)",
    voiceShort: "Amy \u00B7 English",
    format: ".wav",
    duration: 34,
    speed: 1,
  },
  {
    id: 5,
    text: "\u30ED\u30FC\u30AB\u30EBAI\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u3078\u3088\u3046\u3053\u305D\u3002\u3059\u3079\u3066\u306E\u30C7\u30FC\u30BF\u306F\u5B89\u5168\u306B\u4FDD\u8B77\u3055\u308C\u307E\u3059\u3002",
    voice: "Yuki (Japanese, Female)",
    voiceShort: "Yuki \u00B7 Japanese",
    format: ".wav",
    duration: 10,
    speed: 1,
  },
];

interface TTSModel {
  id: string;
  name: string;
  details: string;
  size: string;
}

const ttsModels: TTSModel[] = [
  { id: "piper", name: "Piper", details: "Lightweight and fast. 20+ voices, low resource usage. Great for most use cases.", size: "45 MB" },
  { id: "coqui", name: "Coqui TTS", details: "High-quality neural TTS. Natural-sounding voices with fine-grained control.", size: "1.2 GB" },
  { id: "bark", name: "Bark", details: "Transformer-based. Supports music, laughter, and expressive speech. GPU recommended.", size: "4.8 GB" },
  { id: "xtts", name: "XTTS-v2", details: "Voice cloning with 6-second reference. 17 languages. Best quality, highest resource usage.", size: "6.1 GB" },
];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TextToAudioClient() {
  const { t } = useTranslation();
  const { active: hasActiveProvider, isLoading: providerLoading } = useHasActiveProvider();
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(voices[0]);
  const [format, setFormat] = useState(formats[0]);
  const [speed, setSpeed] = useState(1);
  const [generating, setGenerating] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [activeId, setActiveId] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(35);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showModelModal, setShowModelModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStatus, setDownloadStatus] = useState("");

  const [toast, setToast] = useState<string | null>(null);

  const [waveBars, setWaveBars] = useState<number[]>(() =>
    Array.from({ length: 80 }, (_, i) => (i % 3 === 0 ? 30 : i % 2 === 0 ? 20 : 15))
  );

  useEffect(() => {
    // Randomize wave bar heights on client only — keeps SSR deterministic
    // and avoids a hydration mismatch on the animated waveform.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWaveBars(Array.from({ length: 80 }, () => Math.random() * 40 + 8));
  }, []);

  const nextIdRef = useRef(6);

  const activeEntry = history.find((h) => h.id === activeId) || history[0];

  function showToastMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const stopPlayback = useCallback(() => {
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  function togglePlay() {
    if (isPlaying) {
      stopPlayback();
    } else {
      setIsPlaying(true);
      let pct = progress;
      playRef.current = setInterval(() => {
        pct += 0.5;
        if (pct > 100) {
          pct = 0;
          stopPlayback();
          setProgress(0);
          return;
        }
        setProgress(pct);
      }, 60);
    }
  }

  function seekAudio(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setProgress(Math.max(0, Math.min(100, pct)));
  }

  function generateAudio() {
    if (!text.trim() || generating) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      const dur = Math.floor(text.length / 15) + 3;
      const voiceShort = voice.split("(")[0].trim() + " \u00B7 " + (voice.match(/\(([^,]+)/)?.[1] || "");
      const entry: HistoryEntry = {
        id: nextIdRef.current++,
        text: text.substring(0, 80) + (text.length > 80 ? "..." : ""),
        voice,
        voiceShort,
        format,
        duration: dur,
        speed,
      };
      setHistory((prev) => [entry, ...prev]);
      setActiveId(entry.id);
      setProgress(0);
      stopPlayback();
      showToastMsg(t("tts.audioGenerated"));
    }, 2000);
  }

  function deleteHistory(id: number) {
    setHistory((prev) => prev.filter((h) => h.id !== id));
    if (activeId === id && history.length > 1) {
      const remaining = history.filter((h) => h.id !== id);
      if (remaining.length > 0) setActiveId(remaining[0].id);
    }
  }

  function downloadModel() {
    if (!selectedModel) return;
    setDownloadProgress(0);
    setDownloadStatus(t("tts.downloadingModelFiles"));
    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 12 + 3;
      if (pct > 100) pct = 100;
      setDownloadProgress(Math.round(pct));
      if (pct < 40) setDownloadStatus(t("tts.downloadingModelFiles"));
      else if (pct < 80) setDownloadStatus(t("tts.extractingVoiceData"));
      else setDownloadStatus(t("tts.initializingEngine"));
      if (pct >= 100) {
        clearInterval(interval);
        setDownloadStatus(t("tts.engineReady"));
        setTimeout(() => {
          setShowModelModal(false);
          setDownloadProgress(null);
          setSelectedModel(null);
        }, 800);
      }
    }, 250);
  }

  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  const currentTime = activeEntry
    ? formatTime((progress / 100) * activeEntry.duration)
    : "0:00";
  const totalTime = activeEntry ? formatTime(activeEntry.duration) : "0:00";

  // Show spinner while provider state is loading (prevents flicker)
  if (providerLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Block entire page if no provider
  if (!hasActiveProvider) {
    return (
      <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center overflow-hidden relative">
        {/* Noise overlay */}
        <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />
        {/* Ambient glow */}
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse,rgba(52,211,153,0.15)_0%,transparent_65%)] pointer-events-none z-0" />

        <div className="relative z-1 w-full max-w-[480px] px-8 text-center animate-[cardIn_0.5s_ease]">
          {/* Icon */}
          <div className="w-[72px] h-[72px] rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center text-3xl mx-auto mb-6 animate-[scaleIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">
            &#9888;&#65039;
          </div>

          {/* Heading */}
          <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">
            {t("modelEngines.noProviderWarning")}
          </h1>
          <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
            {t("modelEngines.noProviderWarningDesc")}
          </p>

          {/* Info cards */}
          <div className="flex flex-col gap-2.5 mb-8">
            <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
              <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">1</div>
              Go to Model Engines
            </div>
            <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
              <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">2</div>
              Connect a provider (e.g. Ollama)
            </div>
            <div className="flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light">
              <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">3</div>
              Set up a TTS engine and start generating audio
            </div>
          </div>

          {/* CTA */}
          <Link
            href="/model-engines"
            className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-8 bg-accent text-bg border-none rounded-lg font-body text-base font-semibold no-underline cursor-pointer transition-all duration-200 shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 hover:shadow-[0_0_50px_rgba(52,211,153,0.3)]"
          >
            {t("sidebar.modelEngines")} <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated shrink-0">
        <div className="text-[0.95rem] font-semibold flex items-center gap-2">
          {t("tts.title")}
          <span className="font-mono text-[0.72rem] text-[#8b5cf6] bg-[rgba(139,92,246,0.15)] px-2 py-0.5 rounded">
            piper-en-amy &middot; 22kHz
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => showToastMsg(t("tts.allExported"))}
            className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent"
          >
            {t("tts.exportAll")}
          </button>
          <button
            onClick={() => setShowModelModal(true)}
            className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent"
          >
            {t("tts.engine")}
          </button>
        </div>
      </div>

      {/* Content split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Input Panel */}
        <div className="flex-1 flex flex-col border-r border-border">
          <div className="px-6 pt-5">
            <div className="font-mono text-[0.7rem] text-text-dim tracking-wide uppercase mb-3">
              {t("tts.inputText")}
            </div>
          </div>

          {/* Controls row */}
          <div className="flex gap-3 px-6 mb-4 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                {t("tts.voice")}
              </span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="px-3 py-2 bg-bg-card border border-border rounded-md text-text font-body text-[0.85rem] outline-none appearance-none cursor-pointer focus:border-border-focus"
              >
                {voices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                {t("tts.format")}
              </span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="px-3 py-2 bg-bg-card border border-border rounded-md text-text font-body text-[0.85rem] outline-none appearance-none cursor-pointer focus:border-border-focus"
              >
                {formats.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                {t("tts.speed")}
              </span>
              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-20 h-1 bg-border rounded-sm outline-none cursor-pointer accent-accent"
                />
                <span className="font-mono text-[0.78rem] text-text-muted min-w-[30px]">
                  {speed}x
                </span>
              </div>
            </div>
          </div>

          {/* Textarea */}
          <div className="flex-1 px-6 pb-4 flex flex-col">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("tts.placeholder")}
              className="flex-1 w-full p-4 bg-bg-card border border-border rounded-[10px] text-text font-body text-[0.95rem] leading-[1.7] outline-none resize-none transition-colors focus:border-border-focus placeholder:text-text-dim"
            />
            <div className="flex items-center justify-between pt-3">
              <span className="font-mono text-[0.72rem] text-text-dim">
                {t("tts.characters", { count: String(text.length), s: text.length !== 1 ? "s" : "" })}
              </span>
              <button
                onClick={generateAudio}
                disabled={generating || !text.trim()}
                className="flex items-center gap-2 px-6 py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all shadow-[0_0_24px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {generating ? (
                  <>
                    <span>{t("tts.generating")}</span>
                    <div className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
                  </>
                ) : (
                  <span>{t("tts.generateAudio")}</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Output Panel */}
        <div className="w-[420px] flex flex-col bg-bg-elevated shrink-0">
          <div className="px-5 pt-5">
            <div className="font-mono text-[0.7rem] text-text-dim tracking-wide uppercase mb-3">
              {t("tts.output")}
            </div>
          </div>

          {/* Audio player */}
          <div className="mx-5 mb-4 bg-bg-card border border-border rounded-xl p-5">
            {/* Waveform */}
            <div className="flex items-center gap-[2px] h-14 mb-4 overflow-hidden">
              {waveBars.map((h, i) => {
                const activeIdx = Math.floor((progress / 100) * waveBars.length);
                return (
                  <div
                    key={i}
                    className={`w-[3px] rounded-sm bg-accent transition-all ${
                      i <= activeIdx ? "opacity-90" : "opacity-30"
                    }`}
                    style={{ height: `${h}px` }}
                  />
                );
              })}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={togglePlay}
                className="w-[42px] h-[42px] rounded-full bg-accent border-none text-bg text-lg cursor-pointer flex items-center justify-center transition-all shrink-0 hover:scale-105 hover:shadow-[0_0_20px_rgba(52,211,153,0.3)]"
              >
                {isPlaying ? "\u23F8" : "\u25B6"}
              </button>
              <div className="flex-1">
                <div
                  className="h-1 bg-border rounded-sm cursor-pointer relative"
                  onClick={seekAudio}
                >
                  <div
                    className="h-full bg-accent rounded-sm transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 font-mono text-[0.7rem] text-text-dim">
                  <span>{currentTime}</span>
                  <span>{totalTime}</span>
                </div>
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div>
                <div className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                  {t("tts.voice")}
                </div>
                <div className="text-[0.82rem]">
                  {activeEntry ? activeEntry.voice.split("(")[0].trim() : "—"}
                </div>
              </div>
              <div>
                <div className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                  {t("tts.duration")}
                </div>
                <div className="text-[0.82rem]">
                  {activeEntry ? activeEntry.duration + "s" : "—"}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => showToastMsg(t("tts.audioDownloaded"))}
                  className="bg-bg border border-border text-text-muted px-2.5 py-1.5 rounded font-mono text-[0.7rem] cursor-pointer transition-all hover:border-accent hover:text-accent"
                >
                  {t("tts.save")}
                </button>
                <button
                  onClick={() => showToastMsg(t("tts.copiedToClipboard"))}
                  className="bg-bg border border-border text-text-muted px-2.5 py-1.5 rounded font-mono text-[0.7rem] cursor-pointer transition-all hover:border-accent hover:text-accent"
                >
                  {t("common.copy")}
                </button>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase py-2">
              {t("tts.generationHistory")}
            </div>
            {history.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  setActiveId(item.id);
                  setProgress(0);
                  stopPlayback();
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all mb-0.5 group ${
                  item.id === activeId ? "bg-accent/15" : "hover:bg-bg-card"
                }`}
              >
                <div className="w-[30px] h-[30px] rounded-full bg-bg border border-border flex items-center justify-center text-[0.7rem] shrink-0 text-text-muted group-hover:border-accent group-hover:text-accent">
                  &#9654;
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.82rem] whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
                    {item.text}
                  </div>
                  <div className="font-mono text-[0.68rem] text-text-dim flex gap-2">
                    <span>{item.voiceShort}</span>
                    <span>
                      {item.format} &middot; 22kHz
                    </span>
                  </div>
                </div>
                <span className="font-mono text-[0.75rem] text-text-dim shrink-0">
                  {formatTime(item.duration)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteHistory(item.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 bg-transparent border-none text-text-dim cursor-pointer text-[0.75rem] px-1 py-0.5 rounded transition-all hover:text-danger"
                >
                  &#10005;
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Model Selection Modal */}
      {showModelModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-sm">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)]">
            <h2 className="text-xl font-bold mb-1">{t("tts.chooseTtsEngine")}</h2>
            <p className="text-text-muted text-[0.9rem] font-light mb-6 leading-relaxed">
              {t("tts.chooseTtsEngineDesc")}
            </p>

            {ttsModels.map((m) => (
              <div
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                className={`flex items-center gap-4 p-4 border rounded-[10px] cursor-pointer transition-all mb-2.5 ${
                  selectedModel === m.id
                    ? "border-[#8b5cf6] bg-[rgba(139,92,246,0.15)]"
                    : "border-border hover:border-border-accent hover:bg-bg-card"
                }`}
              >
                <div
                  className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    selectedModel === m.id ? "border-[#8b5cf6]" : "border-border"
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full bg-[#8b5cf6] transition-opacity ${
                      selectedModel === m.id ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[0.95rem] font-semibold mb-0.5">{m.name}</div>
                  <div className="text-[0.8rem] text-text-muted font-light">{m.details}</div>
                </div>
                <div className="font-mono text-[0.72rem] text-text-dim shrink-0">{m.size}</div>
              </div>
            ))}

            <button
              onClick={downloadModel}
              disabled={!selectedModel || downloadProgress !== null}
              className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.95rem] font-semibold cursor-pointer mt-4 transition-all shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {!selectedModel
                ? t("tts.selectEngine")
                : downloadProgress !== null
                ? t("tts.downloadingEngine")
                : t("tts.downloadAndContinue")}
            </button>

            {downloadProgress !== null && (
              <div className="mt-4">
                <div className="flex justify-between font-mono text-[0.75rem] text-text-muted mb-1.5">
                  <span>
                    {t("tts.downloadingName", { name: selectedModel || "" })}
                  </span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="h-1.5 bg-bg-card rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-sm transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <div className="font-mono text-[0.72rem] text-text-dim mt-1.5">
                  {downloadStatus}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      <div
        className={`fixed bottom-8 right-8 bg-bg-card border border-border-accent rounded-[10px] px-5 py-3 text-[0.88rem] text-accent flex items-center gap-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-[1000] transition-all duration-300 ${
          toast ? "translate-y-0 opacity-100" : "translate-y-[100px] opacity-0"
        }`}
      >
        &#10004; {toast}
      </div>
    </div>
  );
}
