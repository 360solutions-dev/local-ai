"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  useOllamaModels,
  useDeleteModel,
  useSystemHealth,
  useTestProvider,
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useSetDefaultProvider,
  useDeleteProvider,
  useModelConfig,
  useUpdateModelConfig,
  useHasActiveProvider,
  useAllProviderModels,
} from "@/hooks/use-chat";
import type { ProviderData } from "@/hooks/use-chat";
import { useDownload } from "@/lib/download-provider";
import Toast from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { AVAILABLE_PROVIDER_TEMPLATES, PROVIDER_PICKER_OPTIONS } from "@/lib/constants/providers";

export default function ModelEnginesClient() {
  const { t } = useTranslation();

  const [showPullModal, setShowPullModal] = useState(false);
  const [pullInput, setPullInput] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: string; latency?: string; error?: string }>>({});

  // Connect / Configure modal state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectModalStep, setConnectModalStep] = useState<"pick" | "form">("pick");
  const [editingProvider, setEditingProvider] = useState<ProviderData | null>(null);
  const [connectForm, setConnectForm] = useState({ name: "", endpoint: "", type: "openai" as "ollama" | "openai", icon: "\uD83C\uDF10", description: "" });
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Feature model mapping state — stores "providerId::modelName" or just "modelName" for built-ins
  const [chatModel, setChatModel] = useState("");
  const [chatProviderId, setChatProviderId] = useState<string | null>(null);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingProviderId, setEmbeddingProviderId] = useState<string | null>(null);
  const [ttsModel, setTtsModel] = useState("");
  const [ttsProviderId, setTtsProviderId] = useState<string | null>(null);

  // Real API hooks
  const { data: ollamaModels = [], isLoading: modelsLoading } = useOllamaModels();
  const { data: health } = useSystemHealth();
  const { data: providers = [], isLoading: providersLoading } = useProviders();
  const { data: modelConfig } = useModelConfig();
  const deleteModelMutation = useDeleteModel();
  const testProviderMutation = useTestProvider();
  const createProviderMutation = useCreateProvider();
  const updateProviderMutation = useUpdateProvider();

  const setDefaultProviderMutation = useSetDefaultProvider();
  const deleteProviderMutation = useDeleteProvider();
  const updateModelConfigMutation = useUpdateModelConfig();
  const { data: allProviderModels = [] } = useAllProviderModels(providers);
  const { download, isPulling, startPull } = useDownload();
  const [removeTarget, setRemoveTarget] = useState<ProviderData | null>(null);

  // Sync model config from API into local state
  useEffect(() => {
    if (modelConfig) {
      if (modelConfig.chat_model) setChatModel(modelConfig.chat_model);
      setChatProviderId(modelConfig.chat_provider_id ?? null);
      if (modelConfig.embedding_model) setEmbeddingModel(modelConfig.embedding_model);
      setEmbeddingProviderId(modelConfig.embedding_provider_id ?? null);
      if (modelConfig.tts_model) setTtsModel(modelConfig.tts_model);
      setTtsProviderId(modelConfig.tts_provider_id ?? null);
    }
  }, [modelConfig]);

  // Auto-select model when only one option is available and nothing is selected yet
  useEffect(() => {
    if (allProviderModels.length === 0) return;

    const chatModels = allProviderModels.filter((m) => !/embed/i.test(m.name));
    const embeddingModels = allProviderModels.filter((m) => /embed/i.test(m.name));

    if (!chatModel && chatModels.length === 1) {
      setChatModel(chatModels[0].name);
      setChatProviderId(chatModels[0].provider_id);
    }
    if (!embeddingModel && embeddingModels.length === 1) {
      setEmbeddingModel(embeddingModels[0].name);
      setEmbeddingProviderId(embeddingModels[0].provider_id);
    }
  }, [allProviderModels, chatModel, embeddingModel]);

  // Available providers = templates that are NOT already connected
  const connectedNames = new Set(providers.map((p) => p.name));
  const availableProviders = AVAILABLE_PROVIDER_TEMPLATES.filter(
    (tpl) => !connectedNames.has(tpl.name)
  );

  const { active: hasActiveProvider } = useHasActiveProvider();

  function showToastMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function testConnection(provider: ProviderData) {
    setTestResults((prev) => ({ ...prev, [provider.name]: { status: "loading" } }));
    testProviderMutation.mutate(
      { endpoint: provider.endpoint, type: provider.type },
      {
        onSuccess: (data) => {
          if (data.connected) {
            setTestResults((prev) => ({
              ...prev,
              [provider.name]: { status: "success", latency: `${data.latency_ms}ms` },
            }));
            if (!provider.is_connected) {
              updateProviderMutation.mutate({ id: provider.id, is_connected: true });
            }
          } else {
            setTestResults((prev) => ({
              ...prev,
              [provider.name]: { status: "error", error: data.error || "Connection failed" },
            }));
            if (provider.is_connected) {
              updateProviderMutation.mutate({ id: provider.id, is_connected: false });
            }
          }
        },
        onError: () => {
          setTestResults((prev) => ({
            ...prev,
            [provider.name]: { status: "error", error: "Request failed" },
          }));
        },
      },
    );
  }

  function openConnectModal(template: typeof AVAILABLE_PROVIDER_TEMPLATES[0]) {
    setEditingProvider(null);
    setConnectForm({
      name: template.name,
      endpoint: template.endpoint,
      type: template.type,
      icon: template.icon,
      description: template.desc,
    });
    setConnectModalStep("form");
    setShowConnectModal(true);
  }

  function openConfigureModal(provider: ProviderData) {
    setEditingProvider(provider);
    setConnectForm({
      name: provider.name,
      endpoint: provider.endpoint,
      type: provider.type,
      icon: provider.icon,
      description: provider.description,
    });
    setConnectModalStep("form");
    setShowConnectModal(true);
  }

  function selectPickerProvider(p: typeof PROVIDER_PICKER_OPTIONS[0]) {
    setConnectForm({
      name: p.name,
      endpoint: p.endpoint,
      type: p.type,
      icon: p.icon,
      description: p.desc,
    });
    setConnectModalStep("form");
  }

  function selectCustomProvider() {
    setConnectForm({ name: "", endpoint: "", type: "openai", icon: "\uD83C\uDF10", description: "" });
    setConnectModalStep("form");
  }

  function handleConnectSubmit() {
    if (!connectForm.endpoint.trim()) return;
    setConnectError(null);

    if (editingProvider) {
      // Editing: test first, then update
      setIsTesting(true);
      testProviderMutation.mutate(
        { endpoint: connectForm.endpoint, type: connectForm.type },
        {
          onSuccess: (data) => {
            setIsTesting(false);
            if (data.connected) {
              updateProviderMutation.mutate(
                {
                  id: editingProvider.id,
                  name: connectForm.name,
                  endpoint: connectForm.endpoint,
                  type: connectForm.type,
                  icon: connectForm.icon,
                  description: connectForm.description,
                  is_connected: true,
                },
                {
                  onSuccess: () => {
                    showToastMsg(t("modelEngines.providerUpdated"));
                    setShowConnectModal(false);
                  },
                },
              );
            } else {
              setConnectError(data.error || t("modelEngines.connectionFailed"));
            }
          },
          onError: () => {
            setIsTesting(false);
            setConnectError(t("modelEngines.connectionFailed"));
          },
        },
      );
    } else {
      // Creating: test first, then create
      setIsTesting(true);
      testProviderMutation.mutate(
        { endpoint: connectForm.endpoint, type: connectForm.type },
        {
          onSuccess: (data) => {
            setIsTesting(false);
            if (data.connected) {
              createProviderMutation.mutate(
                {
                  name: connectForm.name,
                  endpoint: connectForm.endpoint,
                  type: connectForm.type,
                  icon: connectForm.icon,
                  description: connectForm.description,
                },
                {
                  onSuccess: () => {
                    showToastMsg(t("modelEngines.providerConnected"));
                    setShowConnectModal(false);
                  },
                },
              );
            } else {
              setConnectError(data.error || t("modelEngines.connectionFailed"));
            }
          },
          onError: () => {
            setIsTesting(false);
            setConnectError(t("modelEngines.connectionFailed"));
          },
        },
      );
    }
  }

  function handleSetDefault(provider: ProviderData) {
    setDefaultProviderMutation.mutate(provider.id, {
      onSuccess: () => showToastMsg(t("modelEngines.defaultUpdatedMsg")),
    });
  }

  function handleDisconnect(provider: ProviderData) {
    updateProviderMutation.mutate(
      { id: provider.id, is_connected: false },
      { onSuccess: () => showToastMsg(t("modelEngines.providerDisconnected")) },
    );
  }

  function handleReconnect(provider: ProviderData) {
    updateProviderMutation.mutate(
      { id: provider.id, is_connected: true },
      { onSuccess: () => showToastMsg(t("modelEngines.providerConnected")) },
    );
  }

  function handleRemoveProvider(provider: ProviderData) {
    setRemoveTarget(provider);
  }

  function confirmRemoveProvider() {
    if (!removeTarget) return;
    deleteProviderMutation.mutate(removeTarget.id, {
      onSuccess: () => {
        showToastMsg(t("modelEngines.providerRemoved"));
        setRemoveTarget(null);
      },
    });
  }

  function openAddCustomModal() {
    setEditingProvider(null);
    setConnectForm({ name: "", endpoint: "", type: "openai", icon: "\uD83C\uDF10", description: "" });
    setConnectError(null);
    setConnectModalStep("pick");
    setShowConnectModal(true);
  }

  function handleModelSelect(
    value: string,
    setModel: (v: string) => void,
    setProvider: (v: string | null) => void,
  ) {
    // value format: "providerId::modelName" or "modelName" for built-ins
    if (value.includes("::")) {
      const [pid, name] = value.split("::", 2);
      setModel(name);
      setProvider(pid);
    } else {
      setModel(value);
      setProvider(null);
    }
  }

  function modelSelectValue(model: string, providerId: string | null): string {
    if (providerId && model) return `${providerId}::${model}`;
    return model;
  }

  function handleSaveModelConfig() {
    updateModelConfigMutation.mutate(
      {
        chat_model: chatModel,
        chat_provider_id: chatProviderId,
        embedding_model: embeddingModel,
        embedding_provider_id: embeddingProviderId,
        tts_model: ttsModel,
        tts_provider_id: ttsProviderId,
      },
      {
        onSuccess: () => showToastMsg(t("modelEngines.configSaved")),
      },
    );
  }

  function validateModelName(name: string): string | null {
    if (!name) return t("modelEngines.modelNameRequired");
    if (name.length > 200) return t("modelEngines.modelNameTooLong");
    const pattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\/[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)?(:[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
    if (!pattern.test(name)) return t("modelEngines.invalidModelName");
    return null;
  }

  async function handlePullModel() {
    const name = pullInput.trim();
    if (!name || isPulling || isValidating) return;

    const error = validateModelName(name);
    if (error) {
      setPullError(error);
      return;
    }

    // Check if model is already downloaded
    // Ollama stores as "name:tag" (e.g. "llama3.1:latest")
    // User might type "llama3.1" or "llama3.1:latest" — match both
    const nameWithTag = name.includes(":") ? name : `${name}:latest`;
    const nameWithoutTag = name.split(":")[0];
    const alreadyExists = allProviderModels.some(
      (m) => m.name === name || m.name === nameWithTag || m.name === nameWithoutTag || m.name.split(":")[0] === nameWithoutTag,
    );
    if (alreadyExists) {
      setPullError(t("modelEngines.modelAlreadyExists"));
      return;
    }

    setIsValidating(true);
    setPullError(null);
    try {
      const res = await fetch(`/api/models/validate?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`Validation failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.valid) {
        setPullError(data.error || t("modelEngines.modelNotFound"));
        return;
      }
    } catch {
      // If validation endpoint is unreachable, proceed anyway
    } finally {
      setIsValidating(false);
    }

    setShowPullModal(false);
    setPullInput("");
    setPullError(null);
    startPull(name);
  }

  function handleRemoveModel(modelName: string) {
    deleteModelMutation.mutate(modelName, {
      onSuccess: () => showToastMsg(t("modelEngines.modelRemoved")),
      onError: (err) => showToastMsg(`Failed to remove: ${err.message}`),
    });
  }

  const isSubmitting = isTesting || createProviderMutation.isPending || updateProviderMutation.isPending;

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
          onClick={() => { setShowPullModal(true); setPullError(null); }}
          disabled={isPulling || !hasActiveProvider}
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.9rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPulling ? t("modelEngines.downloading") : t("modelEngines.pullModel")}
        </button>
      </div>

      {/* No active provider warning */}
      {!providersLoading && !hasActiveProvider && (
        <div className="mb-6 bg-accent-warm/10 border border-accent-warm/30 rounded-xl p-4 flex items-center gap-3">
          <span className="text-accent-warm text-lg">&#9888;</span>
          <div>
            <p className="text-[0.9rem] font-medium text-accent-warm">{t("modelEngines.noProviderWarning")}</p>
            <p className="text-[0.8rem] text-text-muted font-light">{t("modelEngines.noProviderWarningDesc")}</p>
          </div>
        </div>
      )}

      {/* Pull progress bar */}
      {download && (
        <div className="mb-6 bg-bg-card border border-border rounded-xl p-4">
          <div className="flex justify-between font-mono text-xs text-text-muted mb-2">
            <span>{download.status} — {download.modelName}</span>
            <span>{download.percent}%</span>
          </div>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${download.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Connected Providers */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4">
        {t("modelEngines.connectedProviders")}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {providersLoading ? (
          <div className="px-4 py-6 text-center text-text-dim text-[0.85rem]">Loading providers...</div>
        ) : providers.length === 0 ? (
          <div className="px-4 py-6 text-center text-text-dim text-[0.85rem]">No providers connected. Use &quot;+ Connect&quot; below to add one.</div>
        ) : (
          providers.map((p) => {
            const isOllama = p.name === "Ollama";
            const connected = isOllama ? (p.is_connected && (health?.ollama ?? true)) : p.is_connected;
            return (
              <div
                key={p.id}
                className={`bg-bg-card border rounded-[14px] p-6 relative overflow-hidden transition-all hover:border-border-accent ${
                  connected ? "border-border-accent" : "border-border"
                }`}
              >
                {connected && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
                )}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl bg-bg border border-border">
                      {p.icon}
                    </div>
                    <span className="text-[1.05rem] font-semibold">{p.name}</span>
                  </div>
                  {p.is_default && connected ? (
                    <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded bg-accent text-bg font-semibold">
                      {t("common.default")}
                    </span>
                  ) : connected ? (
                    <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded text-accent bg-accent/15">
                      {t("common.connected")}
                    </span>
                  ) : (
                    <span className="font-mono text-[0.68rem] px-2 py-0.5 rounded text-text-dim bg-bg border border-border">
                      {t("common.notConnected")}
                    </span>
                  )}
                </div>
                <p className="text-text-muted text-[0.85rem] font-light leading-relaxed mb-4">
                  {p.description}
                </p>
                <div className="flex gap-6 mb-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">Endpoint</span>
                    <span className="text-[0.85rem] font-medium">{p.endpoint.replace(/^https?:\/\//, "")}</span>
                  </div>
                  {isOllama && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">Models</span>
                      <span className={`text-[0.85rem] font-medium ${ollamaModels.length > 0 ? "text-accent" : ""}`}>
                        {ollamaModels.length} installed
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">Type</span>
                    <span className="text-[0.85rem] font-medium">{p.type === "ollama" ? "Ollama" : "OpenAI-compat"}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {connected ? (
                    <>
                      <button
                        onClick={() => testConnection(p)}
                        disabled={testProviderMutation.isPending}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text disabled:opacity-50"
                      >
                        {t("modelEngines.testConnection")}
                      </button>
                      <button
                        onClick={() => openConfigureModal(p)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text"
                      >
                        {t("modelEngines.configure")}
                      </button>
                      {!p.is_default && (
                        <button
                          onClick={() => handleSetDefault(p)}
                          disabled={setDefaultProviderMutation.isPending}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text disabled:opacity-50"
                        >
                          {t("modelEngines.setAsDefault")}
                        </button>
                      )}
                      {isOllama ? (
                        <button
                          onClick={() => handleDisconnect(p)}
                          disabled={updateProviderMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-danger border border-danger/30 rounded-md font-body text-[0.82rem] cursor-pointer transition-all hover:bg-danger/10 hover:border-danger disabled:opacity-50"
                        >
                          {t("modelEngines.disconnect")}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleDisconnect(p)}
                            disabled={updateProviderMutation.isPending}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] cursor-pointer transition-all hover:border-text-muted hover:text-text disabled:opacity-50"
                          >
                            {t("modelEngines.disconnect")}
                          </button>
                          <button
                            onClick={() => handleRemoveProvider(p)}
                            disabled={deleteProviderMutation.isPending}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-danger border border-danger/30 rounded-md font-body text-[0.82rem] cursor-pointer transition-all hover:bg-danger/10 hover:border-danger disabled:opacity-50"
                          >
                            {t("modelEngines.removeProvider")}
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleReconnect(p)}
                        disabled={updateProviderMutation.isPending}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5 disabled:opacity-50"
                      >
                        {t("modelEngines.reconnect")}
                      </button>
                      <button
                        onClick={() => openConfigureModal(p)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-transparent text-text-muted border border-border rounded-md font-body text-[0.82rem] font-medium cursor-pointer transition-all hover:border-text-muted hover:text-text"
                      >
                        {t("modelEngines.configure")}
                      </button>
                      {!isOllama && (
                        <button
                          onClick={() => handleRemoveProvider(p)}
                          disabled={deleteProviderMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-danger border border-danger/30 rounded-md font-body text-[0.82rem] cursor-pointer transition-all hover:bg-danger/10 hover:border-danger disabled:opacity-50"
                        >
                          {t("modelEngines.removeProvider")}
                        </button>
                      )}
                    </>
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
                        : testResults[p.name].status === "success"
                        ? t("modelEngines.connectionSuccessful")
                        : testResults[p.name].error || "Connection failed"}
                    </span>
                    {testResults[p.name].latency && (
                      <span className="font-mono text-[0.75rem] text-accent">
                        {testResults[p.name].latency}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
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
              {p.meta?.map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[0.65rem] text-text-dim tracking-wide uppercase">
                    {m.label}
                  </span>
                  <span className="text-[0.85rem] font-medium">{m.value}</span>
                </div>
              ))}
            </div>
            <div>
              <button
                onClick={() => openConnectModal(p)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5"
              >
                {t("modelEngines.connect")}
              </button>
            </div>
          </div>
        ))}

        {/* Add Custom Provider — always visible */}
        <div className="bg-bg-card border border-dashed border-border rounded-[14px] p-6 relative overflow-hidden transition-all hover:border-border-accent flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl bg-bg border border-border">
              +
            </div>
            <span className="text-[1.05rem] font-semibold">{t("modelEngines.addCustomProvider")}</span>
          </div>
          <p className="text-text-muted text-[0.85rem] font-light leading-relaxed mb-4 flex-1">
            {t("modelEngines.addCustomProviderDesc")}
          </p>
          <div>
            <button
              onClick={openAddCustomModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg border-none rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5"
            >
              {t("modelEngines.addProvider")}
            </button>
          </div>
        </div>
      </div>

      {/* Downloaded Models */}
      <div className="font-mono text-xs text-text-dim tracking-widest uppercase mb-4 mt-10">
        {t("modelEngines.downloadedModels")}
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="w-full">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 px-4 py-2 font-mono text-[0.68rem] text-text-dim tracking-wide uppercase border-b border-border">
            <span>{t("modelEngines.model")}</span>
            <span>{t("modelEngines.size")}</span>
            <span>{t("modelEngines.status")}</span>
            <span>{t("modelEngines.actions")}</span>
          </div>
          {/* Rows */}
          {modelsLoading ? (
            <div className="px-4 py-6 text-center text-text-dim text-[0.85rem]">Loading models...</div>
          ) : ollamaModels.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-dim text-[0.85rem]">No models installed. Click &quot;Pull Model&quot; to download one.</div>
          ) : (
            ollamaModels.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center border-b border-border last:border-b-0 transition-colors hover:bg-bg-card-hover"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[0.9rem] font-medium">{m.name}</span>
                </div>
                <span className="font-mono text-[0.82rem] text-text-muted">{m.size}</span>
                <span className="font-mono text-[0.75rem] text-accent">
                  {t("modelEngines.ready")}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRemoveModel(m.id)}
                    disabled={deleteModelMutation.isPending}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-transparent text-danger border border-danger/30 rounded-md font-body text-[0.78rem] cursor-pointer transition-all hover:bg-danger/10 hover:border-danger disabled:opacity-50"
                  >
                    {t("modelEngines.remove")}
                  </button>
                </div>
              </div>
            ))
          )}
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
              value={modelSelectValue(chatModel, chatProviderId)}
              onChange={(e) => handleModelSelect(e.target.value, setChatModel, setChatProviderId)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option value="">{t("modelEngines.selectModel")}</option>
              {allProviderModels.filter((m) => !/embed/i.test(m.name)).map((m) => (
                <option key={`${m.provider_id}-${m.id}`} value={`${m.provider_id}::${m.name}`}>
                  {m.name} ({m.provider_name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("modelEngines.embeddings")}
            </label>
            <select
              value={modelSelectValue(embeddingModel, embeddingProviderId)}
              onChange={(e) => handleModelSelect(e.target.value, setEmbeddingModel, setEmbeddingProviderId)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option value="">{t("modelEngines.selectModel")}</option>
              {allProviderModels.filter((m) => /embed/i.test(m.name)).map((m) => (
                <option key={`${m.provider_id}-${m.id}`} value={`${m.provider_id}::${m.name}`}>
                  {m.name} ({m.provider_name})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
              {t("sidebar.textToAudio")}
            </label>
            <select
              value={modelSelectValue(ttsModel, ttsProviderId)}
              onChange={(e) => handleModelSelect(e.target.value, setTtsModel, setTtsProviderId)}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
            >
              <option value="">{t("modelEngines.selectModel")}</option>
              <option value="piper-en-amy">piper-en-amy (Built-in)</option>
              <option value="xtts-v2">xtts-v2</option>
              {allProviderModels.filter((m) => !/embed/i.test(m.name)).map((m) => (
                <option key={`${m.provider_id}-${m.id}`} value={`${m.provider_id}::${m.name}`}>
                  {m.name} ({m.provider_name})
                </option>
              ))}
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
            onClick={handleSaveModelConfig}
            disabled={updateModelConfigMutation.isPending}
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.9rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)] disabled:opacity-50"
          >
            {updateModelConfigMutation.isPending ? t("modelEngines.saving") : t("modelEngines.saveConfiguration")}
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
                onChange={(e) => {
                  setPullInput(e.target.value);
                  if (pullError) setPullError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handlePullModel()}
                placeholder={t("modelEngines.pullPlaceholder")}
                className={`flex-1 px-4 py-3 bg-bg-card border rounded-lg text-text font-mono text-[0.88rem] outline-none focus:border-border-focus ${
                  pullError ? "border-danger" : "border-border"
                }`}
              />
              <button
                onClick={handlePullModel}
                disabled={isValidating}
                className="px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.88rem] cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isValidating ? t("modelEngines.validating") : t("modelEngines.pull")}
              </button>
            </div>
            {pullError && (
              <div className="font-mono text-[0.78rem] text-danger mt-2">
                {pullError}
              </div>
            )}
            <div className="font-mono text-[0.72rem] text-text-dim mt-2">
              {t("modelEngines.popular")}
            </div>
          </div>
        </div>
      )}

      {/* Connect / Configure Modal — 2-step */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-sm">
          <div className={`bg-bg-elevated border border-border rounded-2xl w-full p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative ${
            connectModalStep === "pick" && !editingProvider ? "max-w-[600px]" : "max-w-[460px]"
          }`}>
            <button
              onClick={() => setShowConnectModal(false)}
              className="absolute top-4 right-4 bg-transparent border-none text-text-dim text-xl cursor-pointer"
            >
              &times;
            </button>

            {/* Step 1: Provider Picker */}
            {connectModalStep === "pick" && !editingProvider ? (
              <>
                <h3 className="text-xl font-semibold mb-1">{t("modelEngines.chooseProvider")}</h3>
                <p className="text-text-muted text-[0.88rem] font-light mb-5">
                  {t("modelEngines.chooseProviderDesc")}
                </p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {PROVIDER_PICKER_OPTIONS.filter((p) => !connectedNames.has(p.name)).map((p) => (
                    <button
                      key={p.name}
                      onClick={() => selectPickerProvider(p)}
                      className="flex items-start gap-3 p-4 bg-bg-card border border-border rounded-xl text-left cursor-pointer transition-all hover:border-border-accent hover:bg-bg-card-hover group"
                    >
                      <span className="text-xl mt-0.5">{p.icon}</span>
                      <div className="min-w-0">
                        <div className="text-[0.9rem] font-semibold group-hover:text-accent transition-colors">{p.name}</div>
                        <div className="text-[0.75rem] text-text-dim font-light leading-snug mt-0.5">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-border pt-4">
                  <button
                    onClick={selectCustomProvider}
                    className="w-full flex items-center gap-3 p-4 bg-bg-card border border-dashed border-border rounded-xl text-left cursor-pointer transition-all hover:border-border-accent hover:bg-bg-card-hover group"
                  >
                    <span className="text-xl mt-0.5">+</span>
                    <div>
                      <div className="text-[0.9rem] font-semibold group-hover:text-accent transition-colors">{t("modelEngines.customEndpoint")}</div>
                      <div className="text-[0.75rem] text-text-dim font-light">{t("modelEngines.customEndpointDesc")}</div>
                    </div>
                  </button>
                </div>
              </>
            ) : (
              /* Step 2: Connection Form (also used for editing) */
              <>
                <h3 className="text-xl font-semibold mb-1">
                  {editingProvider ? t("modelEngines.configureProvider") : t("modelEngines.connectProvider")}
                </h3>
                <p className="text-text-muted text-[0.88rem] font-light mb-5">
                  {editingProvider ? t("modelEngines.configureProviderDesc") : t("modelEngines.connectProviderDesc")}
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
                      {t("modelEngines.providerName")}
                    </label>
                    <input
                      value={connectForm.name}
                      onChange={(e) => setConnectForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={t("modelEngines.providerNamePlaceholder")}
                      className="w-full px-4 py-3 bg-bg-card border border-border rounded-lg text-text font-body text-[0.88rem] outline-none focus:border-border-focus"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
                      {t("modelEngines.endpoint")}
                    </label>
                    <input
                      value={connectForm.endpoint}
                      onChange={(e) => {
                        setConnectForm((f) => ({ ...f, endpoint: e.target.value }));
                        if (connectError) setConnectError(null);
                      }}
                      placeholder={t("modelEngines.endpointPlaceholder")}
                      className={`w-full px-4 py-3 bg-bg-card border rounded-lg text-text font-mono text-[0.88rem] outline-none focus:border-border-focus ${
                        connectError ? "border-danger" : "border-border"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">
                      {t("modelEngines.providerType")}
                    </label>
                    <select
                      value={connectForm.type}
                      onChange={(e) => setConnectForm((f) => ({ ...f, type: e.target.value as "ollama" | "openai" }))}
                      className="w-full px-3 py-2.5 bg-bg border border-border rounded-lg text-text font-body text-[0.85rem] outline-none focus:border-border-focus appearance-none cursor-pointer"
                    >
                      <option value="ollama">Ollama</option>
                      <option value="openai">OpenAI-compatible</option>
                    </select>
                  </div>
                </div>

                {connectError && (
                  <div className="flex items-center gap-2 mt-4 px-3 py-2.5 bg-danger/10 border border-danger/30 rounded-lg">
                    <span className="text-danger text-sm">&#9888;</span>
                    <span className="text-[0.82rem] text-danger">{connectError}</span>
                  </div>
                )}

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleConnectSubmit}
                    disabled={isSubmitting || !connectForm.endpoint.trim() || !connectForm.name.trim()}
                    className="flex-1 px-5 py-3 bg-accent text-bg border-none rounded-lg font-body font-semibold text-[0.88rem] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTesting
                      ? t("modelEngines.testingConnection")
                      : isSubmitting
                      ? t("modelEngines.connecting")
                      : editingProvider
                      ? t("common.save")
                      : t("modelEngines.connect")}
                  </button>
                  {!editingProvider && (
                    <button
                      onClick={() => setConnectModalStep("pick")}
                      className="px-5 py-3 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer hover:border-text-muted"
                    >
                      {t("common.back")}
                    </button>
                  )}
                  <button
                    onClick={() => setShowConnectModal(false)}
                    className="px-5 py-3 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer hover:border-text-muted"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title={t("modelEngines.removeProvider")}
        description={t("modelEngines.removeProviderConfirm")}
        confirmLabel={t("common.delete")}
        variant="danger"
        loading={deleteProviderMutation.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveProvider}
      />

      <Toast message={toast} />
    </>
  );
}
