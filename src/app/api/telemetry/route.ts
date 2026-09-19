import { readTelemetry } from "@/lib/event-pipeline";
import { authorizePipeline } from "@/lib/pipeline-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const encoder = new TextEncoder();

export async function GET(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  let cursor =
    request.headers.get("last-event-id") ||
    new URL(request.url).searchParams.get("after") ||
    undefined;
  if (cursor !== undefined && !/^[0-9a-f-]{36}:\d{1,16}$/.test(cursor)) {
    return Response.json({ error: "Invalid telemetry cursor" }, { status: 400 });
  }
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
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const emit = () => {
        const { records, reset } = readTelemetry(cursor);
        if (reset) {
          send('event: reset\nid:\ndata: {"reason":"History expired or server restarted"}\n\n');
          cursor = undefined;
        }
        for (const record of records) {
          send(`id: ${record.id}\ndata: ${JSON.stringify(record)}\n\n`);
          cursor = record.id;
        }
        return records.length;
      };
      send("retry: 1500\n\n");
      emit();
      const poll = () => {
        if (stopped) return;
        // Disconnect slow readers; reconnect replays from their last received ID.
        if ((controller.desiredSize ?? 0) <= 0) return stop();
        const count = emit();
        send(": heartbeat\n\n");
        timer = setTimeout(poll, count === 100 ? 0 : 1000);
      };
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
      else timer = setTimeout(poll, 1000);
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
