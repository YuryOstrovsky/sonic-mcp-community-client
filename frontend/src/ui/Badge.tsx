import {type HTMLAttributes} from "react";
import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border",
  {
    variants: {
      tone: {
        good:    "bg-green-500/10 text-green-300 border-green-500/20",
        warn:    "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
        bad:     "bg-red-500/10 text-red-300 border-red-500/20",
        info:    "bg-blue-500/10 text-blue-300 border-blue-500/20",
        neutral: "bg-white/[0.04] text-gray-400 border-white/10",
      },
    },
    defaultVariants: {tone: "neutral"},
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({className, tone, ...props}: BadgeProps) {
  return <span className={cn(badgeVariants({tone}), className)} {...props} />;
}
