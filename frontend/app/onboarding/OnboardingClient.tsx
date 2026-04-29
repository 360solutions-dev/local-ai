"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useRegister } from "@/hooks/use-auth";
import { useSystemHealth } from "@/hooks/use-chat";
import { useTranslation } from "@/lib/i18n";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import InfoCard from "@/components/ui/InfoCard";

interface CheckItem {
  key: string;
  label: string;
  status: "pending" | "checking" | "ok" | "warn";
}

export default function OnboardingClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pwVisible, setPwVisible] = useState(false);
  const [error, setError] = useState("");

  const register = useRegister();
  const { data: health, isLoading: healthLoading } = useSystemHealth();

  // Dynamic checks for step 3
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [checksRunning, setChecksRunning] = useState(false);

  useEffect(() => {
    if (step !== 3 || checksRunning) return;
    setChecksRunning(true);

    const items: CheckItem[] = [
      { key: "admin", label: t("onboarding.adminCreated"), status: "pending" },
      { key: "ollama", label: t("onboarding.ollamaConnected"), status: "pending" },
      { key: "database", label: t("onboarding.databaseReady"), status: "pending" },
      { key: "rag", label: t("onboarding.fileStorageReady"), status: "pending" },
      { key: "whisper", label: t("onboarding.whisperConnected"), status: "pending" },
    ];
    setChecks(items);

    // Each check does a live fetch so we don't depend on cached/stale data
    async function checkService(key: string): Promise<boolean> {
      try {
        if (key === "admin") return true;
        if (key === "ollama" || key === "database" || key === "rag") {
          const resp = await fetch("/api/rag/health", { credentials: "include" });
          if (!resp.ok) return false;
          const data = await resp.json();
          if (key === "ollama") return data.ollama === true;
          if (key === "database") return data.database === true;
          if (key === "rag") return data.status === "ok" || data.status === "degraded";
        }
        if (key === "whisper") {
          const resp = await fetch("/api/system/services/whisper/health/", { credentials: "include" });
          if (!resp.ok) return false;
          const data = await resp.json();
          return data.connected === true;
        }
      } catch {
        return false;
      }
      return false;
    }

    // Run checks sequentially with a short stagger for visual effect
    async function runChecks() {
      for (let i = 0; i < items.length; i++) {
        setChecks((prev) => prev.map((c, j) => j === i ? { ...c, status: "checking" } : c));
        await new Promise((r) => setTimeout(r, 400));
        const ok = await checkService(items[i].key);
        setChecks((prev) => prev.map((c, j) => j === i ? { ...c, status: ok ? "ok" : "warn" } : c));
      }
    }
    runChecks();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const servicesOnline = !healthLoading && health?.ollama && health?.database;

  function handleAdminSubmit(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const displayName = (form.elements.namedItem("displayName") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value;

    if (password.length < 8) {
      setError(t("onboarding.passwordMinChars"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("onboarding.passwordsNoMatch"));
      return;
    }

    setError("");
    register.mutate(
      { display_name: displayName, email, password },
      {
        onSuccess: () => setStep(3),
        onError: (err) => setError(err.message),
      },
    );
  }

  const btnFullWidth = "w-full py-3.5 px-8 text-base font-semibold shadow-[0_0_30px_rgba(52,211,153,0.3)] mt-2 hover:shadow-[0_0_50px_rgba(52,211,153,0.3)]";

  return (
    <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center overflow-hidden relative">
      {/* Noise overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

      {/* Ambient glow */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse,rgba(52,211,153,0.15)_0%,transparent_65%)] pointer-events-none z-0" />

      <div className="relative z-1 w-full max-w-[480px] px-8">
        {/* Logo */}
        <div className="flex items-center gap-2.5 font-mono text-lg text-accent mb-10 tracking-wide">
          <span className="text-accent">local</span>
          <span className="text-text-dim animate-pulse">-</span>
          <span className="text-accent">ai</span>
          <span className="text-text-dim">.run</span>
        </div>

        {/* Step indicators */}
        <div className="flex gap-2 mb-8">
          <div className={`h-[3px] rounded-full transition-all duration-300 ${step >= 1 ? "bg-accent w-12" : "bg-border w-8"}`} />
          <div className={`h-[3px] rounded-full transition-all duration-300 ${step >= 2 ? "bg-accent w-12" : "bg-border w-8"}`} />
          <div className={`h-[3px] rounded-full transition-all duration-300 ${step >= 3 ? "bg-accent w-12" : "bg-border w-8"}`} />
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="animate-[cardIn_0.4s_ease]">
            <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">
              {t("onboarding.welcomeTo")} <span className="bg-linear-to-br from-accent to-accent-secondary bg-clip-text text-transparent">local-ai.run</span>
            </h1>
            <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
              {t("onboarding.subtitle")}
            </p>

            <div className="flex flex-col gap-3 mb-8">
              <InfoCard icon="🔒">{t("onboarding.runsOnHardware")}</InfoCard>
              <InfoCard icon="🧠">{t("onboarding.bringModels")}</InfoCard>
              <InfoCard icon="📁">{t("onboarding.chatAndMore")}</InfoCard>
            </div>

            <div className="bg-bg-elevated border border-border rounded-lg px-4 py-3 font-mono text-[0.78rem] text-text-dim leading-relaxed mb-8">
              <span className="text-accent">$</span> docker compose up -d
              <br />
              {healthLoading ? (
                <span className="text-text-dim flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  {t("onboarding.checkingServices")}
                </span>
              ) : servicesOnline ? (
                <span className="text-accent">{t("onboarding.allServicesRunning")}</span>
              ) : (
                <span className="text-accent-warm">{t("onboarding.someServicesOffline")}</span>
              )}
            </div>

            <Button className={btnFullWidth} onClick={() => setStep(2)}>
              {t("onboarding.letsGetStarted")}
            </Button>
          </div>
        )}

        {/* Step 2: Create Admin */}
        {step === 2 && (
          <div className="animate-[cardIn_0.4s_ease]">
            <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">{t("onboarding.createAdmin")}</h1>
            <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
              {t("onboarding.createAdminSubtitle")}
            </p>

            <ErrorAlert message={error} className="mb-5" />

            <form onSubmit={handleAdminSubmit}>
              <div className="mb-5">
                <label className="block font-mono text-[0.75rem] text-text-muted tracking-wide uppercase mb-2" htmlFor="displayName">{t("onboarding.displayName")}</label>
                <Input type="text" id="displayName" name="displayName" placeholder={t("onboarding.displayNamePlaceholder")} required />
              </div>

              <div className="mb-5">
                <label className="block font-mono text-[0.75rem] text-text-muted tracking-wide uppercase mb-2" htmlFor="email">{t("onboarding.email")}</label>
                <Input type="email" id="email" name="email" placeholder={t("onboarding.emailPlaceholder")} required />
              </div>

              <div className="mb-5">
                <label className="block font-mono text-[0.75rem] text-text-muted tracking-wide uppercase mb-2" htmlFor="password">{t("onboarding.password")}</label>
                <div className="relative">
                  <Input type={pwVisible ? "text" : "password"} id="password" name="password" placeholder={t("onboarding.passwordPlaceholder")} minLength={8} required />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-text-dim cursor-pointer text-[0.85rem] font-mono transition-colors hover:text-accent"
                    onClick={() => setPwVisible((v) => !v)}
                  >
                    {pwVisible ? t("onboarding.hide") : t("onboarding.show")}
                  </button>
                </div>
              </div>

              <div className="mb-5">
                <label className="block font-mono text-[0.75rem] text-text-muted tracking-wide uppercase mb-2" htmlFor="confirmPassword">{t("onboarding.confirmPassword")}</label>
                <Input type="password" id="confirmPassword" name="confirmPassword" placeholder={t("onboarding.confirmPasswordPlaceholder")} required />
              </div>

              <Button className={btnFullWidth} type="submit" loading={register.isPending}>
                {register.isPending ? t("onboarding.creatingAccount") : t("onboarding.createAdminBtn")}
              </Button>
            </form>
          </div>
        )}

        {/* Step 3: Success — dynamic health checks */}
        {step === 3 && (
          <div className="animate-[cardIn_0.4s_ease]">
            <div className="w-[72px] h-[72px] rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center text-3xl mb-6 animate-[scaleIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">✓</div>
            <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">{t("onboarding.allSet")}</h1>
            <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
              {t("onboarding.instanceReady")}
            </p>

            <div className="mb-8">
              {checks.map((check) => (
                <div key={check.key} className="flex items-center gap-3 py-2.5 text-[0.9rem] text-text-muted">
                  {check.status === "pending" && (
                    <span className="w-4 h-4 flex items-center justify-center text-border">○</span>
                  )}
                  {check.status === "checking" && (
                    <span className="w-4 h-4 flex items-center justify-center">
                      <span className="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </span>
                  )}
                  {check.status === "ok" && (
                    <span className="w-4 h-4 flex items-center justify-center text-accent font-mono text-[0.85rem]">✔</span>
                  )}
                  {check.status === "warn" && (
                    <span className="w-4 h-4 flex items-center justify-center text-accent-warm font-mono text-[0.85rem]">!</span>
                  )}
                  <span className={check.status === "ok" ? "text-text" : check.status === "warn" ? "text-accent-warm" : ""}>{check.label}</span>
                </div>
              ))}
            </div>

            <Button
              className={btnFullWidth}
              onClick={() => router.push("/dashboard")}
              disabled={checks.some((c) => c.status === "pending" || c.status === "checking")}
            >
              {t("onboarding.goToDashboard")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
