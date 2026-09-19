"use client";

import { Ambulance, Shield, ShieldCheck } from "lucide-react";
import { cva } from "class-variance-authority";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Skeleton from "@/components/Skeleton";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import { FORCES } from "./model";

const icons = { ambulances: Ambulance, police: Shield, civilGuard: ShieldCheck };

// Filled = assigned. Free cells stay outlined so the eye reads remaining capacity as empty space.
const cell = cva("h-4 flex-1 rounded-[2px] border transition-colors", {
  variants: {
    assigned: { true: "border-muted bg-muted", false: "border-line bg-transparent" },
    selected: { true: "outline-2 outline-offset-1 outline-focus", false: "" },
  },
});

export default function ResourcesCard({
  state,
  summaries,
  selectedId,
  onSelect,
}: {
  state: CoordinatorState | null;
  /** Event summary by event ID, for unit labels. */
  summaries: Map<string, string>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const free = state ? FORCES.reduce((sum, { kind }) => sum + state[kind].available, 0) : 0;
  return (
    <Card aria-labelledby="resources-title">
      <CardHeader>
        <CardTitle id="resources-title">Do we have units left?</CardTitle>
        <span className="text-meta text-muted">free of 10</span>
      </CardHeader>
      <CardContent className="grid grid-cols-[max-content_2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {FORCES.map(({ kind, label }) => {
          const Icon = icons[kind];
          const inventory = state?.[kind];
          const exhausted = inventory?.available === 0;
          return (
            <div key={kind} className="contents">
              <span className="flex items-baseline gap-2 text-body">
                <Icon size={14} aria-hidden="true" className="self-center text-muted" />
                {label}
                {exhausted && (
                  <span aria-hidden="true" className="text-meta font-medium text-critical">
                    Exhausted
                  </span>
                )}
              </span>
              {inventory ? (
                <span className="text-right text-lead font-semibold tabular-nums">
                  <span className={exhausted ? "text-critical" : "text-ink"}>
                    {inventory.available}
                  </span>
                  {exhausted && <span className="sr-only"> free, exhausted</span>}
                </span>
              ) : (
                <Skeleton className="h-5 w-8 justify-self-end" />
              )}
              <div className="flex items-center gap-1" role="group" aria-label={`${label} units`}>
                {inventory?.units.map((unit) => {
                  const assigned = unit.status === "assigned";
                  const target = unit.eventId ? summaries.get(unit.eventId) : undefined;
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      disabled={!assigned}
                      onClick={() => onSelect(unit.id)}
                      title={assigned ? `${unit.id}: ${target ?? "assigned"}` : `${unit.id}: free`}
                      aria-label={
                        assigned
                          ? `${unit.id}, assigned to ${target ?? "an event"}`
                          : `${unit.id}, free`
                      }
                      className={cell({ assigned, selected: unit.id === selectedId })}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        {state ? (
          <>
            <span className="text-ink tabular-nums">{free}</span> of 30 units free · filled cell =
            assigned, select to locate
          </>
        ) : (
          "Waiting for resource state"
        )}
      </CardFooter>
    </Card>
  );
}
