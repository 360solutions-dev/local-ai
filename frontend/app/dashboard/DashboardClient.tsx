"use client";

import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import { useTranslation } from "@/lib/i18n";
import { useFlatConversations, useIndexedFiles, useOllamaModels, useSystemHealth } from "@/hooks/use-chat";

function StatCard({ label, value, change, valueClass, changeClass }: { label: string; value: string; change: string; valueClass?: string; changeClass?: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5">
      <div className="font-mono text-[0.7rem] text-text-dim tracking-wide uppercase mb-2">{label}</div>
      <div className={`text-[1.6rem] font-bold ${valueClass || ""}`}>{value}</div>
      <div className={`font-mono text-[0.72rem] text-accent mt-1 ${changeClass || ""}`}>{change}</div>
    </div>
  );
}

function FeatureCard({ href, icon, title, desc, tag, active, comingSoonLabel, activeLabel }: { href?: string; icon: string; title: string; desc: string; tag: string; active?: boolean; comingSoonLabel: string; activeLabel: string }) {
  const base = "bg-bg-card border border-border rounded-[14px] p-7 transition-all duration-250 relative overflow-hidden no-underline text-inherit block";
  const activeHover = "cursor-pointer hover:border-border-accent hover:bg-bg-card-hover hover:-translate-y-[3px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]";
  const comingSoon = "opacity-45 cursor-default";

  if (!active) {
    return (
      <div className={`${base} ${comingSoon}`}>
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-xl bg-accent/15 border border-border-accent flex items-center justify-center text-[1.3rem]">{icon}</div>
          <span className="font-mono text-[0.65rem] px-2 py-0.5 rounded text-accent-warm bg-accent-warm/[0.12] tracking-wide">{comingSoonLabel}</span>
        </div>
        <div className="text-[1.15rem] font-semibold mb-2">{title}</div>
        <div className="text-text-muted text-[0.88rem] font-light leading-relaxed mb-4">{desc}</div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.7rem] text-text-dim">{tag}</span>
        </div>
      </div>
    );
  }

  return (
    <Link className={`${base} ${activeHover} group`} href={href || "#"}>
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-accent/15 border border-border-accent flex items-center justify-center text-[1.3rem]">{icon}</div>
        <span className="font-mono text-[0.65rem] px-2 py-0.5 rounded text-accent bg-accent/15 tracking-wide">{activeLabel}</span>
      </div>
      <div className="text-[1.15rem] font-semibold mb-2">{title}</div>
      <div className="text-text-muted text-[0.88rem] font-light leading-relaxed mb-4">{desc}</div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[0.7rem] text-text-dim">{tag}</span>
        <span className="text-accent text-xl transition-transform group-hover:translate-x-1">→</span>
      </div>
    </Link>
  );
}

export default function DashboardClient() {
  const { t } = useTranslation();

  const { conversations, isLoading: loadingChats } = useFlatConversations();
  // Files are now scoped per-chat; the dashboard intentionally shows 0
  // until a future "all files across chats" endpoint is added.
  const { data: files, isLoading: loadingFiles } = useIndexedFiles(null);
  const { data: models, isLoading: loadingModels } = useOllamaModels();
  const { data: health, isLoading: loadingHealth } = useSystemHealth();

  const totalChats = conversations.length;
  const totalFiles = files?.length ?? 0;
  const totalModels = models?.length ?? 0;

  const modelDisplay = loadingModels
    ? "..."
    : models && models.length > 0
      ? models[0].name
      : t("dashboard.notConfigured");

  const modelChange = loadingModels
    ? "..."
    : totalModels > 0
      ? `${totalModels} model${totalModels !== 1 ? "s" : ""} installed`
      : t("dashboard.setupRequired");

  const healthStatus = loadingHealth
    ? "..."
    : health?.ollama && health?.database
      ? t("dashboard.online")
      : health?.ollama || health?.database
        ? t("dashboard.degraded")
        : t("dashboard.offline");

  const healthChange = loadingHealth
    ? "..."
    : health?.ollama && health?.database
      ? t("dashboard.allHealthy")
      : !health?.ollama && !health?.database
        ? "Ollama & DB unreachable"
        : !health?.ollama
          ? "Ollama unreachable"
          : "Database unreachable";

  const healthValueClass = loadingHealth
    ? ""
    : health?.ollama && health?.database
      ? "text-accent"
      : "text-accent-warm";

  return (
    <div className="font-body bg-bg text-text min-h-screen relative">
      {/* Noise overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

      <div className="flex min-h-screen">
        <Sidebar activePage="dashboard" />

        <main className="flex-1 p-10 overflow-y-auto">
          <div className="mb-10">
            <div className="text-[0.85rem] text-text-dim font-mono tracking-wide mb-2">{t("dashboard.welcomeMessage")}</div>
            <h1 className="text-[2rem] font-bold tracking-tight">{t("dashboard.title")}</h1>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-10 max-[900px]:grid-cols-2">
            <StatCard
              label={t("dashboard.totalChats")}
              value={loadingChats ? "..." : String(totalChats)}
              change={totalChats === 0 ? t("dashboard.newInstance") : `${totalChats} conversation${totalChats !== 1 ? "s" : ""}`}
            />
            <StatCard
              label={t("dashboard.filesIndexed")}
              value={loadingFiles ? "..." : String(totalFiles)}
              change={totalFiles === 0 ? t("dashboard.uploadFiles") : `${totalFiles} file${totalFiles !== 1 ? "s" : ""} indexed`}
            />
            <StatCard
              label={t("dashboard.modelEngine")}
              value={modelDisplay}
              valueClass={totalModels > 0 ? "" : "text-accent text-[1.1rem]"}
              change={modelChange}
              changeClass={totalModels > 0 ? "" : "text-accent-warm!"}
            />
            <StatCard
              label={t("dashboard.systemStatus")}
              value={healthStatus}
              valueClass={healthValueClass}
              change={healthChange}
            />
          </div>

          <div className="font-mono text-[0.75rem] text-text-dim tracking-widest uppercase mb-4">{t("dashboard.aiTools")}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            <FeatureCard active href="/chat" icon="💬" title={t("dashboard.chatWithFiles")} desc={t("dashboard.chatWithFilesDesc")} tag={t("dashboard.chatWithFilesTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
            <FeatureCard icon="🔊" title={t("dashboard.textToAudio")} desc={t("dashboard.textToAudioDesc")} tag={t("dashboard.textToAudioTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
            <FeatureCard icon="🖼️" title={t("dashboard.imageGeneration")} desc={t("dashboard.imageGenerationDesc")} tag={t("dashboard.imageGenerationTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
            <FeatureCard icon="📝" title={t("dashboard.summarizer")} desc={t("dashboard.summarizerDesc")} tag={t("dashboard.summarizerTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
            <FeatureCard icon="🔍" title={t("dashboard.semanticSearch")} desc={t("dashboard.semanticSearchDesc")} tag={t("dashboard.semanticSearchTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
            <FeatureCard icon="🔌" title={t("dashboard.pluginSystem")} desc={t("dashboard.pluginSystemDesc")} tag={t("dashboard.pluginSystemTag")} comingSoonLabel={t("common.comingSoon")} activeLabel={t("common.active")} />
          </div>
        </main>
      </div>
    </div>
  );
}
