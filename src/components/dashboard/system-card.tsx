"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Skeleton from "@/components/Skeleton";
import { LoaderCircle } from "lucide-react";
import {
  MISSION_STATUSES,
  MissionStatusLabel,
  NEEDS_ATTENTION,
  type Mission,
} from "@/components/MissionsPanel";
import type { CoordinatorState } from "@/lib/contracts/coordinator";

export default function SystemCard({
  state,
  missions,
  loading,
  unavailable,
}: {
  state: CoordinatorState | null;
  missions: Mission[];
  loading: boolean;
  unavailable: boolean;
}) {
  const counts = MISSION_STATUSES.map(
    (status) => [status, missions.filter((m) => m.status === status).length] as const,
  ).filter(([, count]) => count);
  const attention = missions.filter((m) => NEEDS_ATTENTION.includes(m.status)).length;
  const running = missions.filter((mission) => mission.status === "running").length;
  const active = !unavailable && running > 0;
  return (
    <Card aria-labelledby="system-title" className={active ? "ring-2 ring-running/60" : undefined}>
      <CardHeader>
        <CardTitle id="system-title">What is the system doing?</CardTitle>
        {state?.plan && <span className="text-meta text-muted">Plan rev. {state.revision}</span>}
      </CardHeader>
      <CardContent className="min-h-[3em] text-lead">
        <div role="status" aria-live="polite" aria-atomic="true">
          {unavailable ? (
            <p className="mb-3 text-body text-muted">
              Mission updates unavailable. Showing last known status.
            </p>
          ) : active ? (
            <div className="mb-3 flex items-center gap-3 rounded-md bg-running/15 px-3 py-2 text-running">
              <LoaderCircle
                size={22}
                aria-hidden="true"
                className="shrink-0 motion-safe:animate-spin"
              />
              <p className="text-lead font-semibold">
                Running · {running} {running === 1 ? "mission" : "missions"} in progress
              </p>
            </div>
          ) : null}
        </div>
        {loading ? (
          <div role="status" aria-label="Loading" className="grid h-[3em] content-center gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <p className="line-clamp-2 text-lead" title={state?.plan?.objective}>
            {state?.plan?.objective ?? "Waiting for the first assessment."}
          </p>
        )}
      </CardContent>
      <CardFooter className="min-h-[calc(var(--size-body)*1.5)]">
        {counts.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Missions by status">
            {counts.map(([status, count]) => (
              <li key={status} className="flex items-center gap-1 tabular-nums">
                <span className="text-body font-semibold text-ink">{count}</span>
                <MissionStatusLabel status={status} />
              </li>
            ))}
          </ul>
        ) : (
          "No subagent missions yet"
        )}
        {attention > 0 && <span className="sr-only">{attention} missions need attention.</span>}
      </CardFooter>
    </Card>
  );
}
