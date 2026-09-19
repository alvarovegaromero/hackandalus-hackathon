import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/happyrobot", () => ({ getExecutionMode: () => "mock" }));
import { runSubagentCycle, type executeMissionAgent } from "../src/lib/subagents/execute";
import { dispatchPlanMissions } from "../src/lib/subagents/dispatch";
import type { missionRpc } from "../src/lib/subagents/repository";
import type { MissionInput } from "../src/lib/contracts/mission";
import type { CoordinatorProposal, CoordinatorState } from "../src/lib/contracts/coordinator";

const mission: MissionInput = {
  missionId: randomUUID(),
  runId: randomUUID(),
  eventId: randomUUID(),
  revision: 1,
  objective: "Verificar acceso",
  instructions: "Solicitar comprobación",
  context: { incidentSummary: "Aviso de humo", priority: "high" },
  assignedResourceIds: [],
  allowedTools: ["contactService", "getContactResult"],
};
const decision = { status: "blocked" as const, summary: "Falta ubicación", resourceRequest: null };

describe("subagent lifecycle across resets and lost leases", () => {
  it("notifies the parent when claim exhausts recovery without invoking a model", async () => {
    const rpc = vi
      .fn<typeof missionRpc>()
      .mockResolvedValue({ code: "OK", result: { status: "failed" } });
    const execute = vi.fn<typeof executeMissionAgent>();
    expect(await runSubagentCycle(mission.runId, undefined, rpc, execute)).toMatchObject({
      changed: true,
      outcome: "SUBAGENT_FAILED",
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not claim work after reset", async () => {
    const rpc = vi.fn<typeof missionRpc>();
    const abort = new AbortController();
    abort.abort();
    expect(await runSubagentCycle(mission.runId, abort.signal, rpc)).toMatchObject({
      changed: false,
      outcome: "CANCELLED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not finish or fail an old mission when reset interrupts generation", async () => {
    const abort = new AbortController();
    const rpc = vi
      .fn<typeof missionRpc>()
      .mockResolvedValue({ code: "OK", mission, operations: [] });
    const execute = vi.fn<typeof executeMissionAgent>().mockImplementation(async () => {
      abort.abort();
      return { decision, toolCalls: [] };
    });
    expect(await runSubagentCycle(mission.runId, abort.signal, rpc, execute)).toMatchObject({
      changed: false,
      outcome: "CANCELLED",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][2]).toEqual({ runId: mission.runId });
  });
  it("never executes a claimed mission from another run", async () => {
    const rpc = vi.fn<typeof missionRpc>().mockResolvedValue({ code: "OK", mission });
    const execute = vi.fn<typeof executeMissionAgent>();
    expect(await runSubagentCycle(randomUUID(), undefined, rpc, execute)).toMatchObject({
      changed: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("a revoked commit is not reported as a new mission result", async () => {
    const rpc = vi
      .fn<typeof missionRpc>()
      .mockResolvedValueOnce({ code: "OK", mission, operations: [] })
      .mockResolvedValueOnce({ code: "LEASE_LOST" });
    const execute = vi
      .fn<typeof executeMissionAgent>()
      .mockResolvedValue({ decision, toolCalls: [] });
    expect(await runSubagentCycle(mission.runId, undefined, rpc, execute)).toMatchObject({
      changed: false,
      outcome: "LEASE_LOST",
    });
  });
});

describe("coordinator handoff", () => {
  const eventId = mission.eventId;
  const secondId = randomUUID();
  const state = {
    runId: mission.runId,
    events: [
      { eventId, priority: "low", summary: "Humo" },
      { eventId: secondId, priority: "critical", summary: "Dificultad respiratoria" },
    ],
    ambulances: { units: [] },
    police: { units: [] },
    civilGuard: { units: [] },
  } as unknown as CoordinatorState;
  const change = {
    action: "create",
    missionId: null,
    expectedRevision: null,
    eventIds: [eventId, secondId],
    objective: "Comprobar personas",
    instructions: "Coordinar asistencia",
  } as const;
  const proposal = {
    basedOnRevision: 10,
    missions: [{ ...change, eventIds: [...change.eventIds] }],
  } as CoordinatorProposal;
  it("retries one proposal with the same mission ID and uses its highest priority", async () => {
    const submit = vi.fn().mockResolvedValue({});
    await dispatchPlanMissions(state, proposal, submit);
    await dispatchPlanMissions(state, proposal, submit);
    expect(submit.mock.calls[0][0].missionId).toBe(submit.mock.calls[1][0].missionId);
    expect(submit.mock.calls[0][0].context.priority).toBe("critical");
  });
  it("continues other missions and requests a replan when one update races completion", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("MISSION_CONFLICT"))
      .mockResolvedValueOnce({});
    const result = await dispatchPlanMissions(
      state,
      { ...proposal, missions: [...proposal.missions, ...proposal.missions] },
      submit,
    );
    expect(result.needsReplan).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it("does not silently lose a database failure during handoff", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("Persistence unavailable"));
    expect((await dispatchPlanMissions(state, proposal, submit)).needsReplan).toBe(true);
  });
});
