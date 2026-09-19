import { z } from "zod";
import { ingestBatch } from "@/lib/ingest-server";
import { signalSchema } from "@/lib/signals/schema";
import { signalToEvent } from "@/lib/signals/to-event";

const bodySchema = z.object({ incidentId: z.uuid(), signals: z.array(signalSchema).min(1) }).strict();

// Demo bridge: the browser scenario sends its simulated signals to the agent without the API
// token. Open in development; a deployment must opt in with SCENARIO_AGENT_ENABLED=true.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.SCENARIO_AGENT_ENABLED !== "true")
    return Response.json(
      { error: "Scenario agent bridge disabled: set SCENARIO_AGENT_ENABLED=true." },
      { status: 503 }
    );
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const events = parsed.data.signals.map((s) => signalToEvent(parsed.data.incidentId, s));
  const { status, body } = await ingestBatch(events, true);
  return Response.json(status < 300 ? { ...body, events } : body, { status });
}
