"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// The radius lives in the base and in the pill variants, never in `size`, so a
// pill button keeps its shape at every size (twMerge lets the last class win).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] text-[13px] font-medium tracking-[-0.15px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-blueprint-dark text-white hover:bg-blueprint-dark/90 shadow-xs active:scale-[0.98] transition-transform",
        destructive: "bg-danger text-white hover:bg-danger/90 shadow-xs active:scale-[0.98]",
        outline:
          "border border-line bg-white text-ink hover:bg-neutral-50 hover:border-blueprint-light",
        secondary:
          "bg-neutral-100 text-blueprint-dark hover:bg-neutral-200/80 border border-neutral-200/60",
        ghost: "hover:bg-neutral-100 text-blueprint-dark",
        pill: "rounded-full bg-blueprint-dark text-white hover:bg-blueprint-dark/90 shadow-xs px-4 active:scale-[0.98]",
        pillDestructive:
          "rounded-full bg-danger-soft text-danger border border-danger/30 hover:bg-danger-soft/70",
        pillWarning:
          "rounded-full bg-warn-soft text-warn border border-warn/30 hover:bg-warn-soft/70",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px]",
        lg: "h-9 px-4 text-[14px]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
