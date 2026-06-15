import Sidebar from "@/components/layout/Sidebar";
import SettingsClient from "./SettingsClient";

export const metadata = { title: "local-ai.run — Settings" };

export default function SettingsPage() {
  return (
    <div className="font-body bg-bg text-text min-h-screen">
      <div className="flex min-h-screen">
        <Sidebar activePage="settings" />
        <main className="flex-1 p-10 overflow-y-auto">
          <SettingsClient />
        </main>
      </div>
    </div>
  );
}
