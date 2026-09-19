import { createHash } from "node:crypto";
import { processCoordinatorInBackground } from "@/lib/coordinator/background";
import { after } from "next/server";
import { setTimeout } from "node:timers/promises";
import fixtures from "@/lib/demo/mock-events.json";
import { enqueueLegacyEvent, readCoordinatorState } from "@/lib/coordinator/runtime";
import { incomingEventSchema } from "@/lib/validation";
import { authorizeDemoControl } from "@/lib/demo-access";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Local or time-limited public fixture control; never expose server credentials. */
export async function POST(request: Request) {
  const denied = authorizeDemoControl(request);
  if (denied) return denied;
  const events = fixtures.map((fixture) => incomingEventSchema.parse(fixture));
  const { runId } = await readCoordinatorState();
  after(async () => {
    const processing: Promise<void>[] = [];
    for (const [index, event] of events.entries()) {
      try {
        const hex = createHash("sha256").update(`${runId}:fixture:${index}`).digest("hex");
        const eventId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const receipt = await enqueueLegacyEvent(event, eventId, runId);
        if (!receipt.duplicate) processing.push(processCoordinatorInBackground());
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
