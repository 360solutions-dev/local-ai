import Sidebar from "@/components/layout/Sidebar";
import ModelEnginesClient from "./ModelEnginesClient";
export const metadata = { title: "local-ai.run — Model Engines" };
export default function ModelEnginesPage() {
  return (
    <div className="font-body bg-bg text-text min-h-screen">
      <div className="flex min-h-screen">
        <Sidebar activePage="model-engines" />
        <main className="flex-1 p-10 overflow-y-auto"><ModelEnginesClient /></main>
      </div>
    </div>
  );
}
