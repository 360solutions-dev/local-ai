import Link from "next/link";
import { ArrowRight } from "lucide-react";
import InfoCard from "./InfoCard";
import { useTranslation } from "@/lib/i18n";

interface NoProviderGuardProps {
  steps: { icon: string; text: string }[];
}

export default function NoProviderGuard({ steps }: NoProviderGuardProps) {
  const { t } = useTranslation();

  return (
    <div className="font-body bg-bg text-text min-h-screen flex items-center justify-center overflow-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse,rgba(52,211,153,0.15)_0%,transparent_65%)] pointer-events-none z-0" />

      <div className="relative z-1 w-full max-w-[480px] px-8 text-center animate-[cardIn_0.5s_ease]">
        <div className="w-[72px] h-[72px] rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center text-3xl mx-auto mb-6 animate-[scaleIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">
          &#9888;&#65039;
        </div>
        <h1 className="text-[1.8rem] font-bold tracking-tight mb-2.5 leading-tight">
          {t("modelEngines.noProviderWarning")}
        </h1>
        <p className="text-text-muted text-[0.95rem] font-light leading-relaxed mb-8">
          {t("modelEngines.noProviderWarningDesc")}
        </p>

        <div className="flex flex-col gap-2.5 mb-8">
          {steps.map((step, i) => (
            <InfoCard key={i} icon={step.icon}>
              {step.text}
            </InfoCard>
          ))}
        </div>

        <Link
          href="/model-engines"
          className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-8 bg-accent text-bg border-none rounded-lg font-body text-base font-semibold no-underline cursor-pointer transition-all duration-200 shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 hover:shadow-[0_0_50px_rgba(52,211,153,0.3)]"
        >
          {t("sidebar.modelEngines")} <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
