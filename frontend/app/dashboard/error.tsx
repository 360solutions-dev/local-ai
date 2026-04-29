"use client";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md px-8">
        <div className="text-4xl mb-4">&#128200;</div>
        <h2 className="text-xl font-bold mb-2">Dashboard unavailable</h2>
        <p className="text-text-muted text-[0.9rem] font-light mb-6">{error.message || "Failed to load dashboard."}</p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-accent text-bg border-none rounded-lg font-body text-[0.92rem] font-semibold cursor-pointer transition-all hover:-translate-y-0.5"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
