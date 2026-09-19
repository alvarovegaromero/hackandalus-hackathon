import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const base = process.env.EVENT_API_URL || "http://localhost:3000";
// 20 events, one every 3 s: about one minute. Override with EVENT_INTERVAL_MS.
const intervalMs = Number(process.env.EVENT_INTERVAL_MS) || 3000;

const incident = (latitude, longitude, description) => ({
  latitude,
  longitude,
  description,
  reference: "incident",
});
const reporter = (latitude, longitude) => ({ latitude, longitude, reference: "reporter" });

// A small storyline around Sierra Bermeja: ignition, spread, evacuations, a road
// closure, a wind shift and a late escalation. Zone IDs must exist in the seed.
const fixtures = [
  {
    title: "Smoke column reported",
    category: "fire",
    severity: "medium",
    confidence: "low",
    zoneId: "zone-east",
    location: reporter(36.52, -5.16),
  },
  {
    title: "Fire ignition confirmed",
    category: "fire",
    severity: "high",
    zoneId: "zone-east",
    location: incident(36.52, -5.14, "Ridge above Genalguacil track"),
  },
  {
    title: "Fire crew dispatched",
    category: "operations",
    severity: "low",
    zoneId: "zone-east",
    location: incident(36.53, -5.12, "Forest station staging point"),
  },
  {
    title: "Wind shift to west",
    category: "wind",
    severity: "high",
    zoneId: "zone-central",
    location: { latitude: 36.5, longitude: -5.1, reference: "unknown" },
  },
  {
    title: "Spot fire ahead of the front",
    category: "fire",
    severity: "high",
    zoneId: "zone-central",
    location: incident(36.548, -5.2, "Pine plantation near Jubrique"),
  },
  {
    title: "Heavy smoke on A-397",
    category: "smoke",
    severity: "medium",
    confidence: "medium",
    zoneId: "zone-north",
    location: reporter(36.601, -5.087),
  },
  {
    title: "Campsite evacuation started",
    category: "evacuation",
    severity: "high",
    zoneId: "zone-north",
    location: incident(36.567, -5.21, "Campsite north entrance"),
  },
  {
    title: "A-397 closed by fire",
    category: "road-blocked",
    severity: "critical",
    zoneId: "zone-north",
    location: incident(36.535, -5.032, "A-397 near the Benahavís junction"),
  },
  {
    title: "Alternate route MA-8301 open",
    category: "road-open",
    severity: "low",
    zoneId: "zone-central",
    location: incident(36.544, -5.234, "MA-8301 at Peñas Blancas"),
  },
  {
    title: "Elderly residents need transport",
    category: "medical",
    severity: "high",
    confidence: "medium",
    zoneId: "zone-central",
    location: incident(36.55, -5.225, "Care home, Jubrique"),
  },
  {
    title: "Power line down",
    category: "power-outage",
    severity: "high",
    zoneId: "zone-east",
    location: incident(36.512, -5.187, "Lines along the east slope"),
  },
  {
    title: "Fire front crossing the ridge",
    category: "fire",
    severity: "critical",
    zoneId: "zone-east",
    location: incident(36.505, -5.165, "Main ridge, east side"),
  },
  {
    title: "Water tanker running low",
    category: "resources",
    severity: "medium",
    zoneId: "zone-east",
    location: reporter(36.528, -5.13),
  },
  {
    title: "Houses threatened",
    category: "evacuation",
    severity: "critical",
    zoneId: "zone-south",
    location: incident(36.46, -5.15, "Hillside houses above the coast"),
  },
  {
    title: "Ember spotting over the coast road",
    category: "fire",
    severity: "high",
    confidence: "medium",
    zoneId: "zone-south",
    location: { latitude: 36.427, longitude: -5.145, reference: "unknown" },
  },
  {
    title: "Shelter capacity 80% full",
    category: "shelter",
    severity: "medium",
    zoneId: "zone-south",
    location: incident(36.44, -5.12, "Sports hall shelter"),
  },
  {
    title: "Helicopter drop requested",
    category: "operations",
    severity: "high",
    zoneId: "zone-islands",
    location: incident(36.444, -5.273, "Reservoir pickup point"),
  },
  {
    title: "Wind gusting to 45 km/h",
    category: "wind",
    severity: "critical",
    zoneId: "zone-islands",
    location: { latitude: 36.45, longitude: -5.26, reference: "unknown" },
  },
  {
    title: "Second smoke column south",
    category: "fire",
    severity: "high",
    confidence: "low",
    zoneId: "zone-south",
    location: reporter(36.43, -5.2),
  },
  {
    title: "MA-8301 closed by debris",
    category: "road-blocked",
    severity: "high",
    zoneId: "zone-central",
    location: incident(36.512, -5.187, "MA-8301 rockfall"),
  },
];

for (const [index, fixture] of fixtures.entries()) {
  const id = randomUUID();
  const response = await fetch(new URL("/api/events", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      source: "demo",
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
      n: `${index + 1}/${fixtures.length}`,
      title: fixture.title,
      eventId: accepted.eventId,
      status: accepted.status,
      duplicate: accepted.duplicate,
    }),
  );
  if (index < fixtures.length - 1) await setTimeout(intervalMs);
}
