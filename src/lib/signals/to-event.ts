import { createHash } from "node:crypto";
import type { CrisisEvent } from "../domain";
import { channelLabels, type Signal } from "./schema";

// Deterministic UUID (version 8) so a resent signal keeps its id and is deduplicated.
function stableUuid(...parts: string[]) {
  const h = createHash("sha256").update(parts.join("\0")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function signalToEvent(incidentId: string, signal: Signal): CrisisEvent {
  const { body } = signal;
  const content =
    body.type === "text" ? body.text : `${body.metric}: ${body.value}${body.unit ? ` ${body.unit}` : ""}`;
  return {
    id: stableUuid(incidentId, signal.id),
    incidentId,
    summary: `${channelLabels[signal.channel]} · ${signal.location.placeName}: ${content}`.slice(0, 2000),
    // ponytail: signals carry no severity; the agent triages. Derive one when FARO's triage lands.
    severity: "medium",
    source: signal.channel === "sensor" ? "sensor" : "webhook"
  };
}
