import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/route";
import { GET } from "@/app/api/telemetry/route";
import { acceptIncomingEvent, readTelemetry, TELEMETRY_LIMIT } from "@/lib/event-pipeline";
import { resetSituation } from "@/lib/store";

const payload = {
  source: "demo" as const,
  title: "Prueba de humo",
  zoneId: "zone-south",
  category: "incendio",
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRISIS_API_TOKEN", "");
  vi.stubEnv("ACTION_EXECUTION_MODE", "mock");
  globalThis.eventPipelineState = undefined;
  resetSituation();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("HTTP ingestion and telemetry", () => {
  it("accepts without an SSE subscriber and replays the lifecycle later", async () => {
    const id = randomUUID();
    const response = await post({ id, ...payload });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      eventId: id,
      duplicate: false,
      status: "awaiting_filtering",
      storage: "memory",
    });
    const stream = await GET(new Request("http://localhost/api/telemetry"));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const decode = new TextDecoder();
    await reader.read(); // retry directive
    const accepted = decode.decode((await reader.read()).value);
    const pending = decode.decode((await reader.read()).value);
    expect(accepted).toContain('"type":"event.accepted"');
    expect(accepted).toContain(id);
    expect(pending).toContain('"type":"filtering.pending"');
    await reader.cancel();
  });

  it("delivers new POSTs to an already connected reader", async () => {
    vi.useFakeTimers();
    const response = await GET(new Request("http://localhost/api/telemetry"));
    const reader = response.body!.getReader();
    await reader.read();
    const waiting = reader.read();
    const id = randomUUID();
    await post({ id, ...payload });
    await vi.advanceTimersByTimeAsync(1000);
    expect(new TextDecoder().decode((await waiting).value)).toContain(id);
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("deduplicates by producer ID, rejects changed content, and accepts distinct IDs", async () => {
    const id = randomUUID();
    await post({ id, ...payload });
    expect((await post({ ...payload, id })).status).toBe(200);
    expect(readTelemetry().records).toHaveLength(2);
    expect((await post({ id, ...payload, title: "Different" })).status).toBe(409);
    expect((await post({ id: randomUUID(), ...payload })).status).toBe(202);
    expect(readTelemetry().records).toHaveLength(4);
  });

  it("rejects invalid input before emitting telemetry", async () => {
    expect((await post({ id: "bad", ...payload })).status).toBe(400);
    expect((await post({ ...payload, zoneId: "unknown" })).status).toBe(400);
    expect(readTelemetry().records).toEqual([]);
  });

  it("prioritizes Last-Event-ID over the initial query cursor", async () => {
    acceptIncomingEvent(payload);
    const first = readTelemetry().records;
    acceptIncomingEvent(payload);
    const response = await GET(
      new Request(`http://localhost/api/telemetry?after=${first[0].id}`, {
        headers: { "last-event-id": first[1].id },
      }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain(readTelemetry().records[2].id);
    expect(frame).not.toContain(first[1].id);
    await reader.cancel();
  });

  it("bounds retention and explicitly resets expired or restarted cursors", () => {
    acceptIncomingEvent(payload);
    const old = readTelemetry().records[0].id;
    for (let i = 0; i < TELEMETRY_LIMIT; i++) acceptIncomingEvent(payload);
    expect(globalThis.eventPipelineState!.records).toHaveLength(TELEMETRY_LIMIT);
    expect(readTelemetry(old).reset).toBe(true);
    globalThis.eventPipelineState = undefined;
    expect(readTelemetry(old)).toEqual({ records: [], reset: true });
  });

  it("validates cursors and stops on request abort", async () => {
    expect((await GET(new Request("http://localhost/api/telemetry?after=bad"))).status).toBe(400);
    vi.useFakeTimers();
    const abort = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/telemetry", { signal: abort.signal }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("protects both endpoints when configured and fails closed in production", async () => {
    vi.stubEnv("CRISIS_API_TOKEN", "test-only-token");
    expect((await post(payload)).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/telemetry"))).status).toBe(401);
    expect((await post(payload, { authorization: "Bearer test-only-token" })).status).toBe(202);
    vi.stubEnv("CRISIS_API_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(payload)).status).toBe(503);
  });
});
