"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useUpdateNotifier } from "@/hooks/use-update-notifier";
import { useTranslation } from "@/lib/i18n";

const HIDDEN_PATHS = ["/login", "/onboarding", "/settings"];

export default function UpdateNotificationBanner() {
  const { shouldShow, latestVersion, dismiss } = useUpdateNotifier();
  const { t } = useTranslation();
  const pathname = usePathname();

  if (!shouldShow || !latestVersion) return null;
  if (pathname && HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-[1100] max-w-sm bg-bg-elevated border border-border-accent rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-4 flex items-start gap-3 transition-all duration-300"
    >
      <Sparkles className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[0.85rem] text-accent font-semibold mb-1">
          {t("updateNotifier.title")}
        </p>
        <p className="font-mono text-[0.75rem] text-text-muted mb-3">
          {t("updateNotifier.message", { version: latestVersion })}
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 font-mono text-[0.78rem] text-accent hover:text-accent-secondary transition-colors"
        >
          {t("updateNotifier.viewAction")}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("updateNotifier.dismiss")}
        className="text-text-muted hover:text-text transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
