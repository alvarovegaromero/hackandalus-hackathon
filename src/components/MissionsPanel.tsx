"use client";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { cva } from "class-variance-authority";
import { resourceSummary } from "./resource-summary";
import { TextSkeleton } from "./Skeleton";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { z } from "zod";
import { missionInputSchema, missionResultSchema } from "@/lib/contracts/mission";

/** Attention first: problems, then work in flight, then history. */
export const MISSION_STATUSES = [
  "blocked",
  "failed",
  "running",
  "waiting",
  "queued",
  "completed",
  "cancelled",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];
export const NEEDS_ATTENTION: MissionStatus[] = ["blocked", "failed"];

const missionListSchema = z.object({
  missions: z.array(
    z.object({
      mission_id: z.string(),
      created_at: z.string(),
      status: z.enum(MISSION_STATUSES),
      input: missionInputSchema,
      result: missionResultSchema.nullable(),
    }),
  ),
});
export type Mission = z.infer<typeof missionListSchema>["missions"][number];

/** Polls subagent missions for the current coordinator run. */
export function useMissions(runId?: string) {
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
  const current = snapshot && snapshot.runId === runId ? snapshot.missions : [];
  const rank = (status: MissionStatus) => MISSION_STATUSES.indexOf(status);
  const missions = [...current].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      b.created_at.localeCompare(a.created_at) ||
      b.mission_id.localeCompare(a.mission_id),
  );
  return { missions, loading: !snapshot || snapshot.runId !== runId, error };
}

const statusText = cva("flex shrink-0 items-center gap-1 text-meta", {
  variants: {
    status: {
      blocked: "font-medium text-ink",
      failed: "font-medium text-ink",
      running: "rounded-md bg-running/15 px-2 py-1 font-semibold text-running",
      waiting: "text-muted",
      queued: "text-muted",
      completed: "text-muted",
      cancelled: "text-muted",
    },
  },
});

export function MissionStatusLabel({ status }: { status: MissionStatus }) {
  return (
    <span className={statusText({ status })}>
      {NEEDS_ATTENTION.includes(status) && <TriangleAlert size={12} aria-hidden="true" />}
      {status === "running" && (
        <LoaderCircle size={14} aria-hidden="true" className="motion-safe:animate-spin" />
      )}
      {status}
    </span>
  );
}

export default function MissionsPanel({
  missions,
  loading,
  unavailable,
}: {
  missions: Mission[];
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-labelledby="missions-title">
      <h2 id="missions-title" className="text-body font-medium text-muted">
        Mission log
      </h2>
      {unavailable && (
        <p role="status" className="flex items-center gap-1 text-meta">
          <TriangleAlert size={12} aria-hidden="true" /> Mission updates unavailable. Showing last
          known data.
        </p>
      )}
      {loading && !unavailable && <TextSkeleton />}
      {!loading && !missions.length && (
        <p className="text-meta text-muted">No missions assigned yet.</p>
      )}
      <MissionRows missions={missions} ready={!loading} />
    </section>
  );
}

function MissionRows({ missions, ready }: { missions: Mission[]; ready: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  const previous = useRef(new Map<string, number>());
  const initialized = useRef(false);
  // FLIP: a new or re-ranked mission slides into place so the change is traceable.
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
          { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    }
    previous.current = next;
    initialized.current = true;
  }, [missions, ready]);
  return (
    <ul ref={list} className="dashboard-scroll -mx-2 grid content-start gap-1.5 px-2">
      {missions.map((m) => (
        <li
          key={m.mission_id}
          data-id={m.mission_id}
          className={
            m.status === "running"
              ? "rounded-lg border border-running/40 bg-running/10 px-3 py-2.5"
              : "rounded-lg border border-line bg-ink/[0.02] px-3 py-2.5"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <span className="line-clamp-2 text-body">{m.input.objective}</span>
            <MissionStatusLabel status={m.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-meta text-muted">
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
            {!!m.input.assignedResourceIds.length &&
              ` · ${resourceSummary(m.input.assignedResourceIds)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
