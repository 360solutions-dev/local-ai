"use client";

import { LogOut, Loader2 } from "lucide-react";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";
import { useTranslation } from "@/lib/i18n";

export default function SidebarUser() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const { t } = useTranslation();

  const displayName = user?.display_name || user?.email || "";
  const initial = displayName ? displayName.charAt(0).toUpperCase() : "";
  const role = user?.is_staff ? t("sidebar.admin") : t("sidebar.user");

  return (
    <div className="p-4 border-t border-border" style={{ visibility: user ? "visible" : "hidden" }}>
      <div className="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors hover:bg-bg-card">
        <div className="w-8 h-8 rounded-lg bg-linear-to-br from-accent to-accent-secondary flex items-center justify-center font-bold text-[0.8rem] text-bg">
          {initial}
        </div>
        <div className="flex-1">
          <div className="text-[0.85rem] font-medium">{displayName}</div>
          <div className="text-[0.72rem] text-text-dim font-mono">{role}</div>
        </div>
        <button
          className="bg-transparent border-none text-text-dim cursor-pointer p-1.5 rounded-md flex items-center justify-center transition-all hover:text-accent hover:bg-bg-card disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          title={t("sidebar.logout")}
        >
          {logout.isPending ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <LogOut size={18} />
          )}
        </button>
      </div>
    </div>
  );
}
