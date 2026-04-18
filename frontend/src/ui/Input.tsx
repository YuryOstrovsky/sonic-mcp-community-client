import {forwardRef, type InputHTMLAttributes} from "react";
import {cn} from "../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({className, type = "text", ...props}, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-white/10 bg-[#0d1220] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500",
        "focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
