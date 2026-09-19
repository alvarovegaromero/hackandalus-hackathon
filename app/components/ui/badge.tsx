import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[12px] font-medium tracking-[-0.15px] transition-colors",
  {
    variants: {
      variant: {
        default: "border-neutral-200/80 bg-neutral-100 text-blueprint-dark",
        secondary: "border-transparent bg-neutral-100 text-blueprint-mid",
        critical: "border-danger/30 bg-danger-soft text-danger",
        warning: "border-warn/30 bg-warn-soft text-warn",
        success: "border-ok/30 bg-ok-soft text-ok",
        info: "border-info/30 bg-info-soft text-info",
        outline: "border-line text-blueprint-dark bg-white",
        pill: "rounded-full border-neutral-200 bg-neutral-100 text-blueprint-dark",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
