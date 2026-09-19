// OWNER: event ingestion and telemetry pipeline.
import { randomUUID } from "node:crypto";
import type { IncomingEventPayload } from "./types";

export interface TelemetryRecord {
  id: string;
  eventId: string;
  type: "event.accepted" | "filtering.pending";
  at: string;
  payload: Record<string, unknown>;
}

interface PipelineState {
  sequence: number;
  epoch: string;
  events: Map<string, { payload: IncomingEventPayload; fingerprint: string }>;
  records: TelemetryRecord[];
}

declare global {
  var eventPipelineState: PipelineState | undefined;
}

export const TELEMETRY_LIMIT = 1000;
export const EVENT_LIMIT = 1000;

function state(): PipelineState {
  return (globalThis.eventPipelineState ??= {
    sequence: 0,
    epoch: randomUUID(),
    events: new Map(),
    records: [],
  });
}

export class EventConflict extends Error {}

/** One boundary for all HTTP producers. No asynchronous work depends on SSE. */
export function acceptIncomingEvent(payload: IncomingEventPayload, id: string = randomUUID()) {
  const current = state();
  const fingerprint = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  const previous = current.events.get(id);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new EventConflict("Event ID already has different content");
    return {
      eventId: id,
      duplicate: true,
      status: "awaiting_filtering" as const,
      storage: "memory" as const,
    };
  }

  // TODO: save in Supabase. Persist the event, processing handoff and telemetry
  // atomically before acknowledging acceptance; replace this process-local store.
  current.events.set(id, { payload: structuredClone(payload), fingerprint });
  while (current.events.size > EVENT_LIMIT)
    current.events.delete(current.events.keys().next().value!);
  const publish = (type: TelemetryRecord["type"], data: Record<string, unknown>) => {
    current.records.push({
      id: `${current.epoch}:${++current.sequence}`,
      eventId: id,
      type,
      at: new Date().toISOString(),
      payload: structuredClone(data),
    });
  };
  publish("event.accepted", { ...payload, storage: "memory" });
  // TODO: dispatch to the filtering module; its output feeds triage, then LLM.
  // Pending means no filtering/triage/LLM execution has been claimed or started.
  publish("filtering.pending", {
    status: "awaiting_filtering",
    reason: "Filtering module not connected",
  });
  current.records = current.records.slice(-TELEMETRY_LIMIT);
  console.info(
    JSON.stringify({
      type: "event.accepted",
      eventId: id,
      storage: "memory",
      next: "filtering.pending",
    }),
  );
  return {
    eventId: id,
    duplicate: false,
    status: "awaiting_filtering" as const,
    storage: "memory" as const,
  };
}

/** An obsolete cursor explicitly resets the viewer; IDs include a process epoch. */
export function readTelemetry(after?: string): { records: TelemetryRecord[]; reset: boolean } {
  const current = state();
  if (after === undefined)
    return { records: structuredClone(current.records.slice(-100)), reset: false };
  const index = current.records.findIndex((record) => record.id === after);
  if (index < 0) return { records: structuredClone(current.records.slice(-100)), reset: true };
  return { records: structuredClone(current.records.slice(index + 1, index + 101)), reset: false };
}
