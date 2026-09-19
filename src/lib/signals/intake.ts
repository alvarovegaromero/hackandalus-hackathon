// OWNER: triage input contract (docs/input-contract.md).
//
// Intake of raw reports for `POST /api/signals`. Two producers share it:
//   - the public report form ({ text, location? }), and
//   - the HappyRobot "Inbound Reporter" workflows (voice/SMS/WhatsApp), which
//     post the `normalized_report` object built by their last code node.
// Both become the shared `NormalizedReport` envelope and a command-center
// event. Intake does not triage: it never invents severity from thin air; the
// two deterministic defaults below are labelled as intake rules.

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeCategory } from "@/lib/contacts";
import { normalizedReportSchema, reportLocationSchema, type NormalizedReport } from "@/lib/report";
import type { CrisisZone, IncomingEventPayload } from "@/lib/types";

/** One in-memory crisis: the run id is fixed until Supabase persistence lands. */
export const DEMO_RUN_ID = "00000000-0000-4000-8000-000000000001";
export const MAX_SIGNALS_PER_BATCH = 50;

// ---------------------------------------------------------------------------
// Producer schemas
// ---------------------------------------------------------------------------

/** Public form: only the text is required. Unknown fields are rejected. */
export const publicReportSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  location: reportLocationSchema.optional(),
});

const optionalText = z.string().trim().max(4000).nullish();
const optionalBool = z.boolean().nullish();
const optionalInt = z.number().int().nullish();

/** `normalized_report` as emitted by the FARO Inbound Reporter workflows. Extra keys are ignored. */
export const happyRobotReportSchema = z.object({
  channel: z.string().trim().min(1),
  received_at: optionalText,
  native_interaction_id: optionalText,
  raw_message: optionalText,
  transcript_reference: optionalText,
  reporter: z
    .object({
      role_description: optionalText,
      is_at_scene: optionalBool,
      callback_allowed: optionalBool,
    })
    .partial()
    .nullish(),
  location: z
    .object({
      description: optionalText,
      precision: z.enum(["exact", "approximate", "unknown"]).nullish(),
    })
    .partial()
    .nullish(),
  situation: z
    .object({
      description: optionalText,
      incident_type_text: optionalText,
      trend: z.enum(["worsening", "stable", "improving", "unknown"]).nullish(),
    })
    .partial()
    .nullish(),
  people: z
    .object({
      affected_or_exposed_count: optionalInt,
      count_description: optionalText,
      immediate_danger: optionalBool,
      vulnerable_people_description: optionalText,
    })
    .partial()
    .nullish(),
  access_constraints: optionalText,
  blocked_roads: optionalText,
  affected_infrastructure: optionalText,
  emergency_units_present: optionalText,
  claims: z
    .array(
      z.object({
        statement: z.string().trim().min(1),
        provenance: z.string().nullish(),
        uncertainty: optionalText,
        source_turn_reference: optionalText,
        observed_or_reported_at: optionalText,
      }),
    )
    .nullish(),
  report_summary: optionalText,
  collection_state: z.enum(["sufficient", "partial"]).nullish(),
});

export type HappyRobotReport = z.infer<typeof happyRobotReportSchema>;
export type PublicReport = z.infer<typeof publicReportSchema>;

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

/** A report, an array of reports, or { signals: [...] }. */
export function unwrapSignalsBody(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.signals)) return record.signals;
  return [body];
}

/** The workflow may post the object or its `_json` string variable. */
function unwrapHappyRobotItem(item: Record<string, unknown>): unknown {
  if (item.normalized_report && typeof item.normalized_report === "object") {
    return item.normalized_report;
  }
  if (typeof item.normalized_report_json === "string") {
    try {
      return JSON.parse(item.normalized_report_json);
    } catch {
      return item.normalized_report_json;
    }
  }
  return item;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface IntakeContext {
  runId?: string;
  receivedAt?: Date;
  /** Trusted producer, resolved from authentication, never from the body. */
  source: "public" | "happyrobot";
  zones: CrisisZone[];
}

export interface IntakeIssue {
  campo: string;
  mensaje: string;
}

export type IntakeOutcome =
  | { ok: true; report: NormalizedReport; event: IncomingEventPayload; raw: unknown }
  | { ok: false; issues: IntakeIssue[] };

/** Deterministic UUID (version 8) so a resent report keeps its id and is deduplicated. */
export function stableReportId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\0")).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function issuesFrom(error: z.ZodError): IntakeIssue[] {
  return error.issues.map((issue) => ({
    campo: issue.path.length ? issue.path.join(".") : "(body)",
    mensaje: issue.message,
  }));
}

/**
 * Candidate zone by name mention. A match is a hint for the operator, not a
 * confirmed incident location: the event enters unconfirmed.
 */
export function matchZone(text: string, zones: CrisisZone[]): CrisisZone | null {
  const haystack = text.toLowerCase();
  for (const zone of zones) {
    const name = zone.name.toLowerCase();
    if (haystack.includes(name)) return zone;
    const tokens = name.split(/[\s,]+/).filter((token) => token.length >= 5 && token !== "sierra");
    if (tokens.some((token) => haystack.includes(token))) return zone;
  }
  return null;
}

function reportText(report: HappyRobotReport): string | null {
  const summary = report.report_summary?.trim();
  if (summary) return summary;
  const situation = report.situation?.description?.trim();
  if (situation) return situation;
  const claims = (report.claims ?? []).map((claim) => claim.statement.trim()).filter(Boolean);
  if (claims.length) return claims.join(" ");
  const raw = report.raw_message?.trim();
  return raw || null;
}

function toIso(value: string | null | undefined, fallback: Date): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

