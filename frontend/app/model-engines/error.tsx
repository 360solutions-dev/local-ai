"use client";

export default function ModelEnginesError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md px-8">
        <div className="text-4xl mb-4">&#9881;&#65039;</div>
        <h2 className="text-xl font-bold mb-2">Failed to load Model Engines</h2>
        <p className="text-text-muted text-[0.9rem] font-light mb-6">{error.message || "Could not load providers and models."}</p>
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
