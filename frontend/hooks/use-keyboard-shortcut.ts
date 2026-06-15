"use client";

import { useEffect } from "react";

interface ShortcutOptions {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  enabled?: boolean;
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcut({
  key,
  meta = false,
  shift = false,
  alt = false,
  handler,
  enabled = true,
}: ShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isEditingTarget(e.target)) return;

      const metaPressed = e.metaKey || e.ctrlKey;
      if (meta && !metaPressed) return;
      if (!meta && metaPressed) return;
      if (shift && !e.shiftKey) return;
      if (!shift && e.shiftKey) return;
      if (alt && !e.altKey) return;
      if (!alt && e.altKey) return;

      if (e.key.toLowerCase() !== key.toLowerCase()) return;

      e.preventDefault();
      handler(e);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, meta, shift, alt, handler, enabled]);
}
