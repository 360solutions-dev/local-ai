import { ReactNode } from "react";

interface InfoCardProps {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function InfoCard({ icon, children, className = "" }: InfoCardProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 bg-bg-card border border-border rounded-[10px] text-[0.9rem] text-text-muted font-light ${className}`}>
      <div className="w-8 h-8 rounded-lg bg-accent/15 border border-border-accent flex items-center justify-center text-[0.9rem] shrink-0">
        {icon}
      </div>
      <span>{children}</span>
    </div>
  );
}
