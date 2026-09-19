import "server-only";
import { getRun, start } from "workflow/api";
import { crisisWorkflow } from "@/workflows/crisis";
import { ingest, ingestStatus, MAX_BATCH, type PersistEvents } from "./ingest";
import { createServerSupabase } from "./supabase/server";

const supabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

// ponytail: per-process dedup when Supabase is not configured; lost on restart and not shared
// across serverless instances. Configure Supabase for durable dedup.
const memoryIds = new Set<string>();
const persistInMemory: PersistEvents = async (events) => {
  const fresh = new Set(events.map((e) => e.id).filter((id) => !memoryIds.has(id)));
  for (const id of fresh) memoryIds.add(id);
  return fresh;
};

// Idempotent insert: rows returned by the ignore-duplicates upsert are the new ones.
const persistInSupabase: PersistEvents = async (events) => {
  const db = createServerSupabase();
  const incidents = [...new Set(events.map((e) => e.incidentId))].map((id) => ({
    id,
    title: `Incidente ${id.slice(0, 8)}`
  }));
  const { error: incidentError } = await db
    .from("incidents")
    .upsert(incidents, { onConflict: "id", ignoreDuplicates: true });
  if (incidentError) throw new Error(`incidents: ${incidentError.message}`);
  const rows = events.map((e) => ({
    id: e.id,
    incident_id: e.incidentId,
    summary: e.summary,
    severity: e.severity,
    source: e.source
  }));
  const { data, error } = await db
    .from("events")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`events: ${error.message}`);
  return new Set(data.map((row: { id: string }) => row.id));
};

let warned = false;
function persistEvents(): PersistEvents {
  if (supabaseConfigured()) return persistInSupabase;
  if (!warned) console.warn("Supabase is not configured: event dedup is in memory only.");
  warned = true;
  return persistInMemory;
}

// Validates, deduplicates, persists and starts one workflow per new event.
// With `wait`, it also returns each run's result (demo use; blocks until runs finish).
export async function ingestBatch(items: unknown[] | undefined, wait = false) {
  if (!items || items.length === 0)
    return { status: 400, body: { error: "Invalid body: send one or more events." } };
  if (items.length > MAX_BATCH)
    return { status: 413, body: { error: `Batch too large: at most ${MAX_BATCH} events.` } };

  const result = await ingest(items, persistEvents(), async (event) => {
    const run = await start(crisisWorkflow, [event]);
    return run.runId;
  });
  if (!wait) return { status: ingestStatus(result, items.length), body: result };

  const accepted = await Promise.all(
    result.accepted.map(async (entry) => {
      try {
        return { ...entry, result: await getRun(entry.runId).returnValue };
      } catch (error) {
        return { ...entry, resultError: error instanceof Error ? error.message : String(error) };
      }
    })
  );
  const status = ingestStatus(result, items.length);
  return { status: status === 202 ? 200 : status, body: { ...result, accepted } };
}
