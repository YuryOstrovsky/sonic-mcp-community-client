import {forwardRef, type ButtonHTMLAttributes} from "react";
import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:   "bg-orange-600/90 hover:bg-orange-600 text-white border border-orange-500/60",
        secondary: "bg-white/[0.04] hover:bg-white/[0.08] text-gray-200 border border-white/10",
        ghost:     "hover:bg-white/[0.06] text-gray-300",
        danger:    "bg-red-600/90 hover:bg-red-600 text-white",
        outline:   "border border-white/15 text-gray-200 hover:bg-white/[0.06]",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-3",
        lg: "h-10 px-4 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {variant: "secondary", size: "md"},
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({className, variant, size, ...props}, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({variant, size}), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
