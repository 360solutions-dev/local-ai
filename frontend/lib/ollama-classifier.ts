/**
 * Client-side detection of cloud-routed Ollama models.
 *
 * Some Ollama models route inference to remote servers and need an internet
 * connection — defeats the purpose of a self-hosted, offline-first app.
 * We warn the user before they pull such a model.
 */

export type ModelClass = "local" | "cloud" | "suspicious";

const PROPRIETARY_BRANDS = [
  "claude",
  "gpt-3",
  "gpt-3.5",
  "gpt-4",
  "gpt-4o",
  "gpt-5",
  "gemini",
  "copilot",
  "kimi",
];

function baseName(name: string): string {
  if (!name) return "";
  let n = name.toLowerCase().trim();
  if (n.includes("/")) n = n.split("/").slice(-1)[0];
  if (n.includes(":")) n = n.split(":")[0];
  return n;
}

function namespacePart(name: string): string | null {
  if (!name || !name.includes("/")) return null;
  return name.toLowerCase().split("/")[0];
}

export function classifyModel(name: string): ModelClass {
  const n = (name || "").toLowerCase().trim();
  if (!n) return "local";

  // Signal 1: Ollama's `cloud` marker in the tag (`:cloud`, `:1t-cloud`, etc.).
  if (n.includes(":")) {
    const tag = n.split(":").slice(1).join(":");
    if (tag === "cloud" || tag.endsWith("-cloud") || tag.startsWith("cloud-")) {
      return "cloud";
    }
  }

  const base = baseName(n);

  // Signal 2: proprietary brand whose weights have never been publicly released.
  for (const brand of PROPRIETARY_BRANDS) {
    if (base === brand || base.startsWith(brand + "-")) {
      return "cloud";
    }
  }

  // Signal 3: user-namespaced upload whose base name contains a proprietary brand
  // (e.g. `someuser/claude-tuned`, `dbmanaging/gpt-4-clone`).
  const ns = namespacePart(n);
  if (ns && ns !== "library") {
    for (const brand of PROPRIETARY_BRANDS) {
      if (base.includes(brand)) return "cloud";
    }
  }

  return "local";
}

export function isCloudModel(name: string): boolean {
  return classifyModel(name) === "cloud";
}
