interface ToastProps {
  message: string | null;
}

export default function Toast({ message }: ToastProps) {
  return (
    <div
      className={`fixed bottom-8 right-8 px-5 py-3 bg-bg-elevated border border-border-accent rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] font-mono text-[0.85rem] text-accent z-[1000] transition-all duration-300 ${
        message ? "translate-y-0 opacity-100" : "translate-y-[100px] opacity-0 pointer-events-none"
      }`}
    >
      &#10004; {message}
    </div>
  );
}
