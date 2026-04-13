"use client";

import { FormEvent, useCallback, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { useLogin, useResetPassword } from "@/hooks/use-auth";
import { useTranslation } from "@/lib/i18n";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import Logo from "@/components/ui/Logo";

export default function LoginClient() {
  const { t } = useTranslation();
  const [showError, setShowError] = useState(false);
  const [errorText, setErrorText] = useState("Invalid email or password.");
  const [emailErr, setEmailErr] = useState(false);
  const [pwErr, setPwErr] = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [resetError, setResetError] = useState("");

  const login = useLogin();
  const resetPw = useResetPassword();

  const clearError = useCallback(() => {
    setShowError(false);
    setEmailErr(false);
    setPwErr(false);
  }, []);

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    clearError();

    login.mutate(
      { email, password },
      {
        onError: (err) => {
          setEmailErr(true);
          setPwErr(true);
          setErrorText(err.message);
          setShowError(true);
        },
      },
    );
  }

  function submitReset() {
    const token = (
      document.getElementById("resetToken") as HTMLInputElement | null
    )?.value?.trim();
    const newPw = (document.getElementById("newPw") as HTMLInputElement | null)?.value ?? "";
    const confirmPw =
      (document.getElementById("confirmNewPw") as HTMLInputElement | null)?.value ?? "";

    setResetError("");

    if (!token) {
      setResetError(t("login.enterResetTokenAlert"));
      return;
    }
    if (newPw.length < 8) {
      setResetError(t("login.passwordMinChars"));
      return;
    }
    if (newPw !== confirmPw) {
      setResetError(t("login.passwordsNoMatch"));
      return;
    }

    resetPw.mutate(
      { token, new_password: newPw },
      {
        onSuccess: () => setForgotStep(3),
        onError: (err) => setResetError(err.message),
      },
    );
  }

  function copyCmd(btn: HTMLButtonElement, text: string) {
    void navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = t("common.copied");
    window.setTimeout(() => {
      btn.textContent = prev;
    }, 1500);
  }

  const inputBase =
    "w-full px-4 py-3 bg-bg-card border border-border rounded-lg text-text font-body text-[0.95rem] outline-none transition-all duration-200 placeholder:text-text-dim focus:border-border-focus focus:shadow-[0_0_0_3px_rgba(52,211,153,0.15)]";

  return (
    <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center overflow-hidden relative">
      {/* Noise overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

      {/* Ambient glow */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse,rgba(52,211,153,0.15)_0%,transparent_65%)] pointer-events-none z-0" />

      <div className="relative z-1 w-full max-w-[420px] px-8">
        {/* Logo */}
        <div className="flex items-center justify-center mb-10">
          <Logo />
        </div>

        {/* Card */}
        <div className="bg-bg-elevated border border-border rounded-2xl p-8 shadow-[0_25px_80px_rgba(0,0,0,0.4)] animate-[cardIn_0.5s_ease]">
          <h1 className="text-[1.4rem] font-bold text-center mb-1">{t("login.welcomeBack")}</h1>
          <p className="text-center text-text-muted text-[0.9rem] font-light mb-7">
            {t("login.signInSubtitle")}
          </p>

          {/* Error */}
          {showError && (
            <ErrorAlert message={errorText} className="mb-5" />
          )}

          <form onSubmit={handleLogin}>
            <div className="mb-5">
              <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5" htmlFor="email">
                {t("login.email")}
              </label>
              <Input
                error={emailErr}
                type="email"
                id="email"
                name="email"
                placeholder={t("login.emailPlaceholder")}
                required
                autoComplete="email"
                onInput={clearError}
              />
            </div>

            <div className="mb-5">
              <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5" htmlFor="password">
                {t("login.password")}
              </label>
              <div className="relative">
                <Input
                  error={pwErr}
                  type={pwVisible ? "text" : "password"}
                  id="password"
                  name="password"
                  placeholder={t("login.passwordPlaceholder")}
                  required
                  autoComplete="current-password"
                  onInput={clearError}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-text-dim cursor-pointer text-[0.85rem] font-mono transition-colors hover:text-accent"
                  onClick={() => setPwVisible((v) => !v)}
                >
                  {pwVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-6">
              <label className="flex items-center gap-2 text-[0.85rem] text-text-muted cursor-pointer select-none">
                <div className="relative w-4 h-4">
                  <input type="checkbox" className="peer w-4 h-4 rounded border border-border bg-bg-card appearance-none cursor-pointer checked:bg-accent checked:border-accent" defaultChecked />
                  <Check size={12} className="absolute top-0.5 left-0.5 pointer-events-none hidden peer-checked:block text-bg" strokeWidth={3.5} />
                </div>
                {t("login.rememberMe")}
              </label>
              <a
                href="#"
                className="text-[0.85rem] text-accent no-underline font-medium transition-opacity hover:opacity-80"
                onClick={(e) => {
                  e.preventDefault();
                  setForgotOpen(true);
                  setForgotStep(1);
                  setResetError("");
                }}
              >
                {t("login.forgotPassword")}
              </a>
            </div>

            <Button variant="primary" type="submit" loading={login.isPending} className="w-full py-3.5">
              {login.isPending ? t("login.signingIn") : t("login.signIn")}
            </Button>
          </form>
        </div>

        <div className="text-center mt-6 text-[0.82rem] text-text-dim">
          {t("login.runningOn")} <strong className="text-text-muted">{typeof window !== "undefined" ? window.location.host : ""}</strong> · {t("login.allDataLocal")}
        </div>
        <div className="font-mono text-[0.72rem] text-text-dim text-center mt-8 opacity-60">
          local-ai.run v1.0.0
        </div>
      </div>

      {/* Forgot Password Overlay */}
      {forgotOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-[8px] animate-[fadeIn_0.3s_ease]">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[460px] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)] relative animate-[cardIn_0.3s_ease]">
            <button
              type="button"
              className="absolute top-4 right-4 bg-transparent border-none text-text-dim text-xl cursor-pointer px-1.5 py-0.5 rounded transition-colors hover:text-text"
              onClick={() => { setForgotOpen(false); setForgotStep(1); }}
            >
              ✕
            </button>

            {/* Step 1 */}
            {forgotStep === 1 && (
              <div>
                <div className="w-14 h-14 rounded-[14px] bg-accent-warm/10 border border-accent-warm/20 flex items-center justify-center text-2xl mb-5">🔐</div>
                <div className="text-xl font-bold mb-1.5">{t("login.resetPassword")}</div>
                <div className="text-text-muted text-[0.9rem] font-light leading-relaxed mb-6">
                  {t("login.resetOfflineNote")}
                </div>

                <div className="bg-bg border border-border rounded-[10px] overflow-hidden mb-5">
                  <div className="flex items-center justify-between px-3 py-2 bg-bg-card border-b border-border">
                    <span className="font-mono text-[0.7rem] text-text-dim">{t("login.runOnServer")}</span>
                    <button
                      type="button"
                      className="bg-transparent border-none text-text-dim font-mono text-[0.7rem] cursor-pointer px-1.5 py-0.5 rounded transition-colors hover:text-accent"
                      onClick={(e) => copyCmd(e.currentTarget, "docker exec local-ai-api python manage.py reset-password")}
                    >
                      {t("common.copy")}
                    </button>
                  </div>
                  <div className="px-4 py-3 font-mono text-[0.82rem] leading-[1.7]">
                    <span className="text-accent">$</span> docker exec local-ai-api python manage.py reset-password
                    <br /><br />
                    <span className="text-text-muted">{t("login.enterAdminEmail")}</span>
                    <span className="text-accent-warm">admin@company.com</span>
                    <br />
                    <span className="text-text-muted">{t("login.resetTokenGenerated")}</span>
                    <br />
                    <span className="text-accent-warm">RX7K-4M2N-9PWT</span>
                    <br />
                    <span className="text-text-muted">{t("login.tokenExpires")}</span>
                  </div>
                </div>

                <div className="flex gap-2.5 p-3 bg-accent-warm/[0.06] border border-accent-warm/15 rounded-lg text-[0.82rem] text-text-muted leading-relaxed mb-5">
                  <span className="shrink-0">💡</span>
                  <span>{t("login.terminalAccessNote")}</span>
                </div>

                <button type="button" className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5" onClick={() => setForgotStep(2)}>
                  {t("login.haveResetToken")}
                </button>
                <button type="button" className="flex items-center justify-center w-full py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all mt-2 hover:border-text-muted hover:text-text" onClick={() => { setForgotOpen(false); setForgotStep(1); }}>
                  {t("login.backToSignIn")}
                </button>
              </div>
            )}

            {/* Step 2 */}
            {forgotStep === 2 && (
              <div>
                <div className="w-14 h-14 rounded-[14px] bg-accent-warm/10 border border-accent-warm/20 flex items-center justify-center text-2xl mb-5">🔑</div>
                <div className="text-xl font-bold mb-1.5">{t("login.enterResetToken")}</div>
                <div className="text-text-muted text-[0.9rem] font-light leading-relaxed mb-6">
                  {t("login.pasteToken")}
                </div>

                {resetError && <ErrorAlert message={resetError} className="mb-5" />}

                <div className="mb-5">
                  <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("login.resetToken")}</label>
                  <input
                    className="w-full px-4 py-2.5 bg-bg-card border border-border rounded-lg text-text font-mono text-[0.9rem] tracking-[0.15em] text-center outline-none transition-colors focus:border-border-focus placeholder:tracking-[0.05em] placeholder:text-text-dim"
                    type="text"
                    id="resetToken"
                    placeholder="XXXX-XXXX-XXXX"
                    maxLength={14}
                    autoComplete="off"
                  />
                </div>

                <div className="mb-4 space-y-4">
                  <div>
                    <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.newPassword")}</label>
                    <input className={inputBase} type="password" id="newPw" placeholder={t("settings.security.minChars")} minLength={8} />
                  </div>
                  <div>
                    <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.confirmNewPassword")}</label>
                    <input className={inputBase} type="password" id="confirmNewPw" placeholder={t("settings.security.reEnterPassword")} />
                  </div>
                </div>

                <button type="button" className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5" onClick={submitReset}>
                  {t("login.resetPasswordBtn")}
                </button>
                <button type="button" className="flex items-center justify-center w-full py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all mt-2 hover:border-text-muted hover:text-text" onClick={() => setForgotStep(1)}>
                  ← Back
                </button>
              </div>
            )}

            {/* Step 3 */}
            {forgotStep === 3 && (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center text-3xl mx-auto mb-4 animate-[scaleIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">✓</div>
                <div className="text-xl font-bold mb-1.5">{t("login.passwordReset")}</div>
                <div className="text-text-muted text-[0.9rem] font-light leading-relaxed mb-6">
                  {t("login.passwordResetSuccess")}
                </div>
                <button type="button" className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5" onClick={() => { setForgotOpen(false); setForgotStep(1); }}>
                  {t("login.backToSignInBtn")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
