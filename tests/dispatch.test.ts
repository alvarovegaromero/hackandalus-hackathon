// OWNER: P4 Resource Dispatch integration; real SQL, local HTTP, no phone calls.
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: () => databaseAdapter() }));
vi.mock("@/lib/agents/model", () => ({ createPlannerModel: () => ({ model: "test-model" }) }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));
import { generateText } from "ai";
import { handleDispatchResult } from "@/app/api/dispatch/results/handler";
import { dispatchMissionResources } from "@/lib/dispatch/service";
import { dispatchRpc } from "@/lib/dispatch/repository";
import { startResourceDispatch } from "@/lib/dispatch/client";
import { parseDispatchResult, type DispatchRecord } from "@/lib/dispatch/contracts";
import { runSubagentCycle } from "@/lib/subagents/execute";
import { processDispatchReplanning } from "@/lib/coordinator/background";
import { readCoordinatorState, runCoordinatorCycle } from "@/lib/coordinator/runtime";
import {
  validateCoordinatorProposal,
  type CoordinatorState,
  type CoordinatorProposal,
} from "@/lib/contracts/coordinator";
import { missionInputSchema, missionResultSchema } from "@/lib/contracts/mission";
import { verifyWebhookSecret } from "@/lib/happyrobot";
import { GET as getTelemetry } from "@/app/api/telemetry/route";

let db: PGlite;
let server: Server;
let origin: string;
let requests: { payload: Record<string, unknown>; environment: string }[];
let httpStatus = 200;
let invalidResponse = false;
const secret = "dispatch-test-only";
const schedule = vi.fn();

