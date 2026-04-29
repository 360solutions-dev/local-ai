import type { Metadata } from "next";
import OnboardingClient from "./OnboardingClient";

export const metadata: Metadata = {
  title: "local-ai.run — Onboarding",
};

export default function OnboardingPage() {
  return <OnboardingClient />;
}
