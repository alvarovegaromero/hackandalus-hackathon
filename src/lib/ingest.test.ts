import { describe, expect, it } from "vitest";
import { crisisEventSchema, type CrisisEvent } from "./domain";
import { ingest, ingestStatus, normalizeBatch, type PersistEvents } from "./ingest";
import { createState, advance } from "./scenario/engine";
import { sierraBermeja } from "./scenario/packs/sierra-bermeja";
import { signalToEvent } from "./signals/to-event";

const incidentId = "22222222-2222-4222-8222-222222222222";
const event = (n: number): CrisisEvent => ({
  id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
  incidentId,
  summary: `Aviso ${n}`,
  severity: "high",
  source: "sensor"
});

// A fake store with the same contract as the Supabase ignore-duplicates upsert.
function memoryStore(): PersistEvents {
  const ids = new Set<string>();
  return async (events) => {
    const fresh = new Set(events.map((e) => e.id).filter((id) => !ids.has(id)));
    for (const id of fresh) ids.add(id);
    return fresh;
  };
}

function starter() {
  const started: string[] = [];
  const start = async (e: CrisisEvent) => {
    started.push(e.id);
    return `run-${e.id.slice(-2)}`;
  };
  return { started, start };
}

describe("ingest", () => {
  it("normalizes a single event, an array and { events }", () => {
    expect(normalizeBatch(event(1))).toEqual([event(1)]);
    expect(normalizeBatch([event(1)])).toEqual([event(1)]);
    expect(normalizeBatch({ events: [event(1)] })).toEqual([event(1)]);
    expect(normalizeBatch("nope")).toBeUndefined();
    expect(normalizeBatch(null)).toBeUndefined();
  });

  it("partitions a mixed batch and deduplicates within it", async () => {
    const { started, start } = starter();
    const result = await ingest([event(1), { bad: true }, event(1), event(2)], memoryStore(), start);
    expect(result.accepted.map((a) => a.index)).toEqual([0, 3]);
    expect(result.duplicates).toEqual([{ index: 2, id: event(1).id }]);
    expect(result.rejected.map((r) => r.index)).toEqual([1]);
    expect(started).toHaveLength(2);
    expect(ingestStatus(result, 4)).toBe(202);
  });

  it("starts no new run when the same events arrive again", async () => {
    const persist = memoryStore();
    const { started, start } = starter();
    await ingest([event(1), event(2)], persist, start);
    const again = await ingest([event(1), event(2)], persist, start);
    expect(again.accepted).toEqual([]);
    expect(again.duplicates).toHaveLength(2);
    expect(started).toHaveLength(2);
    expect(ingestStatus(again, 2)).toBe(200);
  });

  it("isolates a failing start from the rest of the batch", async () => {
    const start = async (e: CrisisEvent) => {
      if (e.id === event(2).id) throw new Error("workflow down");
      return "run";
    };
    const result = await ingest([event(1), event(2), event(3)], memoryStore(), start);
    expect(result.accepted.map((a) => a.index)).toEqual([0, 2]);
    expect(result.errors).toEqual([{ index: 1, id: event(2).id, error: "workflow down" }]);
  });

  it("reports every event as an error when persistence fails, and starts nothing", async () => {
    const { started, start } = starter();
    const persist: PersistEvents = async () => {
      throw new Error("db down");
    };
    const result = await ingest([event(1), event(2)], persist, start);
    expect(result.errors).toHaveLength(2);
    expect(started).toEqual([]);
    expect(ingestStatus(result, 2)).toBe(500);
  });

  it("answers 400 when every item is rejected", async () => {
    const result = await ingest([{}, { id: "x" }], memoryStore(), starter().start);
    expect(ingestStatus(result, 2)).toBe(400);
  });
});

describe("signalToEvent", () => {
  const { emitted } = advance(sierraBermeja, createState(sierraBermeja, 1), 10);

  it("turns every scenario signal into a valid crisis event", () => {
    expect(emitted.length).toBeGreaterThan(0);
    for (const { signal } of emitted) {
      const mapped = signalToEvent(incidentId, signal);
      expect(crisisEventSchema.safeParse(mapped).success).toBe(true);
      expect(mapped.summary).toContain(signal.location.placeName);
      expect(mapped.source).toBe(signal.channel === "sensor" ? "sensor" : "webhook");
    }
  });

  it("keeps ids stable per incident, so resent signals deduplicate", () => {
    const { signal } = emitted[0];
    const other = "33333333-3333-4333-8333-333333333333";
    expect(signalToEvent(incidentId, signal).id).toBe(signalToEvent(incidentId, signal).id);
    expect(signalToEvent(other, signal).id).not.toBe(signalToEvent(incidentId, signal).id);
    const ids = emitted.map(({ signal: s }) => signalToEvent(incidentId, s).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
