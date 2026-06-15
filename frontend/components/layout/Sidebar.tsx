"use client";

import Link from "next/link";
import SidebarUser from "./SidebarUser";
import { useTranslation } from "@/lib/i18n";

interface SidebarProps {
  activePage?: string;
}

function NavItem({ href, icon, label, active, disabled }: { href?: string; icon: string; label: string; active?: boolean; disabled?: boolean }) {
  const base = "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.88rem] no-underline transition-all mb-0.5";
  const activeClass = "bg-accent/15 text-accent border border-border-accent";
  const normalClass = "text-text-muted hover:bg-bg-card hover:text-text";
  const disabledClass = "opacity-40 cursor-default text-text-muted";

  const className = `${base} ${disabled ? disabledClass : active ? activeClass : normalClass}`;

  if (disabled || !href) {
    return (
      <span className={className}>
        <span className="w-5 text-center text-[0.95rem]">{icon}</span> {label}
      </span>
    );
  }

  return (
    <Link className={className} href={href}>
      <span className="w-5 text-center text-[0.95rem]">{icon}</span> {label}
    </Link>
  );
}

export default function Sidebar({ activePage }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="w-[260px] h-screen sticky top-0 bg-bg-elevated border-r border-border flex flex-col shrink-0">
      <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5 font-mono text-base text-accent no-underline border-b border-border">
        <svg viewBox="0 0 28 28" fill="none" className="w-6 h-6">
          <path d="M14 2.5L4 7v7c0 6.1 4.3 11.5 10 13 5.7-1.5 10-6.9 10-13V7L14 2.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="14" cy="11" r="2" fill="currentColor" />
          <circle cx="9" cy="17" r="1.3" fill="currentColor" />
          <circle cx="19" cy="17" r="1.3" fill="currentColor" />
          <circle cx="14" cy="21" r="1.3" fill="currentColor" />
          <path d="M14 13v2.5l-4 2M14 15.5l4 2M9 17l5 4M19 17l-5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-accent">local</span>
        <span className="text-text-dim animate-[cursorBlink_1.2s_step-end_infinite]">-</span>
        <span className="text-accent">ai</span>
        <span className="text-text-dim">.run</span>
      </Link>

      <nav className="p-3 flex-1 overflow-y-auto">
        <div className="font-mono text-[0.68rem] text-text-dim tracking-widest uppercase px-2.5 pt-3 pb-1.5">{t("sidebar.navigation")}</div>
        <NavItem href="/dashboard" icon="📊" label={t("sidebar.dashboard")} active={activePage === "dashboard"} />
        <NavItem href="/chat" icon="💬" label={t("sidebar.chatWithFiles")} active={activePage === "chat"} />

        <div className="font-mono text-[0.68rem] text-text-dim tracking-widest uppercase px-2.5 pt-5 pb-1.5">{t("sidebar.comingSoon")}</div>
        <NavItem icon="🔊" label={t("sidebar.textToAudio")} disabled />
        <NavItem icon="🖼️" label={t("sidebar.imageGeneration")} disabled />
        <NavItem icon="📝" label={t("sidebar.summarizer")} disabled />
        <NavItem icon="🔍" label={t("sidebar.semanticSearch")} disabled />

        <div className="font-mono text-[0.68rem] text-text-dim tracking-widest uppercase px-2.5 pt-5 pb-1.5">{t("sidebar.system")}</div>
        <NavItem href="/settings" icon="⚙️" label={t("sidebar.settings")} active={activePage === "settings"} />
        <NavItem href="/model-engines" icon="🔌" label={t("sidebar.modelEngines")} active={activePage === "model-engines"} />
      </nav>

      <SidebarUser />
    </aside>
  );
}
