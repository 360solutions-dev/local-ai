import { notFound } from "next/navigation";

// Text-to-Audio is currently "Coming Soon" — route disabled but client code preserved
// in TextToAudioClient.tsx for future re-enablement.
export const metadata = { title: "local-ai.run — Text to Audio" };

export default function TextToAudioPage() {
  notFound();
}
