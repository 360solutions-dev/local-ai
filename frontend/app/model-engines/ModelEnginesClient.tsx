"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n";

interface Provider {
  name: string;
  icon: string;
  desc: string;
  connected: boolean;
  isDefault?: boolean;
  meta: { label: string; value: string; accent?: boolean }[];
}

interface Model {
  name: string;
  tag?: string;
  size: string;
  params: string;
  status: "ready" | "downloading";
  isDefault?: boolean;
}

const connectedProviders: Provider[] = [
  {
    name: "Ollama",
    icon: "\uD83E\uDD99",
    desc: "Local model runner. Pull and manage models with simple commands. GPU and CPU support.",
    connected: true,
    isDefault: true,
    meta: [
      { label: "Endpoint", value: "localhost:11434" },
      { label: "Models", value: "3 downloaded" },
      { label: "GPU", value: "Active", accent: true },
    ],
  },
  {
    name: "LM Studio",
    icon: "\uD83D\uDDA5\uFE0F",
    desc: "GUI-based model manager with an OpenAI-compatible server. Great for experimentation.",
    connected: true,
    meta: [
      { label: "Endpoint", value: "localhost:1234" },
      { label: "Models", value: "Via LM Studio UI" },
      { label: "Protocol", value: "OpenAI-compat" },
    ],
  },
];

const availableProviders: Provider[] = [
  {
    name: "vLLM",
    icon: "\u26A1",
    desc: "High-throughput serving with PagedAttention. Best for multi-user setups with high concurrency.",
    connected: false,
    meta: [
      { label: "Default Port", value: "8000" },
      { label: "GPU Required", value: "Yes" },
    ],
  },
  {
    name: "llama.cpp",
    icon: "\uD83D\uDD27",
    desc: "Lightweight C++ inference. Runs on CPU, Apple Silicon, and CUDA with minimal overhead.",
    connected: false,
    meta: [
      { label: "Default Port", value: "8080" },
      { label: "GPU Required", value: "No" },
    ],
  },
  {
    name: "Custom Endpoint",
    icon: "\uD83C\uDF10",
    desc: "Connect any OpenAI-compatible API server. Use your own inference setup with a custom URL.",
    connected: false,
    meta: [{ label: "Protocol", value: "/v1/chat/completions" }],
  },
];

const initialModels: Model[] = [
  { name: "llama3.2", tag: "default", size: "3.8 GB", params: "8B", status: "ready", isDefault: true },
  { name: "mistral", size: "4.1 GB", params: "7B", status: "ready" },
  { name: "nomic-embed-text", tag: "embeddings", size: "274 MB", params: "137M", status: "ready" },
];

