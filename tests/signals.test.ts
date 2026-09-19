// OWNER: HappyRobot inbound Signal vertical slice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { handleSignalPost } from "@/app/api/signals/route";
import { GET as getSituationRoute } from "@/app/api/situation/route";
import { GET as getTelemetryRoute } from "@/app/api/telemetry/route";
import { readTelemetry } from "@/lib/event-pipeline";
import { happyRobotExternalIdentity } from "@/lib/signals/happyrobot";
import type { HappyRobotNormalizedReport } from "@/lib/signals/happyrobot";
import type { NewSignal, PersistedSignal, SignalRepository } from "@/lib/signals/repository";
import { getSituation, resetSituation } from "@/lib/store";

const SECRET = "signal-test-secret";

function report(overrides: Partial<HappyRobotNormalizedReport> = {}): HappyRobotNormalizedReport {
  return {
    channel: "voice",
    received_at: "2026-09-19T10:00:00.000Z",
    native_interaction_id: "call-123",
    raw_message: "Huelo algo químico junto a Estepona.",
    transcript_reference: "https://example.test/transcripts/call-123",
    reporter: {
      role_description: "witness",
      is_at_scene: true,
      callback_allowed: true,
    },
    location: { description: "Estepona", precision: "approximate" },
    situation: {
      description: "A strong chemical odor is spreading near a factory.",
      incident_type_text: "chemical odor",
      trend: "worsening",
    },
    people: {
      affected_or_exposed_count: 12,
      count_description: "about twelve workers",
      immediate_danger: true,
      vulnerable_people_description: null,
    },
    access_constraints: null,
    blocked_roads: null,
    affected_infrastructure: "factory ventilation",
    emergency_units_present: null,
    claims: [
      {
        statement: "The caller directly smells a strong chemical odor.",
        provenance: "direct_observation",
        uncertainty: null,
        source_turn_reference: "turn-1",
        observed_or_reported_at: "2026-09-19T09:59:00.000Z",
      },
      {
        statement: "Another worker said two people felt dizzy.",
        provenance: "reported_by_other",
        uncertainty: "The caller did not see them.",
        source_turn_reference: "turn-2",
        observed_or_reported_at: null,
      },
    ],
    report_summary: "Chemical odor reported near an Estepona factory",
    collection_state: "sufficient",
    ...overrides,
  };
}

class MemorySignalRepository implements SignalRepository {
  readonly rows = new Map<string, PersistedSignal>();
  readonly identities = new Map<string, string>();
  createCalls = 0;

  async createOrGet(input: NewSignal) {
    this.createCalls += 1;
    const existingId = this.identities.get(input.externalIdentity);
    if (existingId) return { signal: this.rows.get(existingId)!, inserted: false };
    const signal: PersistedSignal = {
      id: input.id,
      source: "happyrobot",
      channel: input.channel,
      externalIdentity: input.externalIdentity,
      receivedAt: input.receivedAt,
      rawPayload: structuredClone(input.rawPayload),
      processingStatus: "received",
      eventId: null,
      createdAt: "2026-09-19T10:00:01.000Z",
      processedAt: null,
      processingError: null,
    };
    this.rows.set(signal.id, signal);
    this.identities.set(signal.externalIdentity, signal.id);
    return { signal, inserted: true };
  }

  async claimForProcessing(id: string) {
    const signal = this.rows.get(id);
    if (!signal || !["received", "failed"].includes(signal.processingStatus)) return null;
    signal.processingStatus = "processing";
    signal.processingError = null;
    return signal;
  }

  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async markProcessed(id: string, eventId: string) {
    const signal = this.rows.get(id)!;
    signal.processingStatus = "processed";
    signal.eventId = eventId;
    signal.processedAt = "2026-09-19T10:00:02.000Z";
    signal.processingError = null;
  }

  async markFailed(id: string, error: string) {
    const signal = this.rows.get(id)!;
    signal.processingStatus = "failed";
    signal.processingError = error;
    signal.processedAt = "2026-09-19T10:00:02.000Z";
  }
}

