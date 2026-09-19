import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const base = process.env.EVENT_API_URL || "http://localhost:3000";
const fixtures = [
  { title: "Humo detectado", category: "incendio", severity: "high" },
  { title: "Cambio de viento", category: "viento", severity: "critical" },
  { title: "Acceso bloqueado", category: "ruta-bloqueada", severity: "high" },
];
for (const fixture of fixtures) {
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
      source: "demo",
      zoneId: "zone-south",
      confidence: "high",
      confirmed: true,
      description: "Evento simulado enviado por HTTP para verificar la ingesta.",
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
