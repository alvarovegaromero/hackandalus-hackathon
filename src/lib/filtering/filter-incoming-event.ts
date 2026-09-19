// OWNER: local demo intake to Jev and telemetry integration.
import "server-only";
import { randomUUID } from "node:crypto";
import { demoRunId, publishTelemetry } from "../event-pipeline";
import { normalizedReportSchema } from "../report";
import { addEvent } from "../store";
import type { IncomingEventPayload } from "../types";
import { filterReport } from "./filter-report";

export async function filterIncomingEvent(
  eventId: string,
  payload: IncomingEventPayload,
  runId = demoRunId(),
) {
  if (runId !== demoRunId()) return;
  const context = {
    schemaVersion: 1 as const,
    runId,
    eventId,
    executionId: randomUUID(),
  };
  const text =
    [payload.title, payload.description].filter(Boolean).join("\n") ||
    `Category: ${payload.category ?? "unknown"}; zone: ${payload.zoneId ?? "unknown"}`;
  try {
    // This HTTP adapter is public input. Caller-supplied source/severity are claims,
    // not trusted provenance or priority. Original claims remain in event.accepted.
    const report = normalizedReportSchema.parse({
      id: eventId,
      runId: context.runId,
      source: "public",
      channel: "legacy-event-api",
      receivedAt: new Date().toISOString(),
      text,
      location: payload.location,
      extracted: {},
    });
    const result = await filterReport({ ...context, report, evidence: [{ id: eventId }] });
    if (runId !== demoRunId()) return;
    publishTelemetry(
      eventId,
      result.status === "completed" ? "filtering.completed" : "filtering.failed",
      {
        ...context,
        result,
        title: payload.title ?? text,
        storage: "memory",
      },
    );
    // Only passed reports reach the existing sketch projection. This is not P3
    // triage or LLM dispatch; both remain unconnected.
    if (result.decision === "relevant" || result.decision === "uncertain") {
      try {
        addEvent(payload);
      } catch {
        console.warn(JSON.stringify({ type: "command_center.projection_failed", eventId }));
      }
    }
  } catch {
    if (runId !== demoRunId()) return;
    publishTelemetry(eventId, "filtering.failed", {
      ...context,
      title: payload.title ?? text,
      storage: "memory",
      failure: {
        code: "FILTER_INVALID_RESULT",
        retryable: false,
        message: "Jev filtering could not complete.",
      },
    });
  }
}
