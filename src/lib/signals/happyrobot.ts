// OWNER: inbound signal contract and source adapter.

import { createHash } from "node:crypto";
import { z } from "zod";

const nullableText = (max: number) => z.string().max(max).nullable();

export const happyRobotClaimSchema = z
  .object({
    statement: z.string().min(1).max(2000),
    provenance: z.enum(["direct_observation", "reported_by_other", "unclear"]),
    uncertainty: nullableText(500),
    source_turn_reference: nullableText(200),
    observed_or_reported_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

/** Exact normalized_report contract emitted by the inbound HappyRobot workflow. */
export const happyRobotNormalizedReportSchema = z
  .object({
    channel: z.enum(["voice", "sms", "whatsapp"]),
    received_at: z.iso.datetime({ offset: true }).nullable(),
    native_interaction_id: nullableText(300),
    raw_message: nullableText(10_000),
    transcript_reference: nullableText(2000),
    reporter: z
      .object({
        role_description: nullableText(500),
        is_at_scene: z.boolean().nullable(),
        callback_allowed: z.boolean().nullable(),
      })
      .strict(),
    location: z
      .object({
        description: nullableText(1000),
        precision: z.enum(["exact", "approximate", "unknown"]),
      })
      .strict(),
    situation: z
      .object({
        description: nullableText(4000),
        incident_type_text: nullableText(500),
        trend: z.enum(["worsening", "stable", "improving", "unknown"]),
      })
      .strict(),
    people: z
      .object({
        affected_or_exposed_count: z.number().int().min(0).nullable(),
        count_description: nullableText(500),
        immediate_danger: z.boolean().nullable(),
        vulnerable_people_description: nullableText(1000),
      })
      .strict(),
    access_constraints: nullableText(2000),
    blocked_roads: nullableText(2000),
    affected_infrastructure: nullableText(2000),
    emergency_units_present: nullableText(2000),
    claims: z.array(happyRobotClaimSchema).max(100),
    report_summary: z.string().min(1).max(4000),
    collection_state: z.enum(["sufficient", "partial"]),
  })
  .strict();

export type HappyRobotNormalizedReport = z.infer<typeof happyRobotNormalizedReportSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function happyRobotExternalIdentity(report: HappyRobotNormalizedReport): string {
  if (report.native_interaction_id) {
    return `happyrobot:${report.channel}:${report.native_interaction_id}`;
  }
  const digest = createHash("sha256").update(canonicalJson(report)).digest("hex");
  return `happyrobot:${report.channel}:payload:${digest}`;
}

/** Deterministic UUIDv8, matching the repository's existing scenario identity pattern. */
export function signalIdFromExternalIdentity(externalIdentity: string): string {
  const hash = createHash("sha256").update(externalIdentity).digest("hex");
  const variant = ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
