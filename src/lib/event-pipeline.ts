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

function rememberEvent(payload: IncomingEventPayload, id: string) {
  const current = state();
  const fingerprint = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  const previous = current.events.get(id);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new EventConflict("Event ID already has different content");
    return { current, duplicate: true };
  }

  current.events.set(id, { payload: structuredClone(payload), fingerprint });
  while (current.events.size > EVENT_LIMIT)
    current.events.delete(current.events.keys().next().value!);
  return { current, duplicate: false };
}

function publish(
  current: PipelineState,
  eventId: string,
  type: TelemetryRecord["type"],
  payload: Record<string, unknown>,
) {
  current.records.push({
    id: `${current.epoch}:${++current.sequence}`,
    eventId,
    type,
    at: new Date().toISOString(),
    payload: structuredClone(payload),
  });
  current.records = current.records.slice(-TELEMETRY_LIMIT);
}

/**
 * Publishes the existing event.accepted contract exactly once per stable Event ID.
 * Internal producers use this after their own durable processing has succeeded.
 */
export function publishAcceptedEvent(payload: IncomingEventPayload, id: string = randomUUID()) {
  const remembered = rememberEvent(payload, id);
  if (remembered.duplicate) return { eventId: id, duplicate: true, storage: "memory" as const };

  publish(remembered.current, id, "event.accepted", { ...payload, storage: "memory" });
  return { eventId: id, duplicate: false, storage: "memory" as const };
}

/** One boundary for all HTTP producers. No asynchronous work depends on SSE. */
export function acceptIncomingEvent(payload: IncomingEventPayload, id: string = randomUUID()) {
  const accepted = publishAcceptedEvent(payload, id);
  if (accepted.duplicate) {
    return {
      ...accepted,
      status: "awaiting_filtering" as const,
    };
  }

  const current = state();
  // HTTP intake durably queues the report before publishing this receipt.
  publish(current, id, "filtering.pending", {
    status: "awaiting_filtering",
    reason: "Awaiting the coordinator worker",
  });
  console.info(
    JSON.stringify({
      type: "event.accepted",
      eventId: id,
      storage: "memory",
      next: "filtering.pending",
    }),
  );
  return {
    ...accepted,
    status: "awaiting_filtering" as const,
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
