import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-bg border-none font-semibold shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)]",
  secondary:
    "bg-transparent text-text-muted border border-border hover:border-text-muted hover:text-text",
  danger:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  ghost:
    "bg-transparent text-text-muted border-none hover:text-text",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, children, className = "", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-body text-[0.92rem] cursor-pointer transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
        {loading && (
          <div className="w-[18px] h-[18px] border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
      </button>
    );
  }
);
Button.displayName = "Button";
export default Button;
