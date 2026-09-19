"use client";
import { Badge } from "./ui/badge";
import { resourceSummary } from "./resource-summary";
import { TextSkeleton } from "./Skeleton";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { z } from "zod";
import { missionInputSchema, missionResultSchema } from "@/lib/contracts/mission";

const missionListSchema = z.object({
  missions: z.array(
    z.object({
      mission_id: z.string(),
      created_at: z.string(),
      status: z.enum([
        "queued",
        "running",
        "waiting",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ]),
      input: missionInputSchema,
      result: missionResultSchema.nullable(),
    }),
  ),
});
type Mission = z.infer<typeof missionListSchema>["missions"][number];
export default function MissionsPanel({
  runId,
  unavailable = false,
}: {
  runId?: string;
  unavailable?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<{ runId: string; missions: Mission[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!runId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/api/subagents", { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const { missions } = missionListSchema.parse(await response.json());
        if (!abort.signal.aborted) {
          setSnapshot({ runId, missions: missions.filter((m) => m.input.runId === runId) });
          setError(false);
        }
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [runId]);
  const missions = snapshot && snapshot.runId === runId ? snapshot.missions : [];
  const loading = (!snapshot || snapshot.runId !== runId) && !error && !unavailable;
  const ordered = [...missions].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.mission_id.localeCompare(a.mission_id),
  );
  return (
    <section className="subagents-panel text-sm" aria-label="Subagents">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">
          Subagents <span className="text-neutral-500">{loading ? "" : missions.length}</span>
        </h2>
      </div>
      {(error || unavailable) && (
        <p role="status" className="mt-2 text-amber-800">
          Mission updates unavailable. Showing last known data.
        </p>
      )}
      {loading && <TextSkeleton />}
      {!loading && !error && !unavailable && !missions.length && (
        <p className="mt-3 text-neutral-500">No missions assigned yet.</p>
      )}
      <MissionRows key={runId} missions={ordered} ready={!loading} />
    </section>
  );
}

function MissionRows({ missions, ready }: { missions: Mission[]; ready: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  const previous = useRef(new Map<string, number>());
  const initialized = useRef(false);
  useLayoutEffect(() => {
    if (!ready) return;
    const nodes = Array.from(list.current?.children ?? []) as HTMLElement[];
    const next = new Map(nodes.map((node) => [node.dataset.id!, node.offsetTop]));
    const added = nodes.some((node) => !previous.current.has(node.dataset.id!));
    if (
      initialized.current &&
      added &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      for (const node of nodes) {
        const oldTop = previous.current.get(node.dataset.id!);
        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          oldTop === undefined
            ? [
                { opacity: 0, transform: "translateY(-8px)" },
                { opacity: 1, transform: "translateY(0)" },
              ]
            : [
                { transform: `translateY(${oldTop - node.offsetTop}px)` },
                { transform: "translateY(0)" },
              ],
          { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    }
    previous.current = next;
    initialized.current = true;
  }, [missions, ready]);
  return (
    <ul ref={list} className="mission-feed">
      {missions.map((m) => (
        <li key={m.mission_id} data-id={m.mission_id} data-status={m.status}>
          <div className="mission-row py-3">
            <div className="flex items-start justify-between gap-4">
              <span className="font-medium">{m.input.objective}</span>
              <Badge variant="outline" className="mission-status-badge">
                {m.status}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
              {m.result?.summary ??
                {
                  queued: "Waiting to start",
                  running: "Working on this mission",
                  waiting: "Waiting for a response",
                  blocked: "Needs attention",
                  failed: "Execution failed",
                  completed: "Completed",
                  cancelled: "Cancelled",
                }[m.status]}
            </p>
            {!!m.input.assignedResourceIds.length && (
              <p className="mt-1 text-xs text-neutral-500">
                {resourceSummary(m.input.assignedResourceIds)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
