import type { z } from "zod";
import { crisisEventSchema, type CrisisEvent } from "./domain";

// Batch ingestion (docs/input-architecture.md, Milestone A). Framework-free so it is unit-testable.
export const MAX_BATCH = 50;
export const MAX_CONCURRENT_STARTS = 10;

// Stores the events and returns the ids that were new; the rest were already ingested.
export type PersistEvents = (events: CrisisEvent[]) => Promise<Set<string>>;
// Starts the durable workflow for one event and returns its run id.
export type StartRun = (event: CrisisEvent) => Promise<string>;

export type IngestResult = {
  accepted: { index: number; id: string; runId: string }[];
  duplicates: { index: number; id: string }[];
  rejected: { index: number; issues: z.core.$ZodIssue[] }[];
  errors: { index: number; id: string; error: string }[];
};

// Accepts one event, a bare array, or { events: [...] }. Undefined means an unusable body.
export function normalizeBatch(body: unknown): unknown[] | undefined {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return undefined;
  if ("events" in body && Array.isArray(body.events)) return body.events;
  return [body];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function ingest(
  items: unknown[],
  persist: PersistEvents,
  startRun: StartRun
): Promise<IngestResult> {
  const result: IngestResult = { accepted: [], duplicates: [], rejected: [], errors: [] };
  const valid: { index: number; event: CrisisEvent }[] = [];
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const parsed = crisisEventSchema.safeParse(item);
    if (!parsed.success) result.rejected.push({ index, issues: parsed.error.issues });
    else if (seen.has(parsed.data.id)) result.duplicates.push({ index, id: parsed.data.id });
    else {
      seen.add(parsed.data.id);
      valid.push({ index, event: parsed.data });
    }
  });
  if (valid.length === 0) return result;

  let inserted: Set<string>;
  try {
    inserted = await persist(valid.map((v) => v.event));
  } catch (error) {
    for (const { index, event } of valid) result.errors.push({ index, id: event.id, error: message(error) });
    return result;
  }

  const fresh = valid.filter(({ index, event }) => {
    if (inserted.has(event.id)) return true;
    result.duplicates.push({ index, id: event.id });
    return false;
  });
  await mapLimit(fresh, MAX_CONCURRENT_STARTS, async ({ index, event }) => {
    try {
      result.accepted.push({ index, id: event.id, runId: await startRun(event) });
    } catch (error) {
      result.errors.push({ index, id: event.id, error: message(error) });
    }
  });
  for (const list of Object.values(result)) list.sort((a, b) => a.index - b.index);
  return result;
}

// Maps the outcome to an HTTP status per the ingestion contract.
export function ingestStatus(result: IngestResult, received: number): number {
  if (result.accepted.length > 0) return 202;
  if (result.rejected.length === received) return 400;
  if (result.errors.length > 0) return 500;
  return 200;
}
