"use client";

import Link from "next/link";
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@/lib/i18n";

type ChatItem = { id: string; label: string };

export default function ChatClient() {
  const { t } = useTranslation();
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState("1");
  const [modelOverlayHidden, setModelOverlayHidden] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStatus, setProgressStatus] = useState(t("chat.connectingOllama"));
  const [input, setInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const [extraTail, setExtraTail] = useState<
    { id: string; role: "user" | "ai"; text: string }[]
  >([]);

  const chats: ChatItem[] = [
    { id: "1", label: "Q3 Revenue Analysis" },
    { id: "2", label: "API Documentation Review" },
    { id: "3", label: "Customer Feedback Summary" },
  ];

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [extraTail, scrollToBottom]);

  function sendMessage() {
    const text = input.trim();
    if (!text) return;
    const id = `m-${Date.now()}`;
    setExtraTail((prev) => [...prev, { id, role: "user", text }]);
    setInput("");
    window.setTimeout(() => {
      setExtraTail((prev) => [
        ...prev,
        {
          id: `${id}-ai`,
          role: "ai",
          text: "I'm searching through your indexed files to find the most relevant information...\n\n(This is a demo — in the real app, the response would come from your local LLM)",
        },
      ]);
    }, 1000);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function newChat() {
    window.alert("New chat created! (Demo)");
  }

  function selectModelOption(model: string) {
    setSelectedModel(model);
  }

  function downloadModel() {
    if (!selectedModel) return;
    setDownloadBusy(true);
    setProgressPct(0);
    setProgressStatus(t("chat.connectingOllama"));
    const statuses = [
      t("chat.connectingOllama"),
      t("chat.pullingManifest"),
      t("chat.downloadingLayers"),
      t("chat.downloadingLayers"),
      t("chat.verifying"),
      t("chat.loadingModel"),
    ];
    let pct = 0;
    const interval = window.setInterval(() => {
      pct += Math.random() * 8 + 2;
      if (pct > 100) pct = 100;
      setProgressPct(Math.round(pct));
      setProgressStatus(statuses[Math.min(Math.floor(pct / 18), statuses.length - 1)]!);
      if (pct >= 100) {
        window.clearInterval(interval);
        setProgressStatus(t("chat.modelReady"));
        window.setTimeout(() => setModelOverlayHidden(true), 800);
      }
    }, 300);
  }

  return (
    <div className="font-body bg-bg text-text h-screen overflow-hidden relative">
      {/* Noise overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9999] opacity-[0.04] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%270%200%20256%20256%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.9%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url(%23n)%27/%3E%3C/svg%3E')]" />

      <div className="flex h-screen">
        {/* Chat Sidebar */}
        <aside className="w-[260px] bg-bg-elevated border-r border-border flex flex-col shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4 font-mono text-base text-accent no-underline border-b border-border">
            <svg viewBox="0 0 28 28" fill="none" className="w-[22px] h-[22px]">
              <path d="M14 2.5L4 7v7c0 6.1 4.3 11.5 10 13 5.7-1.5 10-6.9 10-13V7L14 2.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="14" cy="11" r="2" fill="currentColor" />
              <circle cx="9" cy="17" r="1.3" fill="currentColor" />
              <circle cx="19" cy="17" r="1.3" fill="currentColor" />
              <circle cx="14" cy="21" r="1.3" fill="currentColor" />
              <path d="M14 13v2.5l-4 2M14 15.5l4 2M9 17l5 4M19 17l-5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-accent">local</span>
            <span className="text-text-dim animate-[cursorBlink_1.2s_step-end_infinite]">-</span>
            <span className="text-accent">ai</span>
            <span className="text-text-dim">.run</span>
          </Link>

          <button type="button" className="mx-3 mt-3 mb-1 py-2.5 bg-accent/15 border border-dashed border-border-accent rounded-lg text-accent font-body text-[0.88rem] font-medium cursor-pointer transition-all text-center hover:bg-accent/30 hover:border-solid" onClick={newChat}>
            {t("chat.newChat")}
          </button>

          <div className="flex-1 overflow-y-auto px-2.5">
            <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-2 pt-3 pb-1">{t("chat.today")}</div>
            {chats.slice(0, 2).map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.85rem] cursor-pointer transition-all mb-px ${activeChatId === c.id ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-bg-card hover:text-text"}`}
                onClick={() => setActiveChatId(c.id)}
                onKeyDown={(e) => e.key === "Enter" && setActiveChatId(c.id)}
              >
                <span className="text-[0.8rem] opacity-60">💬</span>
                <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{c.label}</span>
                <span className="opacity-0 group-hover:opacity-100 text-[0.75rem] text-text-dim cursor-pointer px-1 py-0.5 rounded transition-all hover:text-danger hover:bg-danger/10" onClick={(e) => e.stopPropagation()} role="presentation">✕</span>
              </div>
            ))}

            <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-2 pt-3 pb-1">{t("chat.yesterday")}</div>
            <div
              role="button"
              tabIndex={0}
              className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.85rem] cursor-pointer transition-all mb-px ${activeChatId === chats[2]!.id ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-bg-card hover:text-text"}`}
              onClick={() => setActiveChatId(chats[2]!.id)}
            >
              <span className="text-[0.8rem] opacity-60">💬</span>
              <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{chats[2]!.label}</span>
              <span className="opacity-0 group-hover:opacity-100 text-[0.75rem] text-text-dim cursor-pointer px-1 py-0.5 rounded transition-all hover:text-danger hover:bg-danger/10" onClick={(e) => e.stopPropagation()}>✕</span>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-border">
            <Link href="/dashboard" className="text-text-dim no-underline text-[0.85rem] transition-colors flex items-center gap-2 hover:text-accent">{t("chat.backToDashboard")}</Link>
          </div>
        </aside>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col relative">
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated">
            <div className="text-[0.95rem] font-semibold flex items-center gap-2">
              💬 {t("chat.chatWithFiles")}
              <span className="font-mono text-[0.72rem] text-accent bg-accent/15 px-2 py-0.5 rounded">llama3.2 · Ollama</span>
            </div>
            <div className="flex gap-2">
              <button type="button" className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent" onClick={() => setFilePanelOpen((o) => !o)}>
                📁 {t("chat.files")} <span>(3)</span>
              </button>
              <button type="button" className="bg-bg-card border border-border text-text-muted px-3 py-1.5 rounded-md font-mono text-[0.75rem] cursor-pointer transition-all flex items-center gap-1.5 hover:border-accent hover:text-accent">
                ⚙️ {t("chat.model")}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6" ref={messagesContainerRef}>
            {/* AI welcome message */}
            <div className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
              <div className="flex-1">
                <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">10:23 AM</span></div>
                <div className="inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm">
                  <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
                    I&apos;ve indexed <strong className="text-text font-medium">3 files</strong> in this conversation. You can ask me anything about their contents. I&apos;m using local embeddings to find the most relevant sections for your questions.
                  </div>
                </div>
              </div>
            </div>

            {/* User message */}
            <div className="max-w-[720px] w-full mx-auto flex gap-3 flex-row-reverse animate-[msgIn_0.3s_ease]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-linear-to-br from-indigo-500 to-indigo-400 text-white font-bold">A</div>
              <div className="flex-1 text-right">
                <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2 justify-end">You <span className="font-mono text-[0.68rem] text-text-dim font-normal">10:24 AM</span></div>
                <div className="inline-block text-left px-4 py-3 rounded-xl bg-indigo-500/[0.12] border border-indigo-500/20 rounded-tr-sm">
                  <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">What were the Q3 revenue numbers and how did they compare to Q2?</div>
                </div>
              </div>
            </div>

            {/* AI response */}
            <div className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
              <div className="flex-1">
                <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">10:24 AM</span></div>
                <div className="inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm">
                  <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
                    Based on the quarterly report, <strong className="text-text font-medium">Q3 revenue was $4.2M</strong>, representing an <strong className="text-text font-medium">18% increase</strong> from Q2&apos;s $3.56M. The growth was primarily driven by enterprise subscription upgrades and a 23% increase in new customer acquisition.<br /><br />
                    Key highlights from the report:<br />
                    • Enterprise ARR grew to $2.8M (up from $2.1M in Q2)<br />
                    • Customer churn decreased to 3.2% from 4.8%<br />
                    • Average deal size increased by 15% to $18,400
                  </div>
                  <div className="inline-flex items-center gap-1 font-mono text-[0.7rem] text-accent-secondary bg-accent-secondary/[0.08] px-2 py-0.5 rounded mt-2">📄 Source: Q3-Report-2024.pdf — pages 12-14</div>
                </div>
              </div>
            </div>

            {/* User message 2 */}
            <div className="max-w-[720px] w-full mx-auto flex gap-3 flex-row-reverse animate-[msgIn_0.3s_ease]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-linear-to-br from-indigo-500 to-indigo-400 text-white font-bold">A</div>
              <div className="flex-1 text-right">
                <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2 justify-end">You <span className="font-mono text-[0.68rem] text-text-dim font-normal">10:25 AM</span></div>
                <div className="inline-block text-left px-4 py-3 rounded-xl bg-indigo-500/[0.12] border border-indigo-500/20 rounded-tr-sm">
                  <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">What does the financial projection spreadsheet say about Q4 targets?</div>
                </div>
              </div>
            </div>

            {/* AI response 2 */}
            <div className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
              <div className="flex-1">
                <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">10:25 AM</span></div>
                <div className="inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm">
                  <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
                    According to the projections spreadsheet, the <strong className="text-text font-medium">Q4 revenue target is $5.1M</strong>, which would represent a 21% quarter-over-quarter growth. The model assumes:<br /><br />
                    • 30 new enterprise deals at an average of $20,000<br />
                    • 95% retention of existing ARR<br />
                    • A planned price increase of 8% for the Pro tier effective November<br /><br />
                    The spreadsheet flags this as an <strong className="text-text font-medium">&quot;aggressive but achievable&quot;</strong> target, noting it depends on closing 3 pending enterprise deals worth a combined $340K.
                  </div>
                  <div className="inline-flex items-center gap-1 font-mono text-[0.7rem] text-accent-secondary bg-accent-secondary/[0.08] px-2 py-0.5 rounded mt-2">📊 Source: Financial-Projections.xlsx — Sheet &quot;Q4 Forecast&quot;</div>
                </div>
              </div>
            </div>

            {/* Dynamic messages */}
            {extraTail.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="max-w-[720px] w-full mx-auto flex gap-3 flex-row-reverse animate-[msgIn_0.3s_ease]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-linear-to-br from-indigo-500 to-indigo-400 text-white font-bold">A</div>
                  <div className="flex-1 text-right">
                    <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2 justify-end">{t("chat.you")} <span className="font-mono text-[0.68rem] text-text-dim font-normal">now</span></div>
                    <div className="inline-block text-left px-4 py-3 rounded-xl bg-indigo-500/[0.12] border border-indigo-500/20 rounded-tr-sm">
                      <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">{m.text}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="max-w-[720px] w-full mx-auto flex gap-3 animate-[msgIn_0.3s_ease]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[0.8rem] shrink-0 mt-0.5 bg-accent/15 border border-border-accent text-accent">🤖</div>
                  <div className="flex-1">
                    <div className="text-[0.78rem] font-semibold mb-1 flex items-center gap-2">local-ai <span className="font-mono text-[0.68rem] text-text-dim font-normal">now</span></div>
                    <div className="inline-block text-left px-4 py-3 rounded-xl bg-bg-card border border-border rounded-tl-sm">
                      <div className="text-[0.92rem] leading-[1.7] text-text-muted font-light">
                        {m.text.split("\n").map((line, i) => (
                          <span key={i}>
                            {i > 0 && <br />}
                            {line.startsWith("(") ? <em className="text-text-dim">{line}</em> : line}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>

          {/* Input area */}
          <div className="px-8 py-4 pb-6 border-t border-border bg-bg-elevated">
            <div className="max-w-[720px] mx-auto relative">
              <textarea
                className="w-full py-3.5 pl-5 pr-[4.5rem] bg-bg-card border border-border rounded-xl text-text font-body text-[0.95rem] outline-none resize-none transition-colors min-h-[48px] max-h-[150px] leading-relaxed placeholder:text-text-dim focus:border-border-focus"
                placeholder={t("chat.askAboutFiles")}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <div className="absolute right-2.5 bottom-2.5 flex gap-1">
                <button type="button" className="w-[34px] h-[34px] rounded-lg border border-border bg-bg-elevated text-text-muted cursor-pointer flex items-center justify-center text-[0.9rem] transition-all hover:border-accent hover:text-accent" title={t("chat.attachFile")} onClick={() => setFilePanelOpen((o) => !o)}>📎</button>
                <button type="button" className="w-[34px] h-[34px] rounded-lg border-none bg-accent text-bg cursor-pointer flex items-center justify-center text-[0.9rem] transition-all hover:opacity-85" title={t("chat.send")} onClick={sendMessage}>↑</button>
              </div>
            </div>
            <div className="text-center mt-2 font-mono text-[0.68rem] text-text-dim">{t("chat.enterToSend")}</div>
          </div>
        </div>

        {/* File Panel */}
        <div className={`w-[300px] bg-bg-elevated border-l border-border flex-col shrink-0 ${filePanelOpen ? "flex" : "hidden"}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="text-[0.9rem] font-semibold">📁 {t("chat.files")}</div>
            <button type="button" className="bg-transparent border-none text-text-dim cursor-pointer text-lg px-1.5 py-0.5 rounded transition-colors hover:text-danger" onClick={() => setFilePanelOpen(false)}>✕</button>
          </div>

          <div className="mx-3 mt-3 p-6 border border-dashed border-border rounded-[10px] text-center cursor-pointer transition-all hover:border-accent hover:bg-accent/15" onClick={() => document.getElementById("file-input")?.click()} role="presentation">
            <div className="text-2xl mb-2">📤</div>
            <div className="text-[0.82rem] text-text-muted font-light">{t("chat.dropFiles")}</div>
            <div className="font-mono text-[0.68rem] text-text-dim mt-1">{t("chat.supportedFormats")}</div>
            <input type="file" id="file-input" hidden multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md" />
          </div>

          <div className="flex-1 overflow-y-auto px-3">
            <div className="font-mono text-[0.65rem] text-text-dim tracking-widest uppercase px-1 pt-2.5 pb-1">{t("chat.indexedFiles", { count: "3" })}</div>

            {[
              { icon: "📄", name: "Q3-Report-2024.pdf", meta: "2.4 MB · 28 pages · 142 chunks" },
              { icon: "📊", name: "Financial-Projections.xlsx", meta: "890 KB · 6 sheets · 84 chunks" },
              { icon: "📝", name: "meeting-notes.md", meta: "12 KB · 36 chunks" },
            ].map((f) => (
              <div key={f.name} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors mb-px hover:bg-bg-card">
                <span className="text-[0.9rem]">{f.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.82rem] whitespace-nowrap overflow-hidden text-ellipsis">{f.name}</div>
                  <div className="font-mono text-[0.68rem] text-text-dim">{f.meta}</div>
                </div>
                <span className="font-mono text-[0.65rem] text-accent bg-accent/15 px-1.5 py-0.5 rounded">{t("chat.indexed")}</span>
                <button type="button" className="opacity-0 group-hover:opacity-100 bg-transparent border-none text-text-dim cursor-pointer text-[0.8rem] px-1 py-0.5 rounded transition-all hover:text-danger">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Model Setup Overlay */}
      {!modelOverlayHidden && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] backdrop-blur-[8px] animate-[fadeIn_0.3s_ease]">
          <div className="bg-bg-elevated border border-border rounded-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 shadow-[0_25px_80px_rgba(0,0,0,0.6)]">
            <h2 className="text-[1.4rem] font-bold mb-1.5">{t("chat.chooseModel")}</h2>
            <p className="text-text-muted text-[0.92rem] font-light mb-6 leading-relaxed">
              {t("chat.chooseModelDesc")}
            </p>

            <div>
              {([
                ["llama3.2", "Llama 3.2", "Meta's latest. Great balance of speed and quality.", "3.8 GB"],
                ["mistral", "Mistral 7B", "Fast and efficient. Excellent for document Q&A.", "4.1 GB"],
                ["qwen2.5", "Qwen 2.5 7B", "Strong multilingual support. Good for diverse docs.", "4.4 GB"],
                ["deepseek-r1", "DeepSeek R1 8B", "Reasoning-focused. Best for complex analysis.", "4.9 GB"],
                ["phi3", "Phi-3 Mini", "Microsoft's compact model. Fastest option, lower GPU needs.", "2.2 GB"],
              ] as const).map(([id, name, details, size]) => (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center gap-4 p-4 border rounded-[10px] cursor-pointer transition-all mb-2.5 ${selectedModel === id ? "border-accent bg-accent/15" : "border-border hover:border-border-accent hover:bg-bg-card"}`}
                  onClick={() => selectModelOption(id)}
                  onKeyDown={(e) => e.key === "Enter" && selectModelOption(id)}
                >
                  <div className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${selectedModel === id ? "border-accent" : "border-border"}`}>
                    <div className={`w-2 h-2 rounded-full bg-accent transition-opacity ${selectedModel === id ? "opacity-100" : "opacity-0"}`} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[0.95rem] font-semibold mb-0.5">{name}</div>
                    <div className="text-[0.8rem] text-text-muted font-light">{details}</div>
                  </div>
                  <div className="font-mono text-[0.72rem] text-text-dim shrink-0">{size}</div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-bg border-none rounded-lg font-body text-[0.95rem] font-semibold cursor-pointer mt-4 transition-all shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
              disabled={!selectedModel || downloadBusy}
              onClick={downloadModel}
            >
              {!selectedModel ? t("chat.selectModel") : downloadBusy ? t("chat.downloadingModel") : t("chat.downloadAndContinue")}
            </button>

            {downloadBusy && (
              <div className="mt-4">
                <div className="flex justify-between font-mono text-[0.75rem] text-text-muted mb-1.5">
                  <span>{t("chat.downloadingName", { name: selectedModel || "" })}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1.5 bg-bg-card rounded-sm overflow-hidden">
                  <div className="h-full bg-accent rounded-sm transition-all duration-300" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="font-mono text-[0.72rem] text-text-dim mt-1.5">{progressStatus}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
