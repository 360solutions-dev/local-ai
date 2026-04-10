"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/use-theme";
import { useAccentColor, type AccentColor } from "@/hooks/use-accent-color";
import { useCurrentUser, useUpdateProfile, useChangePassword, useUpdateNotificationPreferences } from "@/hooks/use-auth";
import { useInstanceInfo, useInstanceSettings, useUpdateInstanceSettings, useExportChatHistory, useExportSettings, useExportAllData, useResetInstance, useDeleteAllData, useFactoryReset } from "@/hooks/use-advanced-settings";
import { SettingsSkeleton } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useTranslation, useLanguage, type Locale } from "@/lib/i18n";

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative w-[42px] h-[24px] rounded-full transition-colors cursor-pointer border-none ${on ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${on ? "translate-x-[18px]" : ""}`} />
    </button>
  );
}

const selectClass = "w-full px-4 py-2.5 bg-bg-card border border-border rounded-lg text-text font-body text-[0.9rem] outline-none transition-colors focus:border-border-focus appearance-none cursor-pointer bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%237a7a8f%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_12px_center] bg-no-repeat";
const inputClass = "w-full px-4 py-2.5 bg-bg-card border border-border rounded-lg text-text font-body text-[0.9rem] outline-none transition-colors focus:border-border-focus placeholder:text-text-dim";

export default function SettingsClient() {
  const [activeTab, setActiveTab] = useState("general");
  const [toast, setToast] = useState("");
  const [resettingFactory, setResettingFactory] = useState(false);
  const { theme, setTheme } = useTheme();
  const { accentColor, setAccentColor } = useAccentColor();
  const { t } = useTranslation();
  const { locale, setLocale } = useLanguage();

  // Profile (from shared React Query cache)
  const { data: user, isLoading } = useCurrentUser();
  const updateProfile = useUpdateProfile();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setEmail(user.email);
    }
  }, [user]);

  const role = user?.is_staff ? t("settings.profile.administrator") : t("settings.profile.user");

  // Notification preferences (from /api/auth/me/ — no separate call)
  const updateNotifPrefs = useUpdateNotificationPreferences();

  const modelDownload = user?.notification_preferences?.model_download ?? true;
  const fileIndexing = user?.notification_preferences?.file_indexing ?? true;
  const systemErrors = user?.notification_preferences?.system_errors ?? true;

  // Change password
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  function handleChangePassword() {
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError(t("settings.security.minChars"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.security.passwordsNoMatch"));
      return;
    }
    changePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          showToast(t("settings.security.passwordUpdated"));
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: (err) => setPasswordError(err.message),
      },
    );
  }

  // Security toggles
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [requireHttps, setRequireHttps] = useState(false);
  const [apiKeyAuth, setApiKeyAuth] = useState(true);

  // Advanced — real data from backend
  const { data: instanceInfo } = useInstanceInfo();
  const { data: instanceSettings } = useInstanceSettings();
  const updateInstanceSettings = useUpdateInstanceSettings();
  const exportChatHistory = useExportChatHistory();
  const exportSettings = useExportSettings();
  const exportAllData = useExportAllData();
  const resetInstance = useResetInstance();
  const deleteAllData = useDeleteAllData();
  const factoryReset = useFactoryReset();
  const [dangerAction, setDangerAction] = useState<null | "reset" | "delete" | "factory">(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  const tabs: { key: string; label: string }[] = [
    { key: "general", label: t("settings.tab.general") },
    { key: "storage", label: t("settings.tab.storage") },
    { key: "security", label: t("settings.tab.security") },
    { key: "advanced", label: t("settings.tab.advanced") },
  ];

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  // Full-screen overlay while factory reset is in progress / redirecting
  if (resettingFactory) {
    return (
      <div className="fixed inset-0 z-[9999] bg-bg flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted font-mono text-[0.85rem]">{t("settings.advanced.factoryResetting")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[2rem] font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-text-muted text-[0.92rem] font-light mt-1">{t("settings.subtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 font-mono text-[0.78rem] tracking-wide capitalize border-none cursor-pointer transition-all rounded-t-lg ${activeTab === tab.key ? "bg-bg-card text-accent border-b-2 border-b-accent" : "bg-transparent text-text-muted hover:text-text hover:bg-bg-card/50"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === "general" && (
        <div className="space-y-8 animate-[cardIn_0.3s_ease]">
          {/* Profile */}
          <section>
            <h2 className="text-lg font-semibold mb-1">{t("settings.profile.title")}</h2>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">{t("settings.profile.subtitle")}</p>
            <div className="grid grid-cols-2 gap-4 mb-4 max-[600px]:grid-cols-1">
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.profile.displayName")}</label>
                <input className={inputClass} type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.profile.email")}</label>
                <input className={`${inputClass} opacity-60 cursor-not-allowed`} type="email" value={email} disabled />
              </div>
            </div>
            <div>
              <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.profile.role")}</label>
              <input className={`${inputClass} opacity-60 cursor-not-allowed`} type="text" value={role} disabled />
              <p className="text-[0.78rem] text-text-dim mt-1.5">{t("settings.profile.roleHint")}</p>
            </div>
          </section>

          {/* Appearance */}
          <section>
            <h2 className="text-lg font-semibold mb-1">{t("settings.appearance.title")}</h2>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">{t("settings.appearance.subtitle")}</p>
            <div className="grid grid-cols-2 gap-4 mb-4 max-[600px]:grid-cols-1">
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.appearance.theme")}</label>
                <select className={selectClass} value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light" | "system")}>
                  <option value="dark">{t("settings.appearance.themeDark")}</option>
                  <option value="light">{t("settings.appearance.themeLight")}</option>
                  <option value="system">{t("settings.appearance.themeSystem")}</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.appearance.accentColor")}</label>
                <select className={selectClass} value={accentColor} onChange={(e) => setAccentColor(e.target.value as AccentColor)}>
                  <option value="emerald">Emerald</option>
                  <option value="cyan">Cyan</option>
                  <option value="violet">Violet</option>
                  <option value="amber">Amber</option>
                  <option value="rose">Rose</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.appearance.language")}</label>
              <select className={selectClass} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="ja">日本語</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.notifications.title")}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.notifications.modelDownload")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.notifications.modelDownloadDesc")}</div></div>
                <Toggle on={modelDownload} onToggle={() => updateNotifPrefs.mutate({ model_download: !modelDownload })} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.notifications.fileIndexing")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.notifications.fileIndexingDesc")}</div></div>
                <Toggle on={fileIndexing} onToggle={() => updateNotifPrefs.mutate({ file_indexing: !fileIndexing })} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.notifications.systemErrors")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.notifications.systemErrorsDesc")}</div></div>
                <Toggle on={systemErrors} onToggle={() => updateNotifPrefs.mutate({ system_errors: !systemErrors })} />
              </div>
            </div>
          </section>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              disabled={updateProfile.isPending}
              className="px-6 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() =>
                updateProfile.mutate(
                  { display_name: displayName },
                  {
                    onSuccess: () => showToast(t("settings.profile.updateSuccess")),
                    onError: (err) => showToast(err.message),
                  },
                )
              }
            >
              {updateProfile.isPending ? t("common.saving") : t("common.save")}
            </button>
            <button type="button" className="px-6 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.92rem] cursor-pointer transition-all hover:border-text-muted hover:text-text">{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {/* Storage Tab */}
      {activeTab === "storage" && (
        <div className="space-y-8 animate-[cardIn_0.3s_ease]">
          <section>
            <h2 className="text-lg font-semibold mb-1">{t("settings.storage.title")}</h2>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">{t("settings.storage.subtitle")}</p>
            <div className="bg-bg-card border border-border rounded-xl p-5 mb-5">
              <div className="flex justify-between py-2 border-b border-border"><span className="text-text-muted text-[0.88rem]">{t("settings.storage.totalAllocated")}</span><span className="font-mono text-[0.88rem]">50.0 GB</span></div>
              <div className="flex justify-between py-2 border-b border-border"><span className="text-text-muted text-[0.88rem]">{t("settings.storage.used")}</span><span className="font-mono text-[0.88rem] text-accent">12.4 GB</span></div>
              <div className="flex justify-between py-2"><span className="text-text-muted text-[0.88rem]">{t("settings.storage.available")}</span><span className="font-mono text-[0.88rem]">37.6 GB</span></div>
            </div>
            <div className="mb-2">
              <div className="h-2 bg-bg-card rounded-full overflow-hidden"><div className="h-full bg-linear-to-r from-accent to-accent-secondary rounded-full" style={{ width: "24.8%" }} /></div>
              <div className="flex justify-between font-mono text-[0.72rem] text-text-dim mt-1.5"><span>{t("settings.storage.used_pct", { pct: "24.8" })}</span><span>{t("settings.storage.free", { size: "37.6 GB" })}</span></div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.storage.breakdown")}</h2>
            <div className="bg-bg-card border border-border rounded-xl p-5">
              {[
                [`🧠 ${t("settings.storage.models")}`, "8.2 GB"],
                [`📁 ${t("settings.storage.uploadedFiles")}`, "2.8 GB"],
                [`🔗 ${t("settings.storage.vectorEmbeddings")}`, "940 MB"],
                [`💬 ${t("settings.storage.chatHistory")}`, "86 MB"],
                [`🔊 ${t("settings.storage.generatedAudio")}`, "340 MB"],
              ].map(([label, value], i, arr) => (
                <div key={label} className={`flex justify-between py-2 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                  <span className="text-text-muted text-[0.88rem]">{label}</span>
                  <span className="font-mono text-[0.88rem]">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.storage.uploadLimits")}</h2>
            <div className="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.storage.maxFileSize")}</label>
                <select className={selectClass} defaultValue="50"><option>25 MB</option><option value="50">50 MB</option><option>100 MB</option><option>200 MB</option><option>500 MB</option></select>
              </div>
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.storage.maxFilesPerChat")}</label>
                <select className={selectClass} defaultValue="10"><option>5</option><option value="10">10</option><option>25</option><option>50</option><option>{t("settings.storage.unlimited")}</option></select>
              </div>
            </div>
          </section>

          <div className="flex gap-3 pt-4">
            <button type="button" className="px-6 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5" onClick={() => showToast(t("settings.saved"))}>{t("common.save")}</button>
            <button type="button" className="px-6 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.92rem] cursor-pointer transition-all hover:border-text-muted hover:text-text">{t("settings.storage.clearCache")}</button>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="space-y-8 animate-[cardIn_0.3s_ease]">
          <section>
            <h2 className="text-lg font-semibold mb-1">{t("settings.security.changePassword")}</h2>
            <p className="text-text-muted text-[0.88rem] font-light mb-5">{t("settings.security.changePasswordDesc")}</p>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.currentPassword")}</label>
                <input className={inputClass} type="password" placeholder={t("settings.security.enterCurrentPassword")} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.newPassword")}</label>
                <input className={inputClass} type="password" placeholder={t("settings.security.minChars")} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div>
                <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.confirmNewPassword")}</label>
                <input className={inputClass} type="password" placeholder={t("settings.security.reEnterPassword")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              {passwordError && <p className="text-danger text-[0.82rem]">{passwordError}</p>}
              <button type="button" className="px-6 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleChangePassword} disabled={changePassword.isPending}>{changePassword.isPending ? t("common.saving") : t("settings.security.updatePassword")}</button>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.security.accessControl")}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.security.allowRegistration")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.security.allowRegistrationDesc")}</div></div>
                <Toggle on={allowRegistration} onToggle={() => setAllowRegistration((v) => !v)} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.security.requireHttps")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.security.requireHttpsDesc")}</div></div>
                <Toggle on={requireHttps} onToggle={() => setRequireHttps((v) => !v)} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.security.apiKeyAuth")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.security.apiKeyAuthDesc")}</div></div>
                <Toggle on={apiKeyAuth} onToggle={() => setApiKeyAuth((v) => !v)} />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.security.session")}</h2>
            <div>
              <label className="block font-mono text-[0.72rem] text-text-muted tracking-wide uppercase mb-1.5">{t("settings.security.sessionTimeout")}</label>
              <select className={`${selectClass} max-w-xs`} defaultValue="24h"><option value="1h">{t("settings.security.1hour")}</option><option value="8h">{t("settings.security.8hours")}</option><option value="24h">{t("settings.security.24hours")}</option><option value="7d">{t("settings.security.7days")}</option><option value="never">{t("settings.security.never")}</option></select>
            </div>
          </section>
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === "advanced" && (
        <div className="space-y-8 animate-[cardIn_0.3s_ease]">
          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.advanced.instanceInfo")}</h2>
            <div className="bg-bg-card border border-border rounded-xl p-5">
              {[
                [t("settings.advanced.version"), instanceInfo?.version ?? "..."],
                [t("settings.advanced.instanceId"), instanceInfo?.instance_id ?? "..."],
                [t("settings.advanced.uptime"), instanceInfo?.uptime_display ?? "..."],
                [t("settings.advanced.lastUpdated"), instanceInfo?.last_updated ? new Date(instanceInfo.last_updated).toLocaleDateString() : "..."],
              ].map(([label, value], i, arr) => (
                <div key={label} className={`flex justify-between py-2 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                  <span className="text-text-muted text-[0.88rem]">{label}</span>
                  <span className="font-mono text-[0.88rem]">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.advanced.logging")}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.advanced.requestLogging")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.advanced.requestLoggingDesc")}</div></div>
                <Toggle on={instanceSettings?.request_logging ?? true} onToggle={() => updateInstanceSettings.mutate({ request_logging: !(instanceSettings?.request_logging ?? true) })} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><div className="text-[0.92rem] font-medium">{t("settings.advanced.debugMode")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.advanced.debugModeDesc")}</div></div>
                <Toggle on={instanceSettings?.debug_mode ?? false} onToggle={() => updateInstanceSettings.mutate({ debug_mode: !(instanceSettings?.debug_mode ?? false) })} />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">{t("settings.advanced.export")}</h2>
            <div className="flex gap-3 flex-wrap">
              <button
                type="button"
                disabled={exportChatHistory.isPending}
                className="px-5 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => exportChatHistory.mutate(undefined, { onSuccess: () => showToast(t("settings.advanced.chatHistoryExported")) })}
              >
                {exportChatHistory.isPending ? t("settings.advanced.exportingChatHistory") : t("settings.advanced.exportChatHistory")}
              </button>
              <button
                type="button"
                disabled={exportSettings.isPending}
                className="px-5 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => exportSettings.mutate(undefined, { onSuccess: () => showToast(t("settings.advanced.settingsExported")) })}
              >
                {exportSettings.isPending ? t("settings.advanced.exportingSettings") : t("settings.advanced.exportSettings")}
              </button>
              <button
                type="button"
                disabled={exportAllData.isPending}
                className="px-5 py-2.5 bg-transparent text-text-muted border border-border rounded-lg font-body text-[0.88rem] cursor-pointer transition-all hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => exportAllData.mutate(undefined, { onSuccess: () => showToast(t("settings.advanced.allDataExported")) })}
              >
                {exportAllData.isPending ? t("settings.advanced.exportingAllData") : t("settings.advanced.exportAllData")}
              </button>
            </div>
          </section>

          {/* Danger Zone */}
          <section>
            <h2 className="text-lg font-semibold text-danger mb-4">{t("settings.advanced.dangerZone")}</h2>
            <div className="border border-danger/30 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div><div className="text-[0.92rem] font-medium">{t("settings.advanced.resetInstance")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.advanced.resetInstanceDesc")}</div></div>
                <button type="button" className="px-4 py-2 bg-transparent text-danger border border-danger/30 rounded-lg font-body text-[0.82rem] cursor-pointer transition-all hover:bg-danger/10" onClick={() => setDangerAction("reset")}>{t("common.reset")}</button>
              </div>
              <div className="flex items-center justify-between">
                <div><div className="text-[0.92rem] font-medium">{t("settings.advanced.deleteAllData")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.advanced.deleteAllDataDesc")}</div></div>
                <button type="button" className="px-4 py-2 bg-transparent text-danger border border-danger/30 rounded-lg font-body text-[0.82rem] cursor-pointer transition-all hover:bg-danger/10" onClick={() => setDangerAction("delete")}>{t("common.delete")}</button>
              </div>
              <div className="flex items-center justify-between">
                <div><div className="text-[0.92rem] font-medium">{t("settings.advanced.factoryReset")}</div><div className="text-[0.82rem] text-text-muted font-light">{t("settings.advanced.factoryResetDesc")}</div></div>
                <button type="button" className="px-4 py-2 bg-danger/10 text-danger border border-danger/30 rounded-lg font-body text-[0.82rem] font-semibold cursor-pointer transition-all hover:bg-danger/20" onClick={() => setDangerAction("factory")}>{t("settings.advanced.factoryReset")}</button>
              </div>
            </div>
          </section>

          {/* Confirmation Dialogs */}
          <ConfirmDialog
            open={dangerAction === "reset"}
            title={t("settings.advanced.confirmResetTitle")}
            description={t("settings.advanced.confirmResetDesc")}
            confirmLabel={t("settings.advanced.confirmButton")}
            variant="warning"
            loading={resetInstance.isPending}
            onCancel={() => setDangerAction(null)}
            onConfirm={() => resetInstance.mutate(undefined, { onSuccess: () => { setLocale("en"); setTheme("dark"); setTimeout(() => setAccentColor("emerald"), 50); setDangerAction(null); showToast(t("settings.advanced.instanceReset")); } })}
          />
          <ConfirmDialog
            open={dangerAction === "delete"}
            title={t("settings.advanced.confirmDeleteTitle")}
            description={t("settings.advanced.confirmDeleteDesc")}
            confirmLabel={t("settings.advanced.confirmButton")}
            variant="danger"
            loading={deleteAllData.isPending}
            onCancel={() => setDangerAction(null)}
            onConfirm={() => deleteAllData.mutate(undefined, { onSuccess: () => { setDangerAction(null); showToast(t("settings.advanced.allDataDeleted")); } })}
          />
          <ConfirmDialog
            open={dangerAction === "factory"}
            title={t("settings.advanced.confirmFactoryTitle")}
            description={t("settings.advanced.confirmFactoryDesc")}
            confirmLabel={t("settings.advanced.confirmButton")}
            variant="danger"
            requireTypedConfirmation="FACTORY RESET"
            loading={factoryReset.isPending}
            onCancel={() => setDangerAction(null)}
            onConfirm={() => {
              setResettingFactory(true);
              factoryReset.mutate();
            }}
          />
        </div>
      )}

      {/* Toast */}
      <div className={`fixed bottom-8 right-8 px-5 py-3 bg-bg-elevated border border-border-accent rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] font-mono text-[0.85rem] text-accent transition-all duration-300 ${toast ? "translate-y-0 opacity-100" : "translate-y-[100px] opacity-0"}`}>
        ✓ {toast}
      </div>
    </div>
  );
}
