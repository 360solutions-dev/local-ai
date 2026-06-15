"use client";

import { useState } from "react";
import { Check, Copy, Download, ShieldAlert } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface Props {
  code: string;
  email?: string;
  className?: string;
}

export default function RecoveryCodeDisplay({ code, email, className = "" }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const lines = [
      "local-ai.run — Recovery Code",
      "================================",
      "",
      email ? `Account: ${email}` : "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Recovery Code:",
      code,
      "",
      "Keep this code secret and safe.",
      "Use it on the Forgot Password screen if you lose access to your account.",
      "This code is single-use — after using it, generate a new one from Settings → Security.",
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `local-ai-recovery-code-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`bg-bg-elevated border border-accent/40 rounded-xl p-5 ${className}`}>
      <div className="flex items-center gap-2 text-accent-warm mb-3">
        <ShieldAlert size={18} />
        <span className="font-semibold text-[0.85rem] tracking-wide uppercase">
          {t("recovery.saveNow")}
        </span>
      </div>

      <p className="text-text-muted text-[0.88rem] leading-relaxed mb-4 font-light">
        {t("recovery.saveDescription")}
      </p>

      <div className="bg-bg border border-border rounded-lg px-4 py-3.5 mb-4 font-mono text-[1rem] text-accent tracking-widest text-center select-all break-all">
        {code}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated text-text-muted text-[0.85rem] font-medium transition-all hover:border-accent hover:text-accent cursor-pointer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("recovery.copied") : t("recovery.copy")}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated text-text-muted text-[0.85rem] font-medium transition-all hover:border-accent hover:text-accent cursor-pointer"
        >
          <Download size={14} />
          {t("recovery.download")}
        </button>
      </div>
    </div>
  );
}
