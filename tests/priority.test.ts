import { beforeEach, describe, expect, it } from "vitest";
import { buildDedupeKey, scoreZone } from "@/lib/priority";
import { addEvent, approveAction, getSituation, injectDemo, resetSituation, setActionStatus } from "@/lib/store";

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "mock";
  resetSituation();
});

describe("crisis priority engine", () => {
  it("scores high-confidence critical events above the seed priority", () => {
    addEvent({
      source: "demo",
      title: "Critical change",
      description: "A changing situation requires immediate replanning.",
      zoneId: "zone-north",
      category: "evacuation",
      severity: "critical",
      confidence: "high",
      confirmed: true
    });

    const situation = getSituation();
    expect(situation.plan.priorities[0].zoneId).toBe("zone-north");
    expect(situation.plan.version).toBeGreaterThan(1);
  });

  it("deduplicates similar events inside a short time window", () => {
    const first = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "medium"
    });
    const second = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "high"
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(getSituation().events.filter((event) => event.dedupeKey === buildDedupeKey({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high"
    })).length).toBe(1);
  });

  it("accounts for resource failures during replanning", () => {
    const before = getSituation().plan.version;
    const next = injectDemo("resource-down");

    expect(next.plan.version).toBeGreaterThan(before);
    expect(next.resources.some((resource) => resource.status === "unavailable")).toBe(true);
  });

  it("updates action state through approval and external callbacks", async () => {
    const action = getSituation().actions[0];
    const approved = await approveAction(action.id);
    expect(approved.status).toBe("succeeded");
    expect(approved.externalActionId).toMatch(/^mock-/);

    const failed = setActionStatus(action.id, "failed", approved.externalActionId, "callback failure");
    expect(failed.status).toBe("failed");
    expect(getSituation().integration.lastExternalError).toBe("callback failure");
  });

  it("can score a zone without matching events", () => {
    const situation = getSituation();
    const zone = situation.zones.find((candidate) => candidate.id === "zone-south");

    expect(zone).toBeDefined();
    expect(scoreZone(zone!, [], situation.resources)).toBeGreaterThan(0);
  });
});
