// OWNER: read-only archive of the public simulated dashboard run.
import "server-only";
import snapshot from "./showcase-snapshot.json";

/** Captured public simulation data, bundled with the app instead of read from Supabase. */
export const showcaseSnapshot = snapshot;

/** Finite replay: the viewer closes its EventSource after the archived ready frame. */
export function showcaseTelemetry(): Response {
  const frames = [
    'event: reset\nid:\ndata: {"reason":"Replaying archived run"}\n\n',
    ...snapshot.telemetry.map((record) => `id: ${record.id}\ndata: ${JSON.stringify(record)}\n\n`),
    'event: ready\ndata: {"archived":true}\n\n',
  ];
  return new Response(frames.join(""), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
