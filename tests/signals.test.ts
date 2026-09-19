// OWNER: triage input contract (docs/input-contract.md).
// POST /api/signals: public reports and HappyRobot normalized reports.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as signalsPost } from "@/app/api/signals/route";
import { intakeSignal, matchZone } from "@/lib/signals/intake";
import { getSituation, resetSituation } from "@/lib/store";

const SECRET = "signals-secret";

function post(body: unknown, headers: Record<string, string> = {}) {
  return signalsPost(
    new Request("http://localhost/api/signals", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const fromHappyRobot = { "x-happyrobot-secret": SECRET };

function normalizedReport(overrides: Record<string, unknown> = {}) {
  return {
    channel: "voice",
    received_at: "2026-09-19T11:17:32.000Z",
    native_interaction_id: "session-1",
    raw_message: null,
    transcript_reference: null,
    reporter: { role_description: "neighbour", is_at_scene: true, callback_allowed: null },
    location: { description: "Los Pinares, Sierra Morena north side", precision: "approximate" },
    situation: {
      description: "Fire in the pine forest",
      incident_type_text: "incendio",
      trend: "worsening",
    },
    people: {
      affected_or_exposed_count: 6,
      count_description: "six people",
      immediate_danger: true,
      vulnerable_people_description: null,
    },
    access_constraints: null,
    blocked_roads: null,
    affected_infrastructure: null,
    emergency_units_present: null,
    claims: [{ statement: "Six people in immediate danger", provenance: "direct_observation" }],
    report_summary: "Fire in the pine forest, north side, six people in immediate danger.",
    collection_state: "sufficient",
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.CRISIS_API_TOKEN;
  process.env.HAPPYROBOT_WEBHOOK_SECRET = SECRET;
  globalThis.faroSignalIntake = undefined;
  resetSituation();
});

afterEach(() => {
  delete process.env.CRISIS_API_TOKEN;
});

describe("POST /api/signals: public reports", () => {
  it("accepts a text-only report and projects it as an unconfirmed public event", async () => {
    const response = await post({ text: "I can see smoke from my house" });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.storage).toBe("memory");
    expect(body.source).toBe("public");
    expect(body.accepted).toHaveLength(1);
    const event = getSituation().events.find(
      (candidate) => candidate.id === body.accepted[0].eventId,
    )!;
    expect(event.source).toBe("public");
    expect(event.confirmed).toBeNull();
    expect(event.description).toContain("smoke");
  });

  it("returns per-item outcomes for a mixed batch", async () => {
    const response = await post({
      signals: [
        { text: "The road is closed", location: { description: "A-397", reference: "incident" } },
        { text: "" },
        { text: "Extra", severity: "critical" },
      ],
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.accepted.map((item: { index: number }) => item.index)).toEqual([0]);
    expect(body.rejected.map((item: { index: number }) => item.index)).toEqual([1, 2]);
  });

  it("rejects oversized batches, empty bodies and non-report bodies", async () => {
    expect((await post(Array.from({ length: 51 }, () => ({ text: "x" })))).status).toBe(413);
    expect((await post("")).status).toBe(400);
    expect((await post({ signals: [] })).status).toBe(400);
    expect((await post("42")).status).toBe(400);
  });

  it("enforces the pipeline token when configured", async () => {
    process.env.CRISIS_API_TOKEN = "token";
    expect((await post({ text: "hello" })).status).toBe(401);
    expect((await post({ text: "hello" }, { authorization: "Bearer token" })).status).toBe(202);
  });
});

describe("POST /api/signals: HappyRobot normalized reports", () => {
  it("rejects a wrong shared secret", async () => {
    const response = await post(normalizedReport(), { "x-happyrobot-secret": "wrong" });
    expect(response.status).toBe(401);
  });

  it("normalizes the report, matches the zone and applies the intake severity rule", async () => {
    const response = await post({ normalized_report: normalizedReport() }, fromHappyRobot);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.source).toBe("happyrobot");
    const event = getSituation().events.find(
      (candidate) => candidate.id === body.accepted[0].eventId,
    )!;
    expect(event.source).toBe("happyrobot");
    expect(event.title).toContain("voice");
    expect(event.zoneId).toBe("zone-north");
    expect(event.severity).toBe("high");
    expect(event.confidence).toBe("high");
    expect(event.confirmed).toBeNull();
    expect(event.description).toContain("six people");
  });

  it("accepts the workflow's JSON string variable and merges transport retries", async () => {
    const first = await post(
      { normalized_report_json: JSON.stringify(normalizedReport()) },
      fromHappyRobot,
    );
    expect(first.status).toBe(202);
    const firstBody = await first.json();

    const second = await post({ normalized_report: normalizedReport() }, fromHappyRobot);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.accepted).toHaveLength(0);
    expect(secondBody.merged[0].id).toBe(firstBody.accepted[0].id);
    expect(secondBody.merged[0].occurrences).toBe(2);
  });

  it("rejects a report without any usable text", async () => {
    const response = await post(
      normalizedReport({ report_summary: null, situation: null, claims: [], raw_message: null }),
      fromHappyRobot,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.rejected[0].issues[0].campo).toBe("report_summary");
  });
});

describe("intake helpers", () => {
  it("builds a NormalizedReport envelope with a stable id per interaction", () => {
    const zones = getSituation().zones;
    const a = intakeSignal(normalizedReport(), { source: "happyrobot", zones });
    const b = intakeSignal(normalizedReport(), { source: "happyrobot", zones });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.report.id).toBe(b.report.id);
      expect(a.report.source).toBe("happyrobot");
      expect(a.report.channel).toBe("voice");
      expect(a.report.externalRef).toBe("session-1");
      expect(a.report.extracted.peopleReportedPresent).toBe(true);
      expect(a.report.location?.reference).toBe("unknown");
    }
  });

  it("matches zones by name tokens and ignores generic words", () => {
    const zones = getSituation().zones;
    expect(matchZone("smoke near sevilla", zones)?.id).toBe("zone-central");
    expect(matchZone("sierra", zones)).toBeNull();
  });
});
