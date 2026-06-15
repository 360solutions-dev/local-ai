interface ErrorAlertProps {
  message: string;
  className?: string;
}

export default function ErrorAlert({ message, className = "" }: ErrorAlertProps) {
  if (!message) return null;
  return (
    <div className={`flex items-center gap-2 px-3.5 py-2.5 bg-danger/[0.08] border border-danger/20 rounded-lg text-[0.85rem] text-danger animate-[shakeIn_0.4s_ease] ${className}`}>
      <span>&#9888;</span>
      <span>{message}</span>
    </div>
  );
}
