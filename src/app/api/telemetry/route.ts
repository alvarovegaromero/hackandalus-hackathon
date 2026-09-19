import { createServerSupabase } from "@/lib/supabase/server";
import { readCoordinatorState } from "@/lib/coordinator/runtime";
import { authorizeDashboardRead } from "@/lib/pipeline-auth";
import type { TelemetryRecord } from "@/lib/event-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const encoder = new TextEncoder();

/** Replay durable receipts and bridge worker decisions to each SSE subscriber. */
export async function GET(request: Request) {
  const denied = authorizeDashboardRead(request);
  if (denied) return denied;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let close: (() => void) | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", stop);
    close?.();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => controller.close();
      let runId: string | undefined;
      let sequence = 0;
      const seen = new Map<string, string>();
      const send = (text: string) => {
        if (!stopped) controller.enqueue(encoder.encode(text));
      };
      const emit = (
        eventId: string,
        type: TelemetryRecord["type"],
        at: string,
        payload: Record<string, unknown>,
      ) => {
        const record: TelemetryRecord = {
          id: `${runId}:${++sequence}`,
          eventId,
          type,
          at,
          payload,
        };
        send(`id: ${record.id}\ndata: ${JSON.stringify(record)}\n\n`);
      };
      const poll = async () => {
        if (stopped) return;
        try {
          const before = await readCoordinatorState();
          const { data, error } = await createServerSupabase()
            .from("coordinator_events")
            .select("event_id,input,status,evidence,created_at")
            .order("created_at")
            .limit(100);
          if (error || !data) throw new Error("Telemetry unavailable");
          const after = await readCoordinatorState();
          if (stopped) return;
          // A reset during the read must never mix old and new runs.
          if (before.runId !== after.runId) return;
          if (runId !== after.runId) {
            runId = after.runId;
            seen.clear();
            sequence = 0;
            send('event: reset\nid:\ndata: {"reason":"Replaying current run"}\n\n');
          }
          send("event: ready\ndata: {}\n\n");
          for (const row of data) {
            const report = row.input.report;
            if (report.runId !== runId) continue;
            const title = report.text.split("\n")[0];
            if (!seen.has(row.event_id)) {
              emit(row.event_id, "event.accepted", row.created_at, {
                title,
                description: report.text,
                source: report.source,
                location: report.location,
                storage: "supabase",
              });
              emit(row.event_id, "filtering.pending", row.created_at, { title });
            }
            if (row.status !== "pending" && seen.get(row.event_id) !== row.status) {
              emit(
                row.event_id,
                row.status === "error" ? "filtering.failed" : "filtering.completed",
                row.created_at,
                { title, result: row.evidence?.filter, storage: "supabase" },
              );
            }
            seen.set(row.event_id, row.status);
          }
          send(": heartbeat\n\n");
        } catch {
          send("event: unavailable\ndata: {}\n\n");
        } finally {
          if (!stopped) {
            timer = setTimeout(poll, 1000);
          }
        }
      };
      send("retry: 1500\n\n");
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
      else void poll();
    },
    cancel() {
      close = undefined;
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