export default function ModelEnginesClient() {
  const { t } = useTranslation();

  const [showPullModal, setShowPullModal] = useState(false);
  const [pullInput, setPullInput] = useState("");
  const [pullProgress, setPullProgress] = useState<number | null>(null);
  const [models, setModels] = useState<Model[]>(initialModels);
  const [toast, setToast] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: string; latency?: string }>>({});

  const [chatModel, setChatModel] = useState("llama3.2 (Ollama)");
  const [embeddingModel, setEmbeddingModel] = useState("nomic-embed-text (Ollama)");
  const [ttsModel, setTtsModel] = useState("piper-en-amy (Built-in)");

  function showToastMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function testConnection(providerName: string) {
    setTestResults((prev) => ({ ...prev, [providerName]: { status: "loading" } }));
    setTimeout(() => {
      setTestResults((prev) => ({
        ...prev,
        [providerName]: { status: "success", latency: "12ms" },
      }));
    }, 1200);
  }

  function pullModel() {
    const name = pullInput.trim();
    if (!name) return;
    setShowPullModal(false);
    setPullProgress(0);
    showToastMsg(t("modelEngines.pulling", { name }));

    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 15 + 5;
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        setPullProgress(null);
        setModels((prev) => [
          ...prev,
          { name, size: "~2 GB", params: "?", status: "ready" },
        ]);
        showToastMsg(t("modelEngines.downloadedSuccess", { name }));
      }
      setPullProgress(Math.min(Math.round(pct), 100));
    }, 400);
    setPullInput("");
  }

  function removeModel(idx: number) {
    setModels((prev) => prev.filter((_, i) => i !== idx));
    showToastMsg(t("modelEngines.modelRemoved"));
  }

  function setDefault(idx: number) {
    setModels((prev) =>
      prev.map((m, i) => ({
        ...m,
        isDefault: i === idx,
        tag: i === idx ? "default" : m.tag === "default" ? undefined : m.tag,
      }))
    );
    showToastMsg(t("modelEngines.defaultUpdated"));
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">{t("modelEngines.title")}</h1>
          <p className="text-text-muted text-[0.95rem] font-light">
            {t("modelEngines.subtitle")}
          </p>
        </div>
        <button
          onClick={() => setShowPullModal(true)}
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.9rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)]"
        >
          {t("modelEngines.pullModel")}
        </button>
      </div>

      {/* Pull progress bar */}
      {pullProgress !== null && (
        <div className="mb-6 bg-bg-card border border-border rounded-xl p-4">
          <div className="flex justify-between font-mono text-xs text-text-muted mb-2">
            <span>{t("modelEngines.downloadingModel")}</span>
            <span>{pullProgress}%</span>
          </div>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${pullProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Connected Providers */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4">
        {t("modelEngines.connectedProviders")}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {connectedProviders.map((p) => (
          <div
            key={p.name}
            className={`bg-bg-card border rounded-[14px] p-6 relative overflow-hidden transition-all hover:border-border-accent ${
              p.connected ? "border-border-accent" : "border-border"
            }`}
          >
            {p.connected && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
            )}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl bg-bg border border-border">
                  {p.icon}
                </div>
                <span className="text-[1.05rem] font-semibold">{p.name}</span>
              </div>
              {p.isDefault ? (
                <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded bg-accent text-bg font-semibold">
                  {t("common.default")}
                </span>
              ) : (
                <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded text-accent bg-accent/15">
                  {t("common.connected")}
                </span>
              )}
            </div>
            <p className="text-text-muted text-[0.85rem] font-light leading-relaxed mb-4">
              {p.desc}
            </p>
            <div className="flex gap-6 mb-4">
              {p.meta.map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                    {m.label}
                  </span>
                  <span className={`text-[0.85rem] font-medium ${m.accent ? "text-accent" : ""}`}>
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => testConnection(p.name)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text"
              >
                {t("modelEngines.testConnection")}
              </button>
              <button className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text">
                {t("modelEngines.configure")}
              </button>
              {!p.isDefault && (
                <button className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text">
                  {t("modelEngines.setAsDefault")}
                </button>
              )}
            </div>
            {/* Test result */}
            {testResults[p.name] && (
              <div className="flex items-center gap-3 px-3 py-2 bg-bg border border-border rounded-lg mt-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    testResults[p.name].status === "loading"
                      ? "bg-accent-warm animate-pulse"
                      : testResults[p.name].status === "success"
                      ? "bg-accent shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                      : "bg-danger"
                  }`}
                />
                <span className="flex-1 font-mono text-[0.8rem] text-text-muted">
                  {testResults[p.name].status === "loading"
                    ? t("modelEngines.testingConnection")
                    : t("modelEngines.connectionSuccessful")}
                </span>
                {testResults[p.name].latency && (
                  <span className="font-mono text-[0.75rem] text-accent">
                    {testResults[p.name].latency}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Available Providers */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4 mt-10">
        {t("modelEngines.availableProviders")}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {availableProviders.map((p) => (
          <div
            key={p.name}
            className="bg-bg-card border border-border rounded-[14px] p-6 relative overflow-hidden transition-all hover:border-border-accent"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl bg-bg border border-border">
                  {p.icon}
                </div>
                <span className="text-[1.05rem] font-semibold">{p.name}</span>
              </div>
              <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded text-text-dim bg-bg border border-border">
                {t("common.notConnected")}
              </span>
            </div>
            <p className="text-text-muted text-[0.85rem] font-light leading-relaxed mb-4">
              {p.desc}
            </p>
            <div className="flex gap-6 mb-4">
              {p.meta.map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                    {m.label}
                  </span>
                  <span className="text-[0.85rem] font-medium">{m.value}</span>
                </div>
              ))}
            </div>
            <div>
              <button className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5">
                {t("modelEngines.connect")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Downloaded Models */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4 mt-10">
        {t("modelEngines.downloadedModels")}
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="w-full">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 font-mono text-[0.68rem] text-text-dim tracking-wide uppercase border-b border-border">
            <span>{t("modelEngines.model")}</span>
            <span>{t("modelEngines.size")}</span>
            <span>{t("modelEngines.parameters")}</span>
            <span>{t("modelEngines.status")}</span>
            <span>{t("modelEngines.actions")}</span>
          </div>
          {/* Rows */}
          {models.map((m, idx) => (
            <div
              key={m.name}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center border-b border-border last:border-b-0 transition-colors hover:bg-bg-card-hover"
            >
              <div className="flex items-center gap-2">
                <span className="text-[0.9rem] font-medium">{m.name}</span>
                {m.tag && (
                  <span className="font-mono text-[0.62rem] px-1.5 py-0.5 rounded-sm text-accent bg-accent/15">
                    {m.tag}
                  </span>
                )}
              </div>
              <span className="font-mono text-[0.82rem] text-text-muted">{m.size}</span>
              <span className="font-mono text-[0.82rem] text-text-muted">{m.params}</span>
              <span
                className={`font-mono text-[0.75rem] ${
                  m.status === "ready" ? "text-accent" : "text-accent-warm"
                }`}
              >
                {m.status === "ready" ? t("modelEngines.ready") : t("modelEngines.downloading")}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setDefault(idx)}
                  disabled={m.tag === "embeddings"}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.78rem] cursor-pointer transition-all hover:border-text-muted hover:text-text ${
                    m.tag === "embeddings" ? "opacity-40 cursor-default" : ""
                  }`}
                >
                  {t("modelEngines.setDefault")}
                </button>
                <button
                  onClick={() => removeModel(idx)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-danger border border-danger/30 rounded-md font-body text-[0.78rem] cursor-pointer transition-all hover:bg-danger/10 hover:border-danger"
                >
                  {t("modelEngines.remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature -> Model Mapping */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4 mt-10">
        {t("modelEngines.featureModelMapping")}
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h3 className="text-base font-semibold mb-1">{t("modelEngines.assignModels")}</h3>
        <p className="text-text-dim text-[0.85rem] font-light mb-5">
          {t("modelEngines.assignModelsDesc")}
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("sidebar.chatWithFiles")}
            </label>
            <select
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option>llama3.2 (Ollama)</option>
              <option>mistral (Ollama)</option>
              <option>LM Studio — active model</option>
            </select>
          </div>
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("modelEngines.embeddings")}
            </label>
            <select
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option>nomic-embed-text (Ollama)</option>
              <option>all-minilm (Ollama — not downloaded)</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("sidebar.textToAudio")}
            </label>
            <select
              value={ttsModel}
              onChange={(e) => setTtsModel(e.target.value)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option>piper-en-amy (Built-in)</option>
              <option>xtts-v2 (Not downloaded)</option>
            </select>
          </div>
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("modelEngines.summarizer")}{" "}
              <span className="text-accent-warm text-[0.6rem]">{t("common.comingSoon").toUpperCase()}</span>
            </label>
            <select
              disabled
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none appearance-none opacity-40"
            >
              <option>{t("modelEngines.notAvailableYet")}</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => showToastMsg(t("modelEngines.configSaved"))}
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.9rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)]"
          >
            {t("modelEngines.saveConfiguration")}
          </button>
        </div>
      </div>

      {/* Pull Modal */}
      {showPullModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-sm">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[460px] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative">
            <button
              onClick={() => setShowPullModal(false)}
              className="absolute top-4 right-4 bg-transparent border-none text-text-dim text-xl cursor-pointer"
            >
              &times;
            </button>
            <h3 className="text-xl font-semibold mb-1">{t("modelEngines.pullNewModel")}</h3>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">
              {t("modelEngines.pullModelDesc")}{" "}
              <a
                href="https://ollama.com/library"
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                ollama.com/library
              </a>
              .
            </p>
            <div className="flex gap-2">
              <input
                value={pullInput}
                onChange={(e) => setPullInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && pullModel()}
                placeholder={t("modelEngines.pullPlaceholder")}
                className="flex-1 px-4 py-3 bg-bg-card border border-border rounded-lg text-text font-mono text-[0.88rem] outline-none focus:border-border-focus"
              />
              <button
                onClick={pullModel}
                className="px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.88rem] cursor-pointer whitespace-nowrap"
              >
                {t("modelEngines.pull")}
              </button>
            </div>
            <div className="font-mono text-[0.72rem] text-text-dim mt-2">
              {t("modelEngines.popular")}
            </div>
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
    </>
  );
}
