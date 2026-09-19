// OWNER: in-process POC filtering and debounced coordinator scheduling.
import "server-only";
import { dispatchPlanMissions, processSubagentMissions } from "../subagents/dispatch";
import { coordinatorStateSchema } from "../contracts/coordinator";
import { setTimeout as delay } from "node:timers/promises";
import { createServerSupabase } from "../supabase/server";
import { prepareCoordinatorReport, readCoordinatorState, runCoordinatorCycle } from "./runtime";

type BackgroundState = {
  runId: string;
  abort: AbortController;
  filtering?: Promise<void>;
  planning?: Promise<void>;
  missions?: Promise<void>;
  dirty: boolean;
  trigger?: string;
  filterAgain: boolean;
  missionsAgain: boolean;
};
declare global {
  var coordinatorBackground: BackgroundState | undefined;
}

/** Reset fences every callback already running in this process. SQL fences other hosts. */
export function resetCoordinatorBackground(runId: string): BackgroundState {
  globalThis.coordinatorBackground?.abort?.abort();
  return (globalThis.coordinatorBackground = {
    runId,
    abort: new AbortController(),
    dirty: false,
    filterAgain: false,
    missionsAgain: false,
  });
}

function requestMissions(current: BackgroundState) {
  if (current.abort.signal.aborted) return;
  current.missionsAgain = true;
  current.missions ??= (async () => {
    do {
      current.missionsAgain = false;
      await processSubagentMissions(
        () => {
          void requestPlan(current, "mission.result");
        },
        current.runId,
        current.abort.signal,
      );
    } while (current.missionsAgain && !current.abort.signal.aborted);
  })()
    .catch(() => {
      console.warn("Subagent processing unavailable; later intake can recover stored missions.");
    })
    .finally(() => {
      current.missions = undefined;
    });
}

function requestPlan(current: BackgroundState, trigger = "event.received"): Promise<void> {
  if (current.abort.signal.aborted) return Promise.resolve();
  current.dirty = true;
  current.trigger = trigger;
  current.planning ??= (async () => {
    // Group reports without making Jev wait for a model response.
    await delay(2000, undefined, { signal: current.abort.signal });
    const deadline = Date.now() + 110_000;
    while (current.dirty && !current.abort.signal.aborted && Date.now() < deadline) {
      current.dirty = false;
      const result = await runCoordinatorCycle(
        current.trigger,
        current.runId,
        current.abort.signal,
      );
      if (current.abort.signal.aborted || result.outcome === "CANCELLED") return;
      if (result.outcome === "OK" && "proposal" in result && result.proposal && result.state) {
        const handoff = await dispatchPlanMissions(
          coordinatorStateSchema.parse(result.state),
          result.proposal,
        );
        if (handoff.needsReplan) {
          current.dirty = true;
          current.trigger = "mission.conflict";
        }
        requestMissions(current);
      }
      if (result.outcome === "COORDINATOR_UNAVAILABLE") {
        current.dirty = true;
        return;
      }
      if (["BUSY", "IDLE", "LEASE_LOST", "STATE_CONFLICT"].includes(result.outcome)) {
        const latest = await readCoordinatorState();
        if (latest.runId !== current.runId || !latest.events.length) return;
        current.dirty = true;
        await delay(2000, undefined, { signal: current.abort.signal });
      }
    }
  })()
    .catch(() => {
      if (!current.abort.signal.aborted) {
        current.dirty = true;
        console.warn("Coordinator planning failed; the next intake will retry.");
      }
    })
    .finally(() => {
      current.planning = undefined;
    });
  return current.planning;
}

/** Called within Next after(); reads never initiate agents or model calls. */
export async function processCoordinatorInBackground() {
  const observed = globalThis.coordinatorBackground;
  const snapshot = await readCoordinatorState();
  const { runId } = snapshot;
  // A reset/new run may have won while this read was in flight.
  if (
    globalThis.coordinatorBackground !== observed &&
    globalThis.coordinatorBackground?.runId !== runId
  )
    return;
  const current =
    globalThis.coordinatorBackground?.runId === runId
      ? globalThis.coordinatorBackground
      : resetCoordinatorBackground(runId);
  if (snapshot.events.some((event) => event.priority === null)) current.dirty = true;
  current.filterAgain = true;
  current.filtering ??= (async () => {
    while (!current.abort.signal.aborted) {
      current.filterAgain = false;
      const { data, error } = await createServerSupabase()
        .from("coordinator_events")
        .select("input")
        .eq("input->report->>runId", runId)
        .eq("status", "pending")
        .order("created_at")
        .limit(8);
      if (error) throw new Error("Cannot read pending reports.");
      if (!data?.length) {
        if (current.filterAgain) continue;
        return;
      }
      const results = await Promise.allSettled(
        data.map(async (row) => {
          if (await prepareCoordinatorReport(row.input, current.abort.signal))
            void requestPlan(current);
        }),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Some reports could not be filtered; retry on next intake.");
    }
  })()
    .catch(() => {
      if (!current.abort.signal.aborted)
        console.warn("Coordinator filtering failed; pending reports remain stored.");
    })
    .finally(() => {
      current.filtering = undefined;
    });
  await current.filtering;
  if (current.abort.signal.aborted) return;
  // Resume previously queued/expired missions even if this intake was rejected by Jev.
  requestMissions(current);
  const deadline = Date.now() + 120_000;
  if (!current.planning && current.dirty) void requestPlan(current, current.trigger);
  do {
    if (current.planning) await current.planning;
    if (current.missions) await current.missions;
    // Dirty after a failure is retried on later intake, never in a hot loop.
  } while (current.planning && !current.abort.signal.aborted && Date.now() < deadline);
}
