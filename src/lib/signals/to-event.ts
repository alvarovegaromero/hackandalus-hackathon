import { createHash } from "node:crypto";
import type { NormalizedReport } from "@/lib/report";
import type { CrisisEvent } from "../domain";
import { channelLabels, type Signal } from "./schema";

// Deterministic UUID (version 8) so a resent signal keeps its id and is deduplicated.
function stableUuid(...parts: string[]) {
  const h = createHash("sha256").update(parts.join("\0")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function signalText({ body }: Signal) {
  return body.type === "text"
    ? body.text
    : `${body.metric}: ${body.value}${body.unit ? ` ${body.unit}` : ""}`;
}

// The report is the shared triage contract; the signal travels beside it as the original
// evidence, keeping structured readings and accuracyM that the text envelope cannot carry.
export type ScenarioReport = { report: NormalizedReport; evidence: Signal };

export function signalToReport(
  runId: string,
  signal: Signal,
  receivedAt = new Date(),
): ScenarioReport {
  const { lat, lon, placeName } = signal.location;
  return {
    report: {
      id: stableUuid(runId, signal.id),
      runId,
      source: "scenario",
      channel: signal.channel,
      externalRef: signal.id,
      receivedAt: receivedAt.toISOString(),
      // receivedAtMin is simulation-relative, so no occurredAt; the producer does not say
      // whether its location is the reporter or the incident, so it stays unknown.
      text: signalText(signal),
      location: { latitude: lat, longitude: lon, description: placeName, reference: "unknown" },
      extracted: {},
    },
    evidence: signal,
  };
}

// Legacy CrisisEvent for /api/scenario/signals until the workflow consumer migrates to
// NormalizedReport. Same id as signalToReport, so deduplication survives the migration.
export function signalToEvent(incidentId: string, signal: Signal): CrisisEvent {
  return {
    id: stableUuid(incidentId, signal.id),
    incidentId,
    summary:
      `${channelLabels[signal.channel]} · ${signal.location.placeName}: ${signalText(signal)}`.slice(
        0,
        2000,
      ),
    // ponytail: signals carry no severity; the agent triages. Derive one when FARO's triage lands.
    severity: "medium",
    source: signal.channel === "sensor" ? "sensor" : "webhook",
  };
}