function request(payload: unknown, secret = SECRET) {
  return new Request("http://localhost/api/signals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-happyrobot-secret": secret },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.HAPPYROBOT_WEBHOOK_SECRET = SECRET;
  process.env.ACTION_EXECUTION_MODE = "mock";
  globalThis.eventPipelineState = undefined;
  resetSituation();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HappyRobot Signal intake", () => {
  it("persists a valid Voice report, derives an Event, and enters the existing pipeline", async () => {
    const repository = new MemorySignalRepository();
    const before = getSituation();
    const response = await handleSignalPost(
      request(report({ blocked_roads: "A-7 reported blocked near the factory" })),
      { repository },
    );
    const body = await response.json();
    const after = getSituation();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ duplicate: false, status: "processed" });
    expect(repository.rows.size).toBe(1);
    expect(repository.rows.get(body.signalId)).toMatchObject({
      processingStatus: "processed",
      eventId: body.eventId,
    });
    expect(after.events.some((event) => event.id === body.eventId)).toBe(true);
    expect(after.plan.version).toBeGreaterThan(before.plan.version);
    expect(after.actions.length).toBeGreaterThan(before.actions.length);
    expect(
      after.digitalTwin.facts.some((fact) => fact.evidenceEventIds.includes(body.eventId)),
    ).toBe(true);
    const dashboardState = await (await getSituationRoute()).json();
    expect(dashboardState.events.some((event: { id: string }) => event.id === body.eventId)).toBe(
      true,
    );
    expect(readTelemetry().records).toEqual([
      expect.objectContaining({
        eventId: body.eventId,
        type: "event.accepted",
        payload: expect.objectContaining({ source: "happyrobot" }),
      }),
    ]);
    const telemetryResponse = await getTelemetryRoute(
      new Request("http://localhost/api/telemetry"),
    );
    const telemetryReader = telemetryResponse.body!.getReader();
    await telemetryReader.read(); // retry directive
    const telemetryFrame = new TextDecoder().decode((await telemetryReader.read()).value);
    expect(telemetryFrame).toContain('"type":"event.accepted"');
    expect(telemetryFrame).toContain(body.eventId);
    await telemetryReader.cancel();
  });

  it("returns the original references and creates no second Event for duplicate delivery", async () => {
    const repository = new MemorySignalRepository();
    const first = await handleSignalPost(request(report()), { repository });
    const firstBody = await first.json();
    const eventCount = getSituation().events.length;
    const second = await handleSignalPost(request(report()), { repository });

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      signalId: firstBody.signalId,
      eventId: firstBody.eventId,
      duplicate: true,
      status: "already_processed",
    });
    expect(repository.rows.size).toBe(1);
    expect(getSituation().events.length).toBe(eventCount);
    expect(readTelemetry().records).toHaveLength(1);
  });

  it("scopes native interaction identity by channel", async () => {
    const repository = new MemorySignalRepository();
    await handleSignalPost(request(report()), { repository });
    await handleSignalPost(request(report({ channel: "sms" })), { repository });

    expect(repository.rows.size).toBe(2);
    expect([...repository.rows.values()].map((row) => row.externalIdentity).sort()).toEqual([
      "happyrobot:sms:call-123",
      "happyrobot:voice:call-123",
    ]);
  });

  it("builds a deterministic fallback identity when native_interaction_id is null", () => {
    const payload = report({ native_interaction_id: null });
    const reordered = { ...payload, channel: payload.channel };
    expect(happyRobotExternalIdentity(payload)).toBe(happyRobotExternalIdentity(reordered));
    expect(happyRobotExternalIdentity(payload)).toMatch(/^happyrobot:voice:payload:[a-f0-9]{64}$/);
  });

  it("accepts a partial report with nullable optional information", async () => {
    const repository = new MemorySignalRepository();
    const partial = report({
      received_at: null,
      native_interaction_id: null,
      raw_message: null,
      transcript_reference: null,
      reporter: { role_description: null, is_at_scene: null, callback_allowed: null },
      location: { description: null, precision: "unknown" },
      situation: {
        description: null,
        incident_type_text: null,
        trend: "unknown",
      },
      people: {
        affected_or_exposed_count: null,
        count_description: null,
        immediate_danger: null,
        vulnerable_people_description: null,
      },
      claims: [],
      collection_state: "partial",
    });
    const response = await handleSignalPost(request(partial), { repository });
    expect(response.status).toBe(201);
  });

  it("preserves direct and hearsay claims exactly inside raw_payload", async () => {
    const repository = new MemorySignalRepository();
    const payload = report();
    await handleSignalPost(request(payload), { repository });
    expect([...repository.rows.values()][0]!.rawPayload.claims).toEqual(payload.claims);
  });

  it("rejects caller-supplied severity and confidence before creating a Signal or Event", async () => {
    const repository = new MemorySignalRepository();
    const before = getSituation().events.length;
    const response = await handleSignalPost(
      request({ ...report(), severity: "critical", confidence: "high" }),
      { repository },
    );
    expect(response.status).toBe(400);
    expect(repository.createCalls).toBe(0);
    expect(getSituation().events.length).toBe(before);
  });

  it("derives severity and confidence inside FARO", async () => {
    const repository = new MemorySignalRepository();
    const response = await handleSignalPost(request(report()), { repository });
    const body = await response.json();
    const event = getSituation().events.find((candidate) => candidate.id === body.eventId);
    expect(event).toMatchObject({ severity: "critical", confidence: "high" });
  });

  it("retains the raw Signal and records failure when interpretation fails", async () => {
    const repository = new MemorySignalRepository();
    const payload = report();
    const response = await handleSignalPost(request(payload), {
      repository,
      process: () => {
        throw new Error("deliberate interpretation failure");
      },
    });
    const body = await response.json();
    const signal = repository.rows.get(body.signalId)!;

    expect(response.status).toBe(500);
    expect(body.status).toBe("processing_failed");
    expect(signal.processingStatus).toBe("failed");
    expect(signal.processingError).toBe("deliberate interpretation failure");
    expect(signal.rawPayload).toEqual(payload);
    expect(readTelemetry().records).toEqual([]);
  });

  it("rejects invalid authentication", async () => {
    const repository = new MemorySignalRepository();
    const response = await handleSignalPost(request(report(), "wrong-secret"), { repository });
    expect(response.status).toBe(401);
    expect(repository.createCalls).toBe(0);
  });

  it("rejects an invalid payload without creating an Event", async () => {
    const repository = new MemorySignalRepository();
    const before = getSituation().events.length;
    const response = await handleSignalPost(request({ channel: "voice" }), { repository });
    expect(response.status).toBe(400);
    expect(repository.createCalls).toBe(0);
    expect(getSituation().events.length).toBe(before);
  });
});
