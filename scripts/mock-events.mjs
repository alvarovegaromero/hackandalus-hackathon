import fixtures from "../src/lib/demo/mock-events.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const base = process.env.EVENT_API_URL || "http://localhost:3000";
// One evolving wildfire with interleaved irrelevant messages, every 3 s.
// Override timing with EVENT_INTERVAL_MS.
const intervalMs = Number(process.env.EVENT_INTERVAL_MS) || 3000;

// Shared with the dashboard demo button.

for (const [index, fixture] of fixtures.entries()) {
  const id = randomUUID();
  const response = await fetch(new URL("/api/events", base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.CRISIS_API_TOKEN
        ? { authorization: `Bearer ${process.env.CRISIS_API_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      id,
      ...fixture,
    }),
  });
  if (!response.ok)
    throw new Error(`Event ${id}: HTTP ${response.status} ${await response.text()}`);
  const accepted = await response.json();
  console.log(
    JSON.stringify({
      n: `${index + 1}/${fixtures.length}`,
      title: fixture.title,
      eventId: accepted.eventId,
      status: accepted.status,
      duplicate: accepted.duplicate,
    }),
  );
  if (index < fixtures.length - 1) await setTimeout(intervalMs);
}
