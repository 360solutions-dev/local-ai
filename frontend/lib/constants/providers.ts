export interface ProviderTemplate {
  name: string;
  icon: string;
  desc: string;
  endpoint: string;
  type: "ollama" | "openai";
  meta?: { label: string; value: string }[];
}

export const AVAILABLE_PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    name: "vLLM",
    icon: "\u26A1",
    desc: "High-throughput serving with PagedAttention. Best for multi-user setups with high concurrency.",
    endpoint: "http://localhost:8000",
    type: "openai",
    meta: [
      { label: "Default Port", value: "8000" },
      { label: "GPU Required", value: "Yes" },
    ],
  },
  {
    name: "llama.cpp",
    icon: "\uD83D\uDD27",
    desc: "Lightweight C++ inference. Runs on CPU, Apple Silicon, and CUDA with minimal overhead.",
    endpoint: "http://localhost:8080",
    type: "openai",
    meta: [
      { label: "Default Port", value: "8080" },
      { label: "GPU Required", value: "No" },
    ],
  },
];

export const PROVIDER_PICKER_OPTIONS: ProviderTemplate[] = [
  { name: "LM Studio", icon: "\uD83D\uDDA5\uFE0F", endpoint: "http://localhost:1234", type: "openai", desc: "Discover, download, and run local LLMs with a desktop app." },
  { name: "LocalAI", icon: "\uD83C\uDFE0", endpoint: "http://localhost:8080", type: "openai", desc: "Drop-in OpenAI replacement. Run models locally with GPU/CPU." },
  { name: "Text Gen WebUI", icon: "\uD83D\uDCAC", endpoint: "http://localhost:5000", type: "openai", desc: "Gradio web UI for running large language models." },
  { name: "Jan", icon: "\uD83E\uDD16", endpoint: "http://localhost:1337", type: "openai", desc: "Open-source desktop app for running AI models offline." },
  { name: "GPT4All", icon: "\uD83E\uDDE0", endpoint: "http://localhost:4891", type: "openai", desc: "Free, local, privacy-aware chatbot. No GPU required." },
  { name: "vLLM", icon: "\u26A1", endpoint: "http://localhost:8000", type: "openai", desc: "High-throughput serving with PagedAttention for production." },
  { name: "llama.cpp", icon: "\uD83D\uDD27", endpoint: "http://localhost:8080", type: "openai", desc: "Lightweight C++ inference for CPU, Apple Silicon, and CUDA." },
  { name: "Ollama (Extra)", icon: "\uD83E\uDDA9", endpoint: "http://localhost:11435", type: "ollama", desc: "Additional Ollama instance on a different port." },
];
