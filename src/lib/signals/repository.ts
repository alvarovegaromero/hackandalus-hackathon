// OWNER: durable inbound signal persistence.

import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { HappyRobotNormalizedReport } from "./happyrobot";

export type SignalProcessingStatus = "received" | "processing" | "processed" | "failed";

export interface PersistedSignal {
  id: string;
  source: "happyrobot";
  channel: HappyRobotNormalizedReport["channel"];
  externalIdentity: string;
  receivedAt: string;
  rawPayload: HappyRobotNormalizedReport;
  processingStatus: SignalProcessingStatus;
  eventId: string | null;
  createdAt: string;
  processedAt: string | null;
  processingError: string | null;
}

export interface NewSignal {
  id: string;
  channel: HappyRobotNormalizedReport["channel"];
  externalIdentity: string;
  receivedAt: string;
  rawPayload: HappyRobotNormalizedReport;
}

export interface SignalRepository {
  createOrGet(input: NewSignal): Promise<{ signal: PersistedSignal; inserted: boolean }>;
  claimForProcessing(id: string): Promise<PersistedSignal | null>;
  getById(id: string): Promise<PersistedSignal | null>;
  markProcessed(id: string, eventId: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

interface SignalRow {
  id: string;
  source: "happyrobot";
  channel: HappyRobotNormalizedReport["channel"];
  external_identity: string;
  received_at: string;
  raw_payload: HappyRobotNormalizedReport;
  processing_status: SignalProcessingStatus;
  event_id: string | null;
  created_at: string;
  processed_at: string | null;
  processing_error: string | null;
}

function fromRow(row: SignalRow): PersistedSignal {
  return {
    id: row.id,
    source: row.source,
    channel: row.channel,
    externalIdentity: row.external_identity,
    receivedAt: row.received_at,
    rawPayload: row.raw_payload,
    processingStatus: row.processing_status,
    eventId: row.event_id,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    processingError: row.processing_error,
  };
}

function failure(operation: string, error: { message: string }) {
  return new Error(`Signal persistence ${operation} failed: ${error.message}`);
}

export function createSignalRepository(): SignalRepository {
  const db = createServerSupabase();

  return {
    async createOrGet(input) {
      const row = {
        id: input.id,
        source: "happyrobot" as const,
        channel: input.channel,
        external_identity: input.externalIdentity,
        received_at: input.receivedAt,
        raw_payload: input.rawPayload,
        processing_status: "received" as const,
      };
      const inserted = await db
        .from("signals")
        .upsert(row, { onConflict: "external_identity", ignoreDuplicates: true })
        .select("*")
        .maybeSingle();
      if (inserted.error) throw failure("insert", inserted.error);
      if (inserted.data) return { signal: fromRow(inserted.data as SignalRow), inserted: true };

      const existing = await db
        .from("signals")
        .select("*")
        .eq("external_identity", input.externalIdentity)
        .single();
      if (existing.error) throw failure("lookup", existing.error);
      return { signal: fromRow(existing.data as SignalRow), inserted: false };
    },

    async claimForProcessing(id) {
      const result = await db
        .from("signals")
        .update({ processing_status: "processing", processing_error: null })
        .eq("id", id)
        .in("processing_status", ["received", "failed"])
        .select("*")
        .maybeSingle();
      if (result.error) throw failure("claim", result.error);
      return result.data ? fromRow(result.data as SignalRow) : null;
    },

    async getById(id) {
      const result = await db.from("signals").select("*").eq("id", id).maybeSingle();
      if (result.error) throw failure("lookup", result.error);
      return result.data ? fromRow(result.data as SignalRow) : null;
    },

    async markProcessed(id, eventId) {
      const result = await db
        .from("signals")
        .update({
          processing_status: "processed",
          event_id: eventId,
          processed_at: new Date().toISOString(),
          processing_error: null,
        })
        .eq("id", id);
      if (result.error) throw failure("completion", result.error);
    },

    async markFailed(id, error) {
      const result = await db
        .from("signals")
        .update({
          processing_status: "failed",
          processed_at: new Date().toISOString(),
          processing_error: error.slice(0, 1000),
        })
        .eq("id", id);
      if (result.error) throw failure("failure recording", result.error);
    },
  };
}
