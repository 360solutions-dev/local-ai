"use client";

function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`bg-border/50 rounded-md animate-pulse ${className}`}
      style={style}
    />
  );
}

export function SettingsSkeleton() {
  return (
    <div className="animate-[cardIn_0.3s_ease]">
      {/* Header */}
      <div className="mb-8">
        <SkeletonBlock className="h-8 w-40 mb-2" />
        <SkeletonBlock className="h-4 w-72" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-border pb-px">
        <SkeletonBlock className="h-10 w-24 rounded-t-lg" />
        <SkeletonBlock className="h-10 w-24 rounded-t-lg" />
        <SkeletonBlock className="h-10 w-24 rounded-t-lg" />
        <SkeletonBlock className="h-10 w-24 rounded-t-lg" />
      </div>

      {/* Profile section */}
      <div className="space-y-8">
        <section>
          <SkeletonBlock className="h-5 w-20 mb-1" />
          <SkeletonBlock className="h-4 w-64 mb-5" />
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <SkeletonBlock className="h-3 w-24 mb-1.5" />
              <SkeletonBlock className="h-11 w-full rounded-lg" />
            </div>
            <div>
              <SkeletonBlock className="h-3 w-16 mb-1.5" />
              <SkeletonBlock className="h-11 w-full rounded-lg" />
            </div>
          </div>
          <div>
            <SkeletonBlock className="h-3 w-12 mb-1.5" />
            <SkeletonBlock className="h-11 w-full rounded-lg" />
          </div>
        </section>

        {/* Appearance section */}
        <section>
          <SkeletonBlock className="h-5 w-28 mb-1" />
          <SkeletonBlock className="h-4 w-56 mb-5" />
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <SkeletonBlock className="h-3 w-16 mb-1.5" />
              <SkeletonBlock className="h-11 w-full rounded-lg" />
            </div>
            <div>
              <SkeletonBlock className="h-3 w-24 mb-1.5" />
              <SkeletonBlock className="h-11 w-full rounded-lg" />
            </div>
          </div>
          <div>
            <SkeletonBlock className="h-3 w-20 mb-1.5" />
            <SkeletonBlock className="h-11 w-full rounded-lg" />
          </div>
        </section>

        {/* Notifications section */}
        <section>
          <SkeletonBlock className="h-5 w-32 mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex-1">
                  <SkeletonBlock className="h-4 w-44 mb-1.5" />
                  <SkeletonBlock className="h-3 w-72" />
                </div>
                <SkeletonBlock className="w-[42px] h-[24px] rounded-full shrink-0" />
              </div>
            ))}
          </div>
        </section>

        {/* Buttons */}
        <div className="flex gap-3 pt-4">
          <SkeletonBlock className="h-11 w-28 rounded-lg" />
          <SkeletonBlock className="h-11 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export { SkeletonBlock };
