// OWNER: HappyRobot integration, contacts, and escalation agent.
//
// Coverage of the external boundary. Everything with a stubbed `fetch`: these
// tests must NEVER trigger a real call, message or run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webhookPost } from "@/app/api/webhooks/happyrobot/route";
import {
  HappyRobotError,
  buildRunBody,
  executeHappyRobotAction,
  runEndpoint,
  workflowIdForAction,
} from "@/lib/happyrobot";
import { createAction, getSituation, resetSituation, setActionStatus } from "@/lib/store";
import type { Action, Contact } from "@/lib/types";

const SECRET = "test-webhook-secret";
const BASE = "https://platform.eu.happyrobot.test/api/v2";

function makeAction(overrides: Partial<Action> = {}): Action {
  const at = new Date().toISOString();
  return {
    id: "act-test-1",
    channel: "call",
    target: "INFOCA Sierra Bravo",
    objective: "Confirm deployment to the north sector",
    reason: "Fire front advancing towards the campsite",
    status: "running",
    zoneId: "zone-north",
    contactId: "con-demo",
    resourceId: undefined,
    executionMode: "happyrobot",
    attempt: 1,
    idempotencyKey: "act-test-1:1",
    stalledAfter: null,
    approvedBy: "operator",
    approvedAt: at,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  } as Action;
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "con-demo",
    name: "Demo field coordinator",
    role: "field-coordinator",
    zoneId: "zone-north",
    channels: ["call", "sms"],
    phone: "+34600000000",
    email: "demo@example.org",
    demoSafe: true,
    lastContactedAt: null,
    responsiveness: 0.9,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "happyrobot";
  process.env.HAPPYROBOT_API_KEY = "sk_test_unit";
  process.env.HAPPYROBOT_BASE_URL = BASE;
  process.env.HAPPYROBOT_DISPATCH_WORKFLOW_ID = "wf-dispatch";
  process.env.HAPPYROBOT_PUBLIC_ALERT_WORKFLOW_ID = "wf-alert";
  process.env.HAPPYROBOT_WEBHOOK_SECRET = SECRET;
  process.env.HAPPYROBOT_RETRY_BASE_MS = "1";
  process.env.HAPPYROBOT_MAX_ATTEMPTS = "3";
  process.env.HAPPYROBOT_TIMEOUT_MS = "8000";
  delete process.env.HAPPYROBOT_WORKFLOW_ID;
  delete process.env.HAPPYROBOT_ENVIRONMENT;
  delete process.env.HAPPYROBOT_CHANNEL_WORKFLOWS;
  globalThis.happyRobotDeliveries = undefined;
  resetSituation();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Adapter: safeguards
// ---------------------------------------------------------------------------

describe("HappyRobot adapter: safeguards", () => {
  it("in mock mode nothing leaves the process and the result is labelled simulated", async () => {
    process.env.ACTION_EXECUTION_MODE = "mock";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(makeAction(), makeContact());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
    expect(result.simulated).toBe(true);
    expect(result.externalActionId).toContain("mock-");
  });

  it("fails explicitly when credentials are missing, without calling anyone", async () => {
    delete process.env.HAPPYROBOT_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeHappyRobotAction(makeAction(), makeContact())).rejects.toMatchObject({
      kind: "missing-credentials",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the channel has no workflow and no generic fallback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeHappyRobotAction(makeAction({ channel: "email" }), makeContact()),
    ).rejects.toMatchObject({ kind: "missing-workflow" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downgrades to simulation if the contact is not demo-safe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(
      makeAction(),
      makeContact({ demoSafe: false, name: "Real unapproved contact" }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
    expect(result.simulated).toBe(true);
    expect(result.externalActionId).toContain("mock-not-approved");
  });
});

// ---------------------------------------------------------------------------
// Adapter: real contract
// ---------------------------------------------------------------------------

describe("HappyRobot adapter: run trigger contract", () => {
  it("maps call -> dispatch and sms -> public-alert, falling back to the generic workflow", () => {
    expect(workflowIdForAction(makeAction({ channel: "call" }))).toEqual({
      kind: "dispatch",
      id: "wf-dispatch",
    });
    expect(workflowIdForAction(makeAction({ channel: "sms" }))).toEqual({
      kind: "public-alert",
      id: "wf-alert",
    });
    process.env.HAPPYROBOT_WORKFLOW_ID = "wf-generic";
    expect(workflowIdForAction(makeAction({ channel: "email" }))).toEqual({
      kind: "generic",
      id: "wf-generic",
    });
    expect(runEndpoint("wf-dispatch")).toBe(`${BASE}/workflows/wf-dispatch/runs`);
  });

  it("triggers the dispatch workflow with the FARO trigger params and keeps the run id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run_id: "run-123" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(makeAction(), makeContact(), {
      zone: getSituation().zones[0],
      plan: getSituation().plan,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/workflows/wf-dispatch/runs`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk_test_unit");
    expect(headers["idempotency-key"]).toBe("act-test-1:1");
    const body = JSON.parse(String(init.body)) as {
      environment: string;
      payload: Record<string, unknown>;
    };
    expect(body.environment).toBe("development");
    expect(body.payload.action_id).toBe("act-test-1");
    expect(body.payload.dispatch_id).toBe("act-test-1:1");
    expect(body.payload.resource_phone).toBe("+34600000000");
    expect(body.payload.mission_summary).toBe("Confirm deployment to the north sector");
    expect(body.payload.mission_requested_eta).toBe("");

    expect(result.mode).toBe("happyrobot");
    expect(result.simulated).toBe(false);
    expect(result.externalActionId).toBe("run-123");
    expect(result.workflow).toBe("dispatch");
  });

  it("builds the public alert request with FARO's approval and a single explicit recipient", () => {
    const action = makeAction({ channel: "sms", approvedBy: "operator" });
    const { payload, environment } = buildRunBody("public-alert", action, makeContact(), {
      zone: getSituation().zones[0],
    });
    expect(environment).toBe("development");
    expect(payload.approval_status).toBe("approved");
    expect(payload.approval_approved_by).toBe("operator");
    expect(payload.recipients).toEqual([{ recipient_id: "con-demo", phone: "+34600000000" }]);
    expect(typeof payload.message).toBe("string");
    expect(payload.audience_label).toBe(getSituation().zones[0]!.name);

    const pending = buildRunBody(
      "public-alert",
      makeAction({ channel: "sms", approvedBy: undefined }),
      makeContact(),
    );
    expect(pending.payload.approval_status).toBe("pending");
  });

  it("honours HAPPYROBOT_ENVIRONMENT", async () => {
    process.env.HAPPYROBOT_ENVIRONMENT = "staging";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run_id: "run-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await executeHappyRobotAction(makeAction(), makeContact(), {});
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.environment).toBe("staging");
  });

  it("does not retry a 4xx and classifies it as client error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "workflow not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeHappyRobotAction(makeAction(), makeContact(), {})).rejects.toMatchObject({
      kind: "client-error",
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds on the next attempt with the same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ run_id: "run-2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(makeAction(), makeContact(), {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(keys[0]!["idempotency-key"]).toBe(keys[1]!["idempotency-key"]);
    expect(result.externalActionId).toBe("run-2");
  });

  it("rejects an unreadable 2xx body without inventing a run id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(executeHappyRobotAction(makeAction(), makeContact(), {})).rejects.toBeInstanceOf(
      HappyRobotError,
    );
  });
});

// ---------------------------------------------------------------------------
// Webhook: callbacks from the FARO workflows
// ---------------------------------------------------------------------------

function post(body: unknown, headers: Record<string, string> = { "x-happyrobot-secret": SECRET }) {
  return webhookPost(
    new Request("http://localhost/api/webhooks/happyrobot", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** A running action with a contact and a resource, as approveAction leaves it. */
function runningAction() {
  const situation = getSituation();
  const zone = situation.zones[0]!;
  const contact = situation.contacts[0]!;
  const resource = situation.resources.find((candidate) => candidate.status === "available")!;
  const created = createAction({
    channel: "call",
    target: resource.name,
    objective: "Confirm deployment",
    reason: "Test",
    zoneId: zone.id,
    contactId: contact.id,
    resourceId: resource.id,
  });
  const action = "action" in created ? (created as { action: Action }).action : (created as Action);
  setActionStatus(action.id, "running", "run-abc", undefined, "happyrobot");
  return { action, resource, zone };
}

describe("HappyRobot webhook: security", () => {
  it("is closed when no secret is configured", async () => {
    delete process.env.HAPPYROBOT_WEBHOOK_SECRET;
    const response = await post({ status: "completed" }, {});
    expect(response.status).toBe(503);
  });

  it("rejects a wrong secret", async () => {
    const response = await post({ status: "completed" }, { "x-happyrobot-secret": "nope" });
    expect(response.status).toBe(401);
  });

  it("rejects a body that is neither a result nor a generic callback", async () => {
    const response = await post({ hello: "world" });
    expect(response.status).toBe(400);
  });
});

describe("HappyRobot webhook: dispatch_result", () => {
  it("closes the action when the responder accepts", async () => {
    const { action } = runningAction();
    const response = await post({
      dispatch_result: {
        action_id: action.id,
        dispatch_status: "accepted",
        eta_minutes: 12,
        native_interaction_id: "run-abc",
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe("dispatch");
    expect(body.action.status).toBe("succeeded");
    expect(body.summary).toContain("ETA 12 min");
  });

  it("blocks the action and marks the resource unavailable when the responder cannot", async () => {
    const { action, resource } = runningAction();
    const response = await post({
      dispatch_result_json: JSON.stringify({
        action_id: action.id,
        resource_id: resource.id,
        dispatch_status: "unavailable",
        rejection_reason: "attending another incident",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action.status).toBe("blocked");
    expect(body.action.error).toContain("attending another incident");
    expect(body.resource.status).toBe("unavailable");
    expect(getSituation().resources.find((candidate) => candidate.id === resource.id)!.status).toBe(
      "unavailable",
    );
  });

  it("turns responder statements into a new signal and fails on no_answer", async () => {
    const { action } = runningAction();
    const before = getSituation().events.length;
    const response = await post({
      dispatch_result: {
        action_id: action.id,
        dispatch_status: "no_answer",
        responder_statement: null,
        claims: [],
      },
    });
    expect((await response.json()).action.status).toBe("failed");
    expect(getSituation().events.length).toBe(before);

    const second = runningAction();
    const withInfo = await post({
      dispatch_result: {
        action_id: second.action.id,
        dispatch_status: "accepted_with_constraint",
        constraint_description: "one vehicle only",
        responder_statement: "The A-397 is cut at km 12",
      },
    });
    const body = await withInfo.json();
    expect(body.action.status).toBe("succeeded");
    expect(body.ingestedEventIds).toHaveLength(1);
    expect(getSituation().events[0]!.description).toContain("A-397");
  });
});

describe("HappyRobot webhook: public_alert_result", () => {
  it("maps completed to succeeded and partial to blocked with the failure count", async () => {
    const { action } = runningAction();
    const done = await post({
      public_alert_result: {
        action_id: action.id,
        alert_status: "completed",
        recipient_count: 2,
        sent_count: 2,
        failed_count: 0,
        audience_label: "North sector",
      },
    });
    expect((await done.json()).action.status).toBe("succeeded");

    const second = runningAction();
    const partial = await post({
      public_alert_result_json: JSON.stringify({
        action_id: second.action.id,
        alert_status: "partial",
        recipient_count: 3,
        sent_count: 1,
        failed_count: 2,
      }),
    });
    const body = await partial.json();
    expect(body.kind).toBe("public-alert");
    expect(body.action.status).toBe("blocked");
    expect(body.action.error).toContain("2 of 3");
  });

  it("flags not_approved as a gate refusal", async () => {
    const { action } = runningAction();
    const response = await post({
      public_alert_result: { action_id: action.id, alert_status: "not_approved" },
    });
    const body = await response.json();
    expect(body.action.status).toBe("blocked");
    expect(body.action.error).toMatch(/approval_status/);
  });
});

describe("HappyRobot webhook: generic shape and idempotency", () => {
  it("keeps accepting the generic callback with new information", async () => {
    const { action, zone } = runningAction();
    const response = await post({
      localActionId: action.id,
      status: "completed",
      summary: "Coordinator confirmed",
      newInformation: [
        { type: "road_blocked", zoneId: zone.id, description: "MA-8301 blocked at km 12" },
      ],
    });
    const body = await response.json();
    expect(body.kind).toBe("generic");
    expect(body.action.status).toBe("succeeded");
    expect(body.ingestedEventIds).toHaveLength(1);
  });

  it("replays the same delivery without touching state again", async () => {
    const { action } = runningAction();
    const payload = { dispatch_result: { action_id: action.id, dispatch_status: "accepted" } };
    const first = await post(payload, {
      "x-happyrobot-secret": SECRET,
      "x-happyrobot-delivery-id": "d1",
    });
    const events = getSituation().events.length;
    const second = await post(payload, {
      "x-happyrobot-secret": SECRET,
      "x-happyrobot-delivery-id": "d1",
    });
    expect(first.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
    expect(getSituation().events.length).toBe(events);
  });
});
