import { after } from "next/server";
import { setTimeout } from "node:timers/promises";
import fixtures from "@/lib/demo/mock-events.json";
import { acceptIncomingEvent, demoRunId, resetEventPipeline } from "@/lib/event-pipeline";
import { filterIncomingEvent } from "@/lib/filtering/filter-incoming-event";
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
  const events = fixtures.map((fixture) =>
    incomingEventSchema.parse({
      source: "demo",
      confidence: "high",
      confirmed: true,
      description: fixture.title,
      ...fixture,
    }),
  );
  const runId = resetEventPipeline();
  after(async () => {
    const pending: Promise<void>[] = [];
    for (const [index, event] of events.entries()) {
      if (runId !== demoRunId()) break;
      const accepted = acceptIncomingEvent(event);
      pending.push(filterIncomingEvent(accepted.eventId, event, runId));
      if (index < events.length - 1) await setTimeout(3000);
    }
    await Promise.all(pending);
  });
  return Response.json({ count: events.length }, { status: 202 });
}
