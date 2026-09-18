import { describe, expect, it } from "vitest";
import { crisisEventSchema, simulatePlan } from "./domain";
import { executeAction } from "./integrations/happyrobot";

const event = { id: "11111111-1111-4111-8111-111111111111", incidentId: "22222222-2222-4222-8222-222222222222", summary: "Acceso cortado", severity: "high" as const, source: "operator" as const };

describe("crisis boundaries", () => {
  it("rejects malformed events and undocumented fields", () => {
    expect(crisisEventSchema.safeParse({ ...event, summary: " " }).success).toBe(false);
    expect(crisisEventSchema.safeParse({ ...event, severity: "urgent" }).success).toBe(false);
    expect(crisisEventSchema.safeParse({ ...event, execute: true }).success).toBe(false);
  });
  it("revises demo priority when new information arrives", () => {
    expect(simulatePlan(event).priority).toBe("high");
    expect(simulatePlan({ ...event, severity: "critical" }).priority).toBe("critical");
  });
  it("never reports unconfigured external actions as successful", async () => {
    const result = await executeAction({ kind: "notify", description: "Contact operator" });
    expect(result.status).toBe("blocked");
  });
});
