"use client";

import { Cloud, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface Props {
  modelName: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function CloudModelWarning({ modelName, open, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-[8px] animate-[fadeIn_0.3s_ease]"
      onClick={onCancel}
    >
      <div
        className="bg-bg-elevated border border-accent-warm/40 rounded-2xl w-full max-w-[480px] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative animate-[cardIn_0.3s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-4 right-4 bg-transparent border-none text-text-dim cursor-pointer p-1 rounded transition-colors hover:text-text"
          onClick={onCancel}
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        <div className="w-14 h-14 rounded-[14px] bg-accent-warm/10 border border-accent-warm/30 flex items-center justify-center mb-5 text-accent-warm">
          <Cloud size={26} />
        </div>

        <h2 className="text-xl font-bold mb-2">{t("cloudModel.title")}</h2>

        <p className="text-text-muted text-[0.92rem] font-light leading-relaxed mb-4">
          {t("cloudModel.body", { name: modelName })}
        </p>

        <ul className="text-[0.88rem] text-text-muted leading-relaxed mb-5 space-y-1.5 list-disc pl-5">
          <li>{t("cloudModel.point1")}</li>
          <li>{t("cloudModel.point2")}</li>
          <li>{t("cloudModel.point3")}</li>
        </ul>

        <div className="p-3 bg-accent-warm/[0.07] border border-accent-warm/20 rounded-lg text-[0.85rem] text-text leading-relaxed mb-5">
          <strong className="text-accent-warm">{t("cloudModel.tipLabel")}</strong>{" "}
          {t("cloudModel.tipBody")}
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            className="flex-1 py-2.5 px-4 bg-accent text-bg border-none rounded-lg font-body text-[0.9rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5"
            onClick={onCancel}
          >
            {t("cloudModel.chooseOffline")}
          </button>
          {/*
            "Continue anyway" disabled — local-ai.run is privacy-first and
            cloud-routed models contradict that promise. Uncomment to let
            advanced users bypass the warning.
          <button
            type="button"
            className="flex-1 py-2.5 px-4 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.9rem] cursor-pointer transition-all hover:border-accent-warm hover:text-accent-warm"
            onClick={onConfirm}
          >
            {t("cloudModel.continueAnyway")}
          </button>
          */}
        </div>
      </div>
    </div>
  );
}
