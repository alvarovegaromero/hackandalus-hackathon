import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const base = process.env.EVENT_API_URL || "http://localhost:3000";
const fixtures = [
  { title: "Smoke detected", category: "wildfire", severity: "high" },
  { title: "Wind shift", category: "wind", severity: "critical" },
  { title: "Access blocked", category: "road-blocked", severity: "high" },
];
for (const fixture of fixtures) {
  const id = randomUUID();
  const response = await fetch(new URL("/api/events", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      source: "demo",
      zoneId: "zone-south",
      confidence: "high",
      confirmed: true,
      description: "Simulated event sent over HTTP to verify ingestion.",
      ...fixture,
    }),
  });
  if (!response.ok)
    throw new Error(`Event ${id}: HTTP ${response.status} ${await response.text()}`);
  const accepted = await response.json();
  console.log(
    JSON.stringify({
      eventId: accepted.eventId,
      status: accepted.status,
      duplicate: accepted.duplicate,
    }),
  );
  await setTimeout(1000);
}