function fromHappyRobot(report: HappyRobotReport, ctx: IntakeContext, raw: unknown): IntakeOutcome {
  const text = reportText(report);
  if (!text) {
    return {
      ok: false,
      issues: [
        {
          campo: "report_summary",
          mensaje: "Report carries no usable text (summary, situation, claims or raw message).",
        },
      ],
    };
  }
  const receivedAt = ctx.receivedAt ?? new Date();
  const runId = ctx.runId ?? DEMO_RUN_ID;
  const externalRef = report.native_interaction_id ?? undefined;
  const locationDescription = report.location?.description ?? undefined;
  const category = report.situation?.incident_type_text
    ? normalizeCategory(report.situation.incident_type_text)
    : undefined;
  const immediateDanger = report.people?.immediate_danger ?? undefined;
  const exposed = report.people?.affected_or_exposed_count ?? undefined;
  const peoplePresent =
    immediateDanger === true || (exposed !== undefined && exposed !== null && exposed > 0)
      ? true
      : immediateDanger === false && (exposed === 0 || exposed === undefined || exposed === null)
        ? false
        : undefined;

  const envelope: NormalizedReport = {
    id: externalRef
      ? stableReportId(runId, "happyrobot", report.channel, externalRef)
      : randomUUID(),
    runId,
    source: "happyrobot",
    channel: report.channel,
    ...(externalRef ? { externalRef } : {}),
    receivedAt: receivedAt.toISOString(),
    ...(report.received_at ? { occurredAt: toIso(report.received_at, receivedAt) } : {}),
    text: text.slice(0, 4000),
    ...(locationDescription
      ? { location: { description: locationDescription.slice(0, 500), reference: "unknown" } }
      : {}),
    extracted: {
      ...(category ? { category } : {}),
      ...(peoplePresent !== undefined ? { peopleReportedPresent: peoplePresent } : {}),
    },
  };
  const validated = normalizedReportSchema.safeParse(envelope);
  if (!validated.success) return { ok: false, issues: issuesFrom(validated.error) };

  const zone = matchZone(`${text} ${locationDescription ?? ""}`, ctx.zones);
  const details = [
    locationDescription ? `Location: ${locationDescription}` : null,
    report.people?.count_description ? `People: ${report.people.count_description}` : null,
    immediateDanger === true ? "People in immediate danger reported." : null,
    report.people?.vulnerable_people_description
      ? `Vulnerable: ${report.people.vulnerable_people_description}`
      : null,
    report.blocked_roads ? `Blocked roads: ${report.blocked_roads}` : null,
    report.access_constraints ? `Access: ${report.access_constraints}` : null,
    report.affected_infrastructure ? `Infrastructure: ${report.affected_infrastructure}` : null,
    report.emergency_units_present ? `Units on site: ${report.emergency_units_present}` : null,
    report.reporter?.role_description ? `Reporter: ${report.reporter.role_description}` : null,
    report.reporter?.is_at_scene === true
      ? "Reporter is at the scene."
      : report.reporter?.is_at_scene === false
        ? "Reporter is not at the scene."
        : null,
    report.collection_state === "partial" ? "Collection state: partial." : null,
  ].filter(Boolean);

  const event: IncomingEventPayload = {
    source: "happyrobot",
    title: `Citizen report (${report.channel}): ${report.situation?.incident_type_text ?? "unclassified"}`,
    description: [text, ...details].join("\n"),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(category ? { category } : {}),
    // Intake rule, not triage: a report of people in immediate danger is never filed as routine.
    ...(immediateDanger === true ? { severity: "high" as const } : {}),
    // Intake rule: a reporter at the scene is more reliable than hearsay; unknown stays medium.
    confidence:
      report.reporter?.is_at_scene === true
        ? "high"
        : report.reporter?.is_at_scene === false
          ? "low"
          : "medium",
    confirmed: null,
  };
  return { ok: true, report: validated.data, event, raw };
}

function fromPublic(report: PublicReport, ctx: IntakeContext, raw: unknown): IntakeOutcome {
  const receivedAt = ctx.receivedAt ?? new Date();
  const envelope: NormalizedReport = {
    id: randomUUID(),
    runId: ctx.runId ?? DEMO_RUN_ID,
    source: "public",
    receivedAt: receivedAt.toISOString(),
    text: report.text,
    ...(report.location ? { location: report.location } : {}),
    extracted: {},
  };
  const validated = normalizedReportSchema.safeParse(envelope);
  if (!validated.success) return { ok: false, issues: issuesFrom(validated.error) };

  const zone = matchZone(`${report.text} ${report.location?.description ?? ""}`, ctx.zones);
  const location = report.location
    ? report.location.description
      ? `Location (${report.location.reference}): ${report.location.description}`
      : `Location (${report.location.reference}): ${report.location.latitude}, ${report.location.longitude}`
    : null;
  const event: IncomingEventPayload = {
    source: "public",
    title: "Public report",
    description: [report.text, location].filter(Boolean).join("\n"),
    ...(zone ? { zoneId: zone.id } : {}),
    confidence: "medium",
    confirmed: null,
  };
  return { ok: true, report: validated.data, event, raw };
}

/** Normalizes one raw item from the trusted producer named in the context. */
export function intakeSignal(item: unknown, ctx: IntakeContext): IntakeOutcome {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return {
      ok: false,
      issues: [{ campo: "(item)", mensaje: "Each signal must be a JSON object." }],
    };
  }
  if (ctx.source === "happyrobot") {
    const unwrapped = unwrapHappyRobotItem(item as Record<string, unknown>);
    const parsed = happyRobotReportSchema.safeParse(unwrapped);
    if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
    return fromHappyRobot(parsed.data, ctx, unwrapped);
  }
  const parsed = publicReportSchema.safeParse(item);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
  return fromPublic(parsed.data, ctx, item);
}
