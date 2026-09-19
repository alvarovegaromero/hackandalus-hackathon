"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Skeleton from "@/components/Skeleton";
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
}: {
  state: CoordinatorState | null;
  missions: Mission[];
  loading: boolean;
}) {
  const counts = MISSION_STATUSES.map(
    (status) => [status, missions.filter((m) => m.status === status).length] as const,
  ).filter(([, count]) => count);
  const attention = missions.filter((m) => NEEDS_ATTENTION.includes(m.status)).length;
  return (
    <Card aria-labelledby="system-title">
      <CardHeader>
        <CardTitle id="system-title">What is the system doing?</CardTitle>
        {state?.plan && <span className="text-meta text-muted">Plan rev. {state.revision}</span>}
      </CardHeader>
      <CardContent className="min-h-[3em] text-lead">
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
