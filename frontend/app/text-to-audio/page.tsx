import Sidebar from "@/components/layout/Sidebar";
import TextToAudioClient from "./TextToAudioClient";
export const metadata = { title: "local-ai.run — Text to Audio" };
export default function TextToAudioPage() {
  return (
    <div className="font-body bg-bg text-text min-h-screen">
      <div className="flex min-h-screen">
        <Sidebar activePage="text-to-audio" />
        <main className="flex-1 overflow-y-auto"><TextToAudioClient /></main>
      </div>
    </div>
  );
}
