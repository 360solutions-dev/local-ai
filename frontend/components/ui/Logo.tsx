import Link from "next/link";

interface LogoProps {
  href?: string;
  size?: "sm" | "md";
  className?: string;
}

function LogoContent({ size = "md" }: { size?: "sm" | "md" }) {
  const iconSize = size === "sm" ? "w-[22px] h-[22px]" : "w-8 h-8";
  const textSize = size === "sm" ? "text-base" : "text-xl";

  return (
    <>
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className={iconSize}>
        <path d="M14 2.5L4 7v7c0 6.1 4.3 11.5 10 13 5.7-1.5 10-6.9 10-13V7L14 2.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="14" cy="11" r="2" fill="currentColor" />
        <circle cx="9" cy="17" r="1.3" fill="currentColor" />
        <circle cx="19" cy="17" r="1.3" fill="currentColor" />
        <circle cx="14" cy="21" r="1.3" fill="currentColor" />
        <path d="M14 13v2.5l-4 2M14 15.5l4 2M9 17l5 4M19 17l-5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-mono ${textSize} tracking-wide`}>
        <span className="text-accent">local</span>
        <span className="text-text-dim animate-[cursorBlink_1.2s_step-end_infinite]">-</span>
        <span className="text-accent">ai</span>
        <span className="text-text-dim">.run</span>
      </span>
    </>
  );
}

export default function Logo({ href, size = "md", className = "" }: LogoProps) {
  const baseClass = `flex items-center gap-2.5 text-accent no-underline ${className}`;

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        <LogoContent size={size} />
      </Link>
    );
  }

  return (
    <div className={baseClass}>
      <LogoContent size={size} />
    </div>
  );
}
