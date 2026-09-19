// OWNER: coordinator handoff to scoped subagent missions, with no-op communication tools.
import "server-only";
import { createHash } from "node:crypto";
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
  for (const [index, requested] of proposal.missions.entries()) {
    try {
      // Retrying the same committed proposal must identify the same mission.
      const hex = createHash("sha256")
        .update(`${state.runId}:${proposal.basedOnRevision}:mission:${index}`)
        .digest("hex");
      const missionId =
        requested.missionId ??
        `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
      const linked = state.events.filter((event) => requested.eventIds.includes(event.eventId));
      const event = linked.find((event) => event.eventId === requested.eventIds[0]);
      if (!event?.priority) throw new Error("EVENT_CONFLICT");
      const ranks = { low: 0, medium: 1, high: 2, critical: 3 };
      const priority = linked.reduce(
        (highest, item) =>
          item.priority && ranks[item.priority] > ranks[highest] ? item.priority : highest,
        event.priority,
      );
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
          priority,
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
        needsReplan = true;
        console.warn("Mission handoff unavailable for one change; continuing remaining changes.");
      }
    }
  }
  return { needsReplan };
}

/** Each run owns its drain; old executions cannot hold up a freshly reset run. */
export async function processSubagentMissions(
  onResult: () => void = () => {},
  runId?: string,
  signal?: AbortSignal,
) {
  for (let batch = 0; batch < 7 && !signal?.aborted; batch++) {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, () => runSubagentCycle(runId, signal)),
    );
    if (signal?.aborted) return;
    if (outcomes.some((r) => r.status === "fulfilled" && r.value.changed)) onResult();
    if (outcomes.some((r) => r.status === "rejected"))
      console.warn(
        "Some subagent executions failed; durable leases permit recovery on later intake.",
      );
    if (
      outcomes.every(
        (r) =>
          r.status === "rejected" ||
          ["IDLE", "RUN_CONFLICT", "CANCELLED"].includes(r.value.outcome),
      )
    )
      break;
  }
}
