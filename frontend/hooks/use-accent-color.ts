"use client";

import { useCallback, useEffect, useState } from "react";

export type AccentColor = "emerald" | "cyan" | "violet" | "amber" | "rose";

interface AccentPalette {
  accent: string;
  accentSecondary: string;
  borderAccent: string;
  borderFocus: string;
}

const darkPalettes: Record<AccentColor, AccentPalette> = {
  emerald: { accent: "#34d399", accentSecondary: "#22d3ee", borderAccent: "#2d4a3e", borderFocus: "#34d399" },
  cyan:    { accent: "#22d3ee", accentSecondary: "#34d399", borderAccent: "#1e3a4a", borderFocus: "#22d3ee" },
  violet:  { accent: "#a78bfa", accentSecondary: "#c084fc", borderAccent: "#3b2d5e", borderFocus: "#a78bfa" },
  amber:   { accent: "#f59e0b", accentSecondary: "#fbbf24", borderAccent: "#4a3b1e", borderFocus: "#f59e0b" },
  rose:    { accent: "#fb7185", accentSecondary: "#f472b6", borderAccent: "#4a2d3e", borderFocus: "#fb7185" },
};

const lightPalettes: Record<AccentColor, AccentPalette> = {
  emerald: { accent: "#22b07d", accentSecondary: "#1aa8c9", borderAccent: "#a7d7c5", borderFocus: "#22b07d" },
  cyan:    { accent: "#1aa8c9", accentSecondary: "#22b07d", borderAccent: "#a7c5d7", borderFocus: "#1aa8c9" },
  violet:  { accent: "#8b5cf6", accentSecondary: "#a855f7", borderAccent: "#c5a7d7", borderFocus: "#8b5cf6" },
  amber:   { accent: "#d97b06", accentSecondary: "#ca8a04", borderAccent: "#d7c5a7", borderFocus: "#d97b06" },
  rose:    { accent: "#e11d48", accentSecondary: "#db2777", borderAccent: "#d7a7b5", borderFocus: "#e11d48" },
};

function getResolvedTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function applyAccentColor(color: AccentColor) {
  const theme = getResolvedTheme();
  const palette = theme === "light" ? lightPalettes[color] : darkPalettes[color];
  const root = document.documentElement;
  root.style.setProperty("--color-accent", palette.accent);
  root.style.setProperty("--color-accent-secondary", palette.accentSecondary);
  root.style.setProperty("--color-border-accent", palette.borderAccent);
  root.style.setProperty("--color-border-focus", palette.borderFocus);
}

export function useAccentColor() {
  const [accentColor, setAccentColorState] = useState<AccentColor>("emerald");

  useEffect(() => {
    const saved = (localStorage.getItem("accentColor") as AccentColor) || "emerald";
    setAccentColorState(saved);
    applyAccentColor(saved);
  }, []);

  // Re-apply when theme changes (dark/light switch)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      applyAccentColor(accentColor);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [accentColor]);

  const setAccentColor = useCallback((c: AccentColor) => {
    setAccentColorState(c);
    localStorage.setItem("accentColor", c);
    applyAccentColor(c);
  }, []);

  return { accentColor, setAccentColor };
}
