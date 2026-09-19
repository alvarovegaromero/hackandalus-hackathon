"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Skeleton from "@/components/Skeleton";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { NEEDS_ATTENTION, type Mission } from "@/components/MissionsPanel";
import Kpi from "./kpi";

export default function SystemCard({
  missions,
  loading,
  unavailable,
}: {
  missions: Mission[];
  loading: boolean;
  unavailable: boolean;
}) {
  const count = (status: Mission["status"]) => missions.filter((m) => m.status === status).length;
  const running = count("running");
  const done = count("completed");
  const attention = missions.filter((m) => NEEDS_ATTENTION.includes(m.status)).length;
  const active = !unavailable && running > 0;
  return (
    <Card aria-labelledby="system-title" className={active ? "glass-running" : undefined}>
      <CardHeader>
        <CardTitle id="system-title">Agent missions</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end gap-5">
        {loading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <>
            <Kpi value={running} label="Running" tone="text-running" />
            <Kpi value={done} label="Completed" />
            <Kpi value={attention} label="Need attention" tone="text-ink" />
          </>
        )}
        {active && (
          <LoaderCircle
            size={28}
            aria-hidden="true"
            className="mb-4 ml-auto shrink-0 text-running motion-safe:animate-spin"
          />
        )}
      </CardContent>
      <p role="status" aria-live="polite" className="mt-auto truncate text-meta text-muted">
        {unavailable ? (
          <span className="flex items-center gap-1 text-ink">
            <TriangleAlert size={12} aria-hidden="true" /> Updates unavailable · last known data
          </span>
        ) : active ? (
          <span className="text-running">
            {running} {running === 1 ? "agent is" : "agents are"} working now
          </span>
        ) : missions.length ? (
          `${missions.length} missions dispatched this run`
        ) : (
          "No agent missions yet"
        )}
      </p>
    </Card>
  );
}
