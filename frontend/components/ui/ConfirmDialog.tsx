"use client";

import { useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "danger" | "warning";
  requireTypedConfirmation?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "danger",
  requireTypedConfirmation,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  if (!open) return null;

  const canConfirm = requireTypedConfirmation
    ? typed === requireTypedConfirmation
    : true;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-[fadeIn_0.15s_ease]"
      onClick={onCancel}
    >
      <div
        className="bg-bg-card border border-border rounded-2xl p-6 w-full max-w-[440px] mx-4 shadow-[0_16px_64px_rgba(0,0,0,0.5)] animate-[cardIn_0.2s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-lg font-semibold mb-2 ${isDanger ? "text-danger" : "text-text"}`}>
          {title}
        </h3>
        <p className="text-[0.88rem] text-text-muted font-light leading-relaxed mb-5">
          {description}
        </p>

        {requireTypedConfirmation && (
          <div className="mb-5">
            <label className="block text-[0.82rem] text-text-muted mb-2">
              Type <span className="font-mono font-semibold text-text">{requireTypedConfirmation}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text font-mono text-[0.88rem] outline-none transition-colors focus:border-border-focus placeholder:text-text-dim"
              placeholder={requireTypedConfirmation}
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-5 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all hover:border-text-muted hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            className={`px-5 py-2.5 rounded-lg font-body text-[0.88rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isDanger
                ? "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20"
                : "bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20"
            }`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
