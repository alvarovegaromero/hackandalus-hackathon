import { z } from "zod";

export const crisisEventSchema = z
  .object({
    id: z.uuid(),
    incidentId: z.uuid(),
    summary: z.string().trim().min(1).max(2000),
    severity: z.enum(["low", "medium", "high", "critical"]),
    source: z.enum(["operator", "sensor", "webhook"]),
  })
  .strict();

export const planSchema = z.object({
  priority: z.enum(["low", "medium", "high", "critical"]),
  rationale: z.string().min(1).max(2000),
  actions: z
    .array(
      z.object({
        kind: z.enum(["review", "notify", "allocate"]),
        description: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(5),
});

export type CrisisEvent = z.infer<typeof crisisEventSchema>;
export type Plan = z.infer<typeof planSchema>;
export type ActionStatus = "proposed" | "cancelled" | "simulated" | "blocked";

export function simulatePlan(event: CrisisEvent): Plan {
  return {
    priority: event.severity,
    rationale: `Simulación determinista: se revisa el plan con el nuevo evento (${event.severity}).`,
    actions: [{ kind: "review", description: `Revisar situación: ${event.summary}` }],
  };
}
