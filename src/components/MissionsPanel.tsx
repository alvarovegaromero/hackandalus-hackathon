"use client";
import { TextSkeleton } from "./Skeleton";
import { useEffect, useState } from "react";
import { z } from "zod";
import { missionInputSchema, missionResultSchema } from "@/lib/contracts/mission";

const missionListSchema = z.object({
  missions: z.array(
    z.object({
      mission_id: z.string(),
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
  const active = missions.filter((m) => !["completed", "cancelled"].includes(m.status));
  const closed = missions.filter((m) => ["completed", "cancelled"].includes(m.status));
  return (
    <section className="py-2 text-sm" aria-label="Missions">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">
          Missions <span className="text-neutral-500">{loading ? "" : active.length}</span>
        </h2>
        <span className="text-xs text-neutral-500">No-op communications</span>
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
      <MissionRows missions={active} />
      {!!closed.length && (
        <details className="mt-3">
          <summary className="cursor-pointer py-2 text-xs text-neutral-500">
            Completed / cancelled · {closed.length}
          </summary>
          <MissionRows missions={closed} />
        </details>
      )}
    </section>
  );
}

function MissionRows({ missions }: { missions: Mission[] }) {
  return (
    <ul className="divide-y divide-line">
      {missions.map((m) => (
        <li key={m.mission_id}>
          <details className="py-3">
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-4">
                <span className="font-medium">{m.input.objective}</span>
                <span className="shrink-0 text-xs text-neutral-500">{m.status}</span>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                {m.result?.summary ?? "Pending execution"}
              </p>
              {!!m.input.assignedResourceIds.length && (
                <p className="mt-1 text-xs text-neutral-500">
                  Resources:
                  {m.input.assignedResourceIds.join(" · ")}
                </p>
              )}
            </summary>
            <div className="mt-3 space-y-2 text-xs text-neutral-500">
              <p>{m.input.instructions}</p>
              {m.result && <p>{m.result.summary}</p>}
              <p>
                Revision {m.input.revision} · {(m.input.eventIds ?? [m.input.eventId]).length}{" "}
                linked events
              </p>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
