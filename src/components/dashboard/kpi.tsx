"use client";

import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/utils";

/** Key number that counts to its new value (static under reduced motion). */
export default function Kpi({
  value,
  label,
  tone = "text-ink",
  suffix,
}: {
  value: number;
  label?: string;
  tone?: string;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "flex items-baseline text-kpi leading-none font-semibold tracking-tight tabular-nums",
          value ? tone : "text-muted",
        )}
      >
        <NumberFlow value={value} />
        {suffix && <span className="ml-0.5 text-lead font-medium text-muted">{suffix}</span>}
      </p>
      {label && <p className="mt-1.5 text-meta text-muted">{label}</p>}
    </div>
  );
}
