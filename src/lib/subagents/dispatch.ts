// OWNER: coordinator handoff to scoped subagent missions, with no-op communication tools.
import "server-only";
import { randomUUID } from "node:crypto";
import type { CoordinatorState, CoordinatorProposal } from "../contracts/coordinator";
import { submitReservedMission, missionRpc } from "./repository";
import { runSubagentCycle } from "./execute";

export async function dispatchPlanMissions(
  state: CoordinatorState,
  proposal: CoordinatorProposal,
  submit = submitReservedMission,
  rpc = missionRpc,
) {
  let needsReplan = false;
  for (const requested of proposal.missions) {
    try {
      const event = state.events.find((e) => e.eventId === requested.eventIds[0]);
      if (!event?.priority) continue;
      const missionId = requested.missionId ?? randomUUID();
      if (requested.action === "cancel") {
        const result = await rpc("cancel", missionId, {
          missionId,
          runId: state.runId,
          expectedRevision: requested.expectedRevision,
          reason: requested.instructions,
        });
        if (result.code !== "OK") throw new Error(result.code);
        continue;
      }
      await submit({
        missionId,
        runId: state.runId,
        eventId: event.eventId,
        revision: requested.action === "create" ? 1 : requested.expectedRevision! + 1,
        eventIds: requested.eventIds,
        objective: requested.objective,
        instructions: requested.instructions,
        context: {
          incidentSummary: state.events
            .filter((e) => requested.eventIds.includes(e.eventId))
            .map((e) => e.summary)
            .join("\n")
            .slice(0, 4000),
          priority: event.priority,
        },
        assignedResourceIds: [
          ...state.ambulances.units,
          ...state.police.units,
          ...state.civilGuard.units,
        ]
          .filter((u) => u.eventId && requested.eventIds.includes(u.eventId))
          .map((u) => u.id),
        allowedTools: ["contactService", "getContactResult"],
      });
    } catch (error) {
      // A mission may finish while the parent is generating its changes.
      // Do not let one stale change discard the rest of the handoff.
      if (
        error instanceof Error &&
        ["MISSION_CONFLICT", "RESOURCE_NOT_RESERVED", "EVENT_CONFLICT"].includes(error.message)
      ) {
        needsReplan = true;
      } else {
        console.warn("Mission handoff unavailable for one change; continuing remaining changes.");
      }
    }
  }
  return { needsReplan };
}

let running: Promise<void> | undefined;
export function processSubagentMissions(onResult: () => void = () => {}) {
  return (running ??= (async () => {
    // Independent of Jev and parent planning; communication currently uses a no-op adapter.
    for (let batch = 0; batch < 7; batch++) {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 3 }, () => runSubagentCycle()),
      );
      if (outcomes.some((r) => r.status === "fulfilled" && r.value.changed)) onResult();
      if (outcomes.every((r) => r.status === "rejected" || r.value.outcome === "IDLE")) break;
    }
  })()
    .catch(() => {
      console.warn("Subagent processing unavailable.");
    })
    .finally(() => {
      running = undefined;
    }));
}
