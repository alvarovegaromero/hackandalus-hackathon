import { processCoordinatorInBackground } from "@/lib/coordinator/background";
import { after } from "next/server";
import { setTimeout } from "node:timers/promises";
import fixtures from "@/lib/demo/mock-events.json";
import { enqueueLegacyEvent, readCoordinatorState } from "@/lib/coordinator/runtime";
import { incomingEventSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Local-only demo control; never expose server credentials in the browser. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Demo controls are only available locally." }, { status: 404 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Same-origin request required." }, { status: 403 });
  }
  const events = fixtures.map((fixture) => incomingEventSchema.parse(fixture));
  const { runId } = await readCoordinatorState();
  after(async () => {
    const processing: Promise<void>[] = [];
    for (const [index, event] of events.entries()) {
      try {
        await enqueueLegacyEvent(event, undefined, runId);
        processing.push(processCoordinatorInBackground());
      } catch {
        console.warn("Demo event sequence stopped: run changed or enqueue failed.");
        break;
      }
      if (index < events.length - 1) await setTimeout(3000);
    }
    await Promise.allSettled(processing);
  });
  return Response.json({ count: events.length }, { status: 202 });
}
