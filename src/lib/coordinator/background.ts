// OWNER: in-process POC filtering and debounced coordinator scheduling.
import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { createServerSupabase } from "../supabase/server";
import { prepareCoordinatorReport, readCoordinatorState, runCoordinatorCycle } from "./runtime";

type BackgroundState = {
  filtering?: Promise<void>;
  planning?: Promise<void>;
  dirty: boolean;
  filterAgain?: boolean;
};
declare global {
  var coordinatorBackground: BackgroundState | undefined;
}
const state = () => (globalThis.coordinatorBackground ??= { dirty: false });

function requestPlan(): Promise<void> {
  const current = state();
  current.dirty = true;
  if (!current.planning) {
    current.planning = (async () => {
      // Group accepted reports for two seconds; never block Jev on a model response.
      await delay(2000);
      const deadline = Date.now() + 120_000;
      while (current.dirty && Date.now() < deadline) {
        current.dirty = false;
        const result = await runCoordinatorCycle();
        if (result.outcome === "COORDINATOR_UNAVAILABLE") {
          current.dirty = true;
          break;
        }
        if (result.outcome === "BUSY" || result.outcome === "IDLE") {
          if (!(await readCoordinatorState()).events.length) break;
          current.dirty = true;
          await delay(2000);
        }
      }
    })()
      .catch(() => {
        current.dirty = true;
        console.warn("Coordinator planning failed; the next intake will retry.");
      })
      .finally(() => {
        current.planning = undefined;
      });
  }
  return current.planning;
}

/** Called within Next after(); no processing is attached to dashboard polling. */
export async function processCoordinatorInBackground() {
  const current = state();
  current.filterAgain = true;
  if (!current.filtering) {
    current.filtering = (async () => {
      while (true) {
        current.filterAgain = false;
        const { data, error } = await createServerSupabase()
          .from("coordinator_events")
          .select("input")
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
            if (await prepareCoordinatorReport(row.input)) void requestPlan();
          }),
        );
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Some reports could not be filtered; retry on next intake.");
      }
    })()
      .catch(() => {
        console.warn("Coordinator filtering failed; pending reports remain stored.");
      })
      .finally(() => {
        current.filtering = undefined;
      });
  }
  await current.filtering;
  if (current.planning) await current.planning;
  else if (current.dirty) await requestPlan();
}
