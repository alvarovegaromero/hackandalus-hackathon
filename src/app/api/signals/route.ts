// OWNER: triage input contract (docs/input-contract.md).
// Report intake: `POST /api/signals`.
//
// Producers: the public report form (Bearer CRISIS_API_TOKEN, open in local
// development like /api/events) and the HappyRobot Inbound Reporter workflows
// (shared secret in `x-happyrobot-secret`). The producer is resolved from the
// credential, never from the body, so a public caller cannot impersonate
// HappyRobot. Reports become the shared NormalizedReport envelope and are
// projected into the in-memory command center; `storage: "memory"` labels
// that this acknowledgement is not durable.

import { MAX_BODY_BYTES, apiError, apiOk, methodNotAllowed } from "@/lib/validation";
import { WEBHOOK_SECRET_HEADER, verifyWebhookSecret } from "@/lib/happyrobot";
import { authorizePipeline } from "@/lib/pipeline-auth";
import {
  DEMO_RUN_ID,
  MAX_SIGNALS_PER_BATCH,
  intakeSignal,
  unwrapSignalsBody,
  type IntakeContext,
  type IntakeIssue,
} from "@/lib/signals/intake";
import { addEvent, getSituation } from "@/lib/store";
import type { NormalizedReport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Dedup of transport retries (same report id within a window)
// ---------------------------------------------------------------------------

interface IntakeRecord {
  at: number;
  eventId: string;
  occurrences: number;
  report: NormalizedReport;
  raw: unknown;
}

declare global {
  var faroSignalIntake: Map<string, IntakeRecord> | undefined;
}

const INTAKE_TTL_MS = 15 * 60 * 1000;
const INTAKE_MAX = 1000;

function registry(): Map<string, IntakeRecord> {
  globalThis.faroSignalIntake ??= new Map<string, IntakeRecord>();
  return globalThis.faroSignalIntake;
}

function remember(record: IntakeRecord) {
  const store = registry();
  store.set(record.report.id, record);
  const limit = Date.now() - INTAKE_TTL_MS;
  for (const [id, entry] of store) if (entry.at < limit) store.delete(id);
  while (store.size > INTAKE_MAX) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

/** Original payload kept beside the envelope for traceability (in memory). */
export function recordedSignal(id: string): IntakeRecord | undefined {
  return registry().get(id);
}

// ---------------------------------------------------------------------------
// Authentication -> trusted producer
// ---------------------------------------------------------------------------

function resolveProducer(request: Request): { source: IntakeContext["source"] } | Response {
  if (request.headers.has(WEBHOOK_SECRET_HEADER)) {
    const verification = verifyWebhookSecret(request);
    if (!verification.ok) {
      return apiError("no_autorizado", verification.reason ?? "Callback rejected.", 401);
    }
    return { source: "happyrobot" };
  }
  const denied = authorizePipeline(request);
  if (denied) return denied;
  return { source: "public" };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

interface Accepted {
  index: number;
  id: string;
  eventId: string;
}
interface Merged {
  index: number;
  id: string;
  eventId: string;
  occurrences: number;
}
interface Rejected {
  index: number;
  issues: IntakeIssue[];
}

export async function POST(request: Request) {
  const producer = resolveProducer(request);
  if (producer instanceof Response) return producer;

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return apiError("cuerpo_invalido", "Could not read request body.", 400);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES * 4) {
    return apiError("cuerpo_demasiado_grande", "Body exceeds the maximum allowed size.", 413);
  }
  if (raw.trim() === "") {
    return apiError("cuerpo_vacio", "Missing request body: expected a report or a batch.", 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError("json_invalido", "Body is not valid JSON.", 400);
  }
  const items = unwrapSignalsBody(body);
  if (!items)
    return apiError(
      "cuerpo_invalido",
      "Body must be a report, an array, or { signals: [...] }.",
      400,
    );
  if (items.length === 0) return apiError("cuerpo_vacio", "The batch contains no reports.", 400);
  if (items.length > MAX_SIGNALS_PER_BATCH) {
    return apiError(
      "cuerpo_demasiado_grande",
      `A batch may carry at most ${MAX_SIGNALS_PER_BATCH} reports.`,
      413,
    );
  }

  const receivedAt = new Date();
  const ctx: IntakeContext = {
    runId: DEMO_RUN_ID,
    receivedAt,
    source: producer.source,
    zones: getSituation().zones,
  };
  const actor = producer.source === "happyrobot" ? "happyrobot" : "system";

  const accepted: Accepted[] = [];
  const merged: Merged[] = [];
  const rejected: Rejected[] = [];

  items.forEach((item, index) => {
    const outcome = intakeSignal(item, ctx);
    if (!outcome.ok) {
      rejected.push({ index, issues: outcome.issues });
      return;
    }
    const seen = registry().get(outcome.report.id);
    if (seen && Date.now() - seen.at < INTAKE_TTL_MS) {
      seen.occurrences += 1;
      merged.push({
        index,
        id: seen.report.id,
        eventId: seen.eventId,
        occurrences: seen.occurrences,
      });
      return;
    }
    const result = addEvent(outcome.event, actor);
    remember({
      at: receivedAt.getTime(),
      eventId: result.event.id,
      occurrences: 1,
      report: outcome.report,
      raw: outcome.raw,
    });
    if (result.duplicate) {
      merged.push({
        index,
        id: outcome.report.id,
        eventId: result.event.id,
        occurrences: result.event.occurrences,
      });
    } else {
      accepted.push({ index, id: outcome.report.id, eventId: result.event.id });
    }
  });

  const status = accepted.length > 0 ? 202 : merged.length > 0 ? 200 : 400;
  return apiOk(
    {
      runId: ctx.runId,
      source: producer.source,
      storage: "memory" as const,
      accepted,
      merged,
      rejected,
      errors: [] as never[],
    },
    status,
  );
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
