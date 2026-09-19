import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[12px] font-medium tracking-[-0.15px] transition-colors",
  {
    variants: {
      variant: {
        default: "border-neutral-200/80 bg-neutral-100 text-[#292929]",
        secondary: "border-transparent bg-neutral-100 text-[#5d5d5d]",
        critical: "border-[#f5b8b4] bg-[#fde4e2] text-[#a11b12]",
        warning: "border-[#f5d4a6] bg-[#fdf0e0] text-[#96490f]",
        success: "border-[#bfe2ce] bg-[#e3f4ea] text-[#14663f]",
        info: "border-[#bed7f0] bg-[#e6f0fa] text-[#17527f]",
        outline: "border-[#d8d4c9] text-[#292929] bg-white",
        pill: "rounded-full border-neutral-200 bg-neutral-100 text-[#292929]",
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
