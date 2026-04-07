"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en, { type TranslationKeys, type Translations } from "./translations/en";
import es from "./translations/es";
import fr from "./translations/fr";
import de from "./translations/de";
import ja from "./translations/ja";
import zh from "./translations/zh";

export type Locale = "en" | "es" | "fr" | "de" | "ja" | "zh";

const translations: Record<Locale, Translations> = { en, es, fr, de, ja, zh };

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKeys, vars?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = (localStorage.getItem("language") as Locale) || "en";
    setLocaleState(saved);
    document.documentElement.lang = saved;
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("language", l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: TranslationKeys, vars?: Record<string, string>): string => {
      let str = translations[locale]?.[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, v);
        }
      }
      return str;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useTranslation must be used within LanguageProvider");
  return { t: context.t, locale: context.locale };
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return { locale: context.locale, setLocale: context.setLocale };
}

export type { TranslationKeys };
