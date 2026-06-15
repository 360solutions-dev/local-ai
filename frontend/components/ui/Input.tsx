import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full px-4 py-3 bg-bg-card border border-border rounded-lg text-text font-body text-[0.95rem] outline-none transition-all duration-200 placeholder:text-text-dim focus:border-border-focus focus:shadow-[0_0_0_3px_rgba(52,211,153,0.15)] ${
          error ? "border-danger shadow-[0_0_0_3px_rgba(239,68,68,0.1)]" : ""
        } ${className}`}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
export default Input;