// Small Supabase transport substitute, not a state-machine mock. Every mutation
// executes the repository's actual PostgreSQL functions and constraints.
function databaseAdapter() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (!["resource_dispatch", "subagent_execution", "coordinate_crisis"].includes(name))
        throw new Error(name);
      const entries = Object.entries(args);
      const sql = `select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")}) as data`;
      try {
        const result = await db.query<{ data: unknown }>(
          sql,
          entries.map(([, value]) => value),
        );
        return { data: result.rows[0].data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from: (table: string) => {
      if (
        ![
          "coordinator_runtime",
          "coordinator_events",
          "subagent_missions",
          "resource_dispatches",
        ].includes(table)
      )
        throw new Error(table);
      let columns = "*",
        suffix = "",
        single = false;
      const predicates: string[] = [],
        values: unknown[] = [];
      const ident = (s: string) => {
        if (!/^[a-z_]+$/.test(s)) throw new Error(s);
        return s;
      };
      const builder = {
        select: (s: string) => {
          columns = s.split(",").map(ident).join(",");
          return builder;
        },
        eq: (key: string, value: unknown) => {
          values.push(value);
          const column =
            key === "state->>runId"
              ? "state->>'runId'"
              : key === "input->report->>runId"
                ? "input->'report'->>'runId'"
                : ident(key);
          predicates.push(`${column}=$${values.length}`);
          return builder;
        },
        in: (key: string, value: unknown[]) => {
          values.push(value);
          predicates.push(`${ident(key)}=any($${values.length}::uuid[])`);
          return builder;
        },
        order: (key: string) => {
          suffix = ` order by ${ident(key)}`;
          return builder;
        },
        limit: (n: number) => {
          suffix += ` limit ${Math.trunc(n)}`;
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        single: () => {
          single = true;
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          db
            .query(
              `select ${columns} from public.${table}${predicates.length ? ` where ${predicates.join(" and ")}` : ""}${suffix}`,
              values,
            )
            .then(
              (result) => resolve({ data: single ? result.rows[0] : result.rows, error: null }),
              reject,
            ),
      };
      return builder;
    },
  };
}

async function rpc(name: string, ...values: unknown[]) {
  const { rows } = await db.query<{ data: Record<string, unknown> }>(
    `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as data`,
    values,
  );
  return rows[0].data;
}
function proposal(state: CoordinatorState): CoordinatorProposal {
  return {
    basedOnRevision: state.revision,
    situationOverview: "Reported wildfire; coordinate access and care.",
    plan: { objective: "Coordinate assistance", steps: ["Confirm access before deployment"] },
    priorities: state.events.map((e) => ({
      eventId: e.eventId,
      priority: "critical",
      rationale: "Reported danger",
    })),
    assignments: state.ambulances.units
      .filter((u) => u.status === "assigned")
      .map((u) => ({ ambulanceId: u.id, eventId: u.eventId! })),
    policeAssignments: [],
    civilGuardAssignments: [],
    missions: [],
  };
}
async function seed(ids = ["ambulance-3"]) {
  const state = await readCoordinatorState();
  const eventId = randomUUID();
  const report = {
    id: eventId,
    runId: state.runId,
    source: "scenario",
    receivedAt: new Date().toISOString(),
    text: "People need assistance near Sierra Bermeja",
    extracted: {},
  };
  expect((await rpc("coordinate_crisis", "enqueue", randomUUID(), { report })).code).toBe("OK");
  await rpc("prepare_coordinator_report", state.runId, eventId, {
    status: "accepted",
    summary: report.text,
    evidence: { report },
  });
  const token = randomUUID();
  const claim = await rpc("coordinate_crisis", "claim", token);
  const current = claim.state as CoordinatorState;
  const plan = proposal(current);
  plan.assignments = ids.map((id) => ({ ambulanceId: id, eventId }));
  expect(
    (await rpc("coordinate_crisis", "commit", token, { trigger: "test.seed", proposal: plan }))
      .code,
  ).toBe("OK");
  const mission = missionInputSchema.parse({
    missionId: randomUUID(),
    revision: 1,
    runId: state.runId,
    eventId,
    eventIds: [eventId],
    objective: "Coordinate medical assistance",
    instructions: "Confirm whether the road is passable before deployment.",
    context: { incidentSummary: report.text, priority: "critical" },
    assignedResourceIds: ids,
    allowedTools: ["contactService", "getContactResult"],
  });
  expect((await rpc("subagent_execution", "submit", mission.missionId, mission)).code).toBe("OK");
  return mission;
}
async function dispatches() {
  return (
    await db.query<DispatchRecord>("select * from public.resource_dispatches order by resource_id")
  ).rows;
}
function callback(d: DispatchRecord, outcome = "accepted", extra = {}) {
  return {
    dispatch_id: d.dispatch_id,
    resource_id: d.resource_id,
    action_id: d.mission_id,
    incident_id: d.run_id,
    plan_id: d.payload.plan_id,
    dispatch_status: outcome,
    ...extra,
  };
}
async function post(body: unknown, token = secret, onSchedule = schedule) {
  return handleDispatchResult(
    new Request("http://faro.test/api/dispatch/results", {
      method: "POST",
      headers: { "content-type": "application/json", "x-happyrobot-secret": token },
      body: JSON.stringify(body),
    }),
    { schedule: onSchedule },
  );
}
async function missionRow(id: string) {
  return (
    await db.query<{ status: string; result: unknown }>(
      "select status,result from public.subagent_missions where mission_id=$1",
      [id],
    )
  ).rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).sort().filter((f) => f >= "202609190004")) {
    await db.exec((await readFile(new URL(file, directory), "utf8")).replace(/^\uFEFF/, ""));
  }
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(httpStatus, { "content-type": "application/json" });
    response.end(JSON.stringify(invalidResponse ? {} : { run_id: `local-run-${requests.length}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local server failed");
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin; set local role service_role;");
  requests = [];
  httpStatus = 200;
  invalidResponse = false;
  schedule.mockClear();
  globalThis.coordinatorBackground = undefined;
  vi.stubEnv("HAPPYROBOT_WEBHOOK_SECRET", secret);
  vi.stubEnv("FARO_WEBHOOK_SECRET", "");
  vi.stubEnv("ACTION_EXECUTION_MODE", "happyrobot");
  vi.stubEnv("HAPPYROBOT_BASE_URL", origin);
  vi.stubEnv("HAPPYROBOT_API_KEY", "local-test-key");
  vi.stubEnv("HAPPYROBOT_DISPATCH_WORKFLOW_ID", "local-dispatch");
  vi.stubEnv("HAPPYROBOT_ENVIRONMENT", "development");
  vi.stubEnv(
    "HAPPYROBOT_RESOURCE_CONTACTS",
    JSON.stringify(
      Object.fromEntries(
        ["ambulance-2", "ambulance-3"].map((id) => [
          id,
          { name: "Test recipient", phone: "+12025550123", demoSafe: true },
        ]),
      ),
    ),
  );
  vi.mocked(generateText).mockReset();
});
afterEach(async () => {
  await db.exec("rollback;");
  vi.unstubAllEnvs();
});

describe("Resource Dispatch: real PostgreSQL persistence and local HTTP", () => {
  it("A: reserved mission → existing worker → HTTP run → accepted callback; no field release", async () => {
    const mission = await seed();
    expect((await runSubagentCycle()).outcome).toBe("OK");
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0].payload)).toHaveLength(15);
    expect(requests[0].payload.action_id).toBe(mission.missionId);
    const [d] = await dispatches();
    expect(d.provider_run_id).toBe("local-run-1");
    expect((await missionRow(mission.missionId)).status).toBe("waiting");
    const response = await post({ dispatch_result: callback(d) });
    expect(response.status).toBe(200);
    const row = await missionRow(mission.missionId);
    expect(row.status).toBe("completed");
    expect(missionResultSchema.parse(row.result).executionMode).toBe("happyrobot");
    expect((await readCoordinatorState()).ambulances.allocated).toBe(1);
    expect((await runSubagentCycle()).outcome).toBe("IDLE");
    expect(requests).toHaveLength(1);
  });
  it.each(["unavailable", "rejected"])(
    "B: %s invalidates commitment and excludes that resource",
    async (outcome) => {
      const mission = await seed();
      await runSubagentCycle();
      const [d] = await dispatches();
      expect(
        (await post(callback(d, outcome, { rejection_reason: "Access road is closed" }))).status,
      ).toBe(200);
      const state = await readCoordinatorState();
      expect(state.ambulances).toMatchObject({ allocated: 0, available: 9, unavailable: 1 });
      expect(state.ambulances.units.find((u) => u.id === "ambulance-3")).toMatchObject({
        status: "unavailable",
        eventId: null,
      });
      expect((await missionRow(mission.missionId)).status).toBe("blocked");
      const invalid = proposal(state);
      invalid.assignments = [{ ambulanceId: "ambulance-3", eventId: mission.eventId }];
      expect(() => validateCoordinatorProposal(state, invalid)).toThrow();
      const token = randomUUID();
      await rpc("coordinate_crisis", "claim", token);
      expect(
        (await rpc("coordinate_crisis", "commit", token, { trigger: "test", proposal: invalid }))
          .code,
      ).toBe("RESOURCE_UNAVAILABLE");
    },
  );
  it("C: concurrent duplicate callbacks apply once, survive new handlers, and reject changed content", async () => {
    await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    const body = callback(d);
    const responses = await Promise.all([
      post(body),
      post({ dispatch_result_json: JSON.stringify(body) }),
    ]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    const state = await readCoordinatorState();
    expect((await post(body)).status).toBe(200);
    expect((await readCoordinatorState()).revision).toBe(state.revision);
    expect((await post(callback(d, "rejected"))).status).toBe(409);
    const rows = await db.query(
      "select * from public.subagent_activity where type='dispatch.result'",
    );
    expect(rows.rows).toHaveLength(1);
  });
  it("D: wrong or absent secrets cannot mutate state; FARO alias remains compatible", async () => {
    await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    expect((await post(callback(d), "wrong")).status).toBe(401);
    expect(schedule).not.toHaveBeenCalled();
    vi.stubEnv("FARO_WEBHOOK_SECRET", "inbound-existing-secret");
    expect(
      verifyWebhookSecret(
        new Request("http://test", {
          headers: { "x-happyrobot-secret": "inbound-existing-secret" },
        }),
      ).ok,
    ).toBe(true);
    expect((await post(callback(d))).status).toBe(200);
    vi.stubEnv("HAPPYROBOT_WEBHOOK_SECRET", "");
    vi.stubEnv("FARO_WEBHOOK_SECRET", "");
    expect((await post(callback(d))).status).toBe(503);
  });
  it("E: callback wakes the existing coordinator with evidence, commits a new plan and another unit", async () => {
    const mission = await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    // Only the nondeterministic model response is substituted. Runtime, prompt
    // assembly, scheduler, validation, SQL commit and audit are production code.
    vi.mocked(generateText).mockImplementation(async (options) => {
      const input = JSON.parse(String(options.prompt));
      expect(input.trigger).toBe("dispatch.result");
      expect(JSON.stringify(input.observations)).toContain("Access road is closed");
      expect(input.state.ambulances.unavailable).toBe(1);
      const next = proposal(input.state);
      next.plan = {
        objective: "Use alternate access",
        steps: ["Verify the alternative route", "Coordinate the next available ambulance"],
      };
      next.assignments = [{ ambulanceId: "ambulance-2", eventId: mission.eventId }];
      return { output: next } as Awaited<ReturnType<typeof generateText>>;
    });
    const response = await post(
      callback(d, "unavailable", { constraint_description: "Access road is closed" }),
    );
    expect(response.status).toBe(200);
    expect(schedule).toHaveBeenCalledOnce();
    await processDispatchReplanning();
    const state = await readCoordinatorState();
    expect(state.plan?.objective).toBe("Use alternate access");
    expect(state.ambulances).toMatchObject({ available: 8, allocated: 1, unavailable: 1 });
    expect(state.ambulances.units.find((u) => u.id === "ambulance-3")?.status).toBe("unavailable");
    expect(
      (
        await db.query<{ dispatch_replan_pending: boolean }>(
          "select dispatch_replan_pending from public.coordinator_runtime",
        )
      ).rows[0].dispatch_replan_pending,
    ).toBe(false);
    expect(
      (await db.query("select * from public.coordinator_audit where trigger='dispatch.result'"))
        .rows,
    ).toHaveLength(1);
  }, 15000);
  it.each([400, 500])(
    "F: provider HTTP %s never creates fake acceptance or auto-redials",
    async (status) => {
      httpStatus = status;
      const mission = await seed();
      await runSubagentCycle();
      const [d] = await dispatches();
      expect(d.status).toBe(status === 400 ? "start_failed" : "unknown");
      expect(d.provider_run_id).toBeNull();
      expect((await missionRow(mission.missionId)).status).toBe("blocked");
      await runSubagentCycle();
      expect(requests).toHaveLength(1);
      expect((await readCoordinatorState()).ambulances.allocated).toBe(1);
    },
  );
  it("missing run_id is unknown; no invented identifier", async () => {
    invalidResponse = true;
    await seed();
    await runSubagentCycle();
    expect((await dispatches())[0]).toMatchObject({ status: "unknown", provider_run_id: null });
    expect(requests).toHaveLength(1);
  });
  it("durable SSE replays the same accepted event used for mission allocation", async () => {
    const mission = await seed();
    const response = await getTelemetry(new Request("http://localhost/api/telemetry"));
    const reader = response.body!.getReader();
    let frames = "";
    try {
      for (let i = 0; i < 5 && !frames.includes('"type":"event.accepted"'); i++) {
        frames += new TextDecoder().decode((await reader.read()).value);
      }
      expect(frames).toContain('"type":"event.accepted"');
      expect(frames).toContain(mission.eventId);
      expect(frames).toContain('"storage":"supabase"');
    } finally {
      await reader.cancel();
    }
  });
  it("two workers and repeated mission handoffs never duplicate a resource call", async () => {
    const mission = await seed();
    await Promise.all([runSubagentCycle(), runSubagentCycle()]);
    const updated = {
      ...mission,
      revision: 2,
      instructions: "Inspect the earlier result before taking further action.",
    };
    expect((await rpc("subagent_execution", "submit", mission.missionId, updated)).code).toBe("OK");
    await runSubagentCycle();
    expect(requests).toHaveLength(1);
    expect(await dispatches()).toHaveLength(1);
  });
  it("all resources must answer before the communication mission is completed", async () => {
    const mission = await seed(["ambulance-2", "ambulance-3"]);
    await runSubagentCycle();
    const rows = await dispatches();
    await post(callback(rows[0]));
    expect((await missionRow(mission.missionId)).status).toBe("waiting");
    await post(callback(rows[1]));
    expect((await missionRow(mission.missionId)).status).toBe("completed");
    expect((await readCoordinatorState()).ambulances.allocated).toBe(2);
  });
  it("unconfigured recipients are blocked, never silently simulated", async () => {
    vi.stubEnv("HAPPYROBOT_RESOURCE_CONTACTS", "{}");
    const mission = await seed();
    await runSubagentCycle();
    expect(requests).toHaveLength(0);
    expect((await dispatches())[0].status).toBe("start_failed");
    expect(missionResultSchema.parse((await missionRow(mission.missionId)).result)).toMatchObject({
      executionMode: "happyrobot",
      realActionsExecuted: false,
    });
  });
  it.each(["no_answer", "failed", "unclear", "accepted_with_limitation"])(
    "records %s without releasing resources",
    async (outcome) => {
      const mission = await seed();
      await runSubagentCycle();
      const [d] = await dispatches();
      await post(callback(d, outcome, { constraint_description: "Only one stretcher" }));
      const row = await missionRow(mission.missionId);
      expect(row.status).toBe(outcome === "accepted_with_limitation" ? "completed" : "blocked");
      expect(missionResultSchema.parse(row.result).needsParentDecision).toBe(true);
      expect((await readCoordinatorState()).ambulances.allocated).toBe(1);
      expect(parseDispatchResult(callback(d, "accepted_with_limitation")).dispatch_status).toBe(
        "accepted_with_constraint",
      );
    },
  );
  it("rejects unknown dispatches, mismatched resources, invalid outcomes and bad JSON", async () => {
    await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    expect((await post({ ...callback(d), dispatch_id: randomUUID() })).status).toBe(404);
    expect((await post({ ...callback(d), resource_id: "ambulance-2" })).status).toBe(409);
    expect((await post(callback(d, "made_up"))).status).toBe(400);
    expect((await post({ dispatch_result_json: "broken" })).status).toBe(400);
  });
  it("late callback after reset is retained but cannot mutate the new crisis", async () => {
    await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    await rpc("reset_coordinator_demo");
    const state = await readCoordinatorState();
    expect((await (await post(callback(d, "unavailable"))).json()).status).toBe("recorded_stale");
    expect((await readCoordinatorState()).revision).toBe(state.revision);
    expect((await readCoordinatorState()).ambulances.available).toBe(10);
  });
  it("callback revokes an in-flight coordinator plan and survives a callback-before-start response race", async () => {
    const mission = await seed();
    const token = randomUUID();
    await rpc("subagent_execution", "claim", token);
    const claimToken = randomUUID();
    let earlierState: CoordinatorState;
    await dispatchMissionResources(mission, token, dispatchRpc, async (payload) => {
      const [d] = await dispatches();
      // Deliver a callback while the coordinator holds an older snapshot and
      // before the sender has persisted the HTTP run response.
      await db.query("update public.coordinator_runtime set last_attempt_at=null where singleton");
      const claim = await rpc("coordinate_crisis", "claim", claimToken);
      expect(claim.code).toBe("OK");
      earlierState = claim.state as CoordinatorState;
      expect((await post(callback(d, "unavailable"))).status).toBe(200);
      return startResourceDispatch(payload);
    });
    expect((await dispatches())[0].status).toBe("unavailable");
    expect((await missionRow(mission.missionId)).status).toBe("blocked");
    expect(
      (
        await rpc("coordinate_crisis", "commit", claimToken, {
          proposal: proposal(earlierState!),
        })
      ).code,
    ).toBe("LEASE_LOST");
  });
  it("model failure retains pending reconsideration and existing operational state", async () => {
    await seed();
    await runSubagentCycle();
    const [d] = await dispatches();
    await post(callback(d, "unavailable"));
    vi.mocked(generateText).mockRejectedValue(new Error("provider down"));
    expect((await runCoordinatorCycle("dispatch.result")).outcome).toBe("COORDINATOR_UNAVAILABLE");
    expect(
      (
        await db.query<{ dispatch_replan_pending: boolean }>(
          "select dispatch_replan_pending from public.coordinator_runtime",
        )
      ).rows[0].dispatch_replan_pending,
    ).toBe(true);
  });
});
