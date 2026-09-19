"use client";

import { Ambulance, Shield, ShieldCheck } from "lucide-react";
import { cva } from "class-variance-authority";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Skeleton from "@/components/Skeleton";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import Kpi from "./kpi";
import { FORCES } from "./model";

const icons = { ambulances: Ambulance, police: Shield, civilGuard: ShieldCheck };

// Filled = assigned. Free cells stay outlined so the eye reads remaining capacity as empty space.
const cell = cva("h-2.5 flex-1 rounded-[3px] border transition-colors duration-500", {
  variants: {
    assigned: { true: "border-ink/80 bg-ink/80", false: "border-muted/30 bg-transparent" },
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
  const deployed = state ? FORCES.reduce((sum, { kind }) => sum + state[kind].allocated, 0) : 0;
  return (
    <Card aria-labelledby="resources-title">
      <CardHeader>
        <CardTitle id="resources-title">Units deployed</CardTitle>
        <span className="text-meta text-muted tabular-nums">
          {state ? `${30 - deployed} of 30 free` : ""}
        </span>
      </CardHeader>
      <CardContent className="flex items-center gap-5">
        {state ? <Kpi value={deployed} suffix="/30" /> : <Skeleton className="h-8 w-16" />}
        <div className="grid min-w-0 flex-1 grid-cols-[max-content_minmax(0,1fr)_1.25rem] items-center gap-x-2 gap-y-1.5">
          {FORCES.map(({ kind, label }) => {
            const Icon = icons[kind];
            const inventory = state?.[kind];
            const exhausted = inventory?.available === 0;
            return (
              <div key={kind} className="contents">
                <Icon size={13} aria-label={label} className="text-muted" />
                <div className="flex gap-0.5" role="group" aria-label={`${label} units`}>
                  {inventory?.units
                    .toSorted(
                      (a, b) =>
                        Number(b.status === "assigned") - Number(a.status === "assigned") ||
                        a.id.localeCompare(b.id, undefined, { numeric: true }),
                    )
                    .map((unit) => {
                      const assigned = unit.status === "assigned";
                      const target = unit.eventId ? summaries.get(unit.eventId) : undefined;
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          disabled={!assigned}
                          onClick={() => onSelect(unit.id)}
                          title={
                            assigned ? `${unit.id}: ${target ?? "assigned"}` : `${unit.id}: free`
                          }
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
                <span
                  className={`text-right text-meta font-medium tabular-nums ${exhausted ? "text-critical" : "text-muted"}`}
                  title={exhausted ? `${label} exhausted` : `${label} free`}
                >
                  {inventory?.available}
                  {exhausted && <span className="sr-only"> free, exhausted</span>}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
      <p className="mt-auto text-meta text-muted">
        {FORCES.filter(({ kind }) => state?.[kind].available === 0)
          .map(({ label }) => `${label} exhausted`)
          .join(" · ") || "Filled cell = assigned · select to locate"}
      </p>
    </Card>
  );
}
