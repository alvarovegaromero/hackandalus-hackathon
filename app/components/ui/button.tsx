"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-[13px] font-medium tracking-[-0.15px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-[#292929] text-white hover:bg-[#1a1a1a] shadow-xs active:scale-[0.98] transition-transform",
        destructive: "bg-[#a11b12] text-white hover:bg-[#85160e] shadow-xs active:scale-[0.98]",
        outline:
          "border border-[#d8d4c9] bg-white text-[#131720] hover:bg-neutral-50 hover:border-[#b0a999]",
        secondary:
          "bg-neutral-100 text-[#292929] hover:bg-neutral-200/80 border border-neutral-200/60",
        ghost: "hover:bg-neutral-100 text-[#292929]",
        pill: "rounded-full bg-[#292929] text-white hover:bg-[#1f1f1f] shadow-xs px-4 active:scale-[0.98]",
        pillDestructive:
          "rounded-full bg-[#fde4e2] text-[#a11b12] border border-[#f5b8b4] hover:bg-[#fbd3d0]",
        pillWarning:
          "rounded-full bg-[#fdf0e0] text-[#96490f] border border-[#f5d4a6] hover:bg-[#fce5c8]",
      },
      size: {
        default: "h-8 px-3 rounded-[8px]",
        sm: "h-7 px-2.5 text-[12px] rounded-[6px]",
        lg: "h-9 px-4 text-[14px] rounded-[8px]",
        pill: "h-8 px-4 rounded-full text-[13px]",
        icon: "h-8 w-8 rounded-[8px] p-0",
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
