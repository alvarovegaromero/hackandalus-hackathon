// OWNER: digital twin agent.

import { describe, expect, it } from "vitest";
import { buildDigitalTwin } from "@/lib/digitalTwin";
import { seedWorld } from "@/lib/seed";
import type { CrisisEvent, WorldState } from "@/lib/types";

const AHORA = "2026-02-14T10:30:00.000Z";

function mundo(overrides: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(seedWorld), updatedAt: AHORA, ...overrides };
}

function senal(
  overrides: Partial<CrisisEvent> & Pick<CrisisEvent, "id" | "category" | "description">,
): CrisisEvent {
  const { id, category, description, ...rest } = overrides;
  return {
    ...rest,
    id,
    source: "scenario",
    title: "Test signal",
    zoneId: rest.zoneId ?? "zone-north",
    category,
    severity: "high",
    confidence: "high",
    createdAt: "2026-02-14T10:20:00.000Z",
    confirmed: true,
    dedupeKey: `${overrides.zoneId ?? "zone-north"}:${category}`,
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
    description,
  };
}

describe("digital twin", () => {
  it("starts with unknown facts until signals rebuild the perceived world", () => {
    const twin = buildDigitalTwin(mundo(), [], { now: AHORA });

    expect(twin.accuracy).toBe(0);
    expect(twin.unknownFacts).toBe(twin.facts.length);
    expect(twin.summary).toContain("todavía no tiene evidencia");
  });

  it("reconstructs a blocked road from live evidence and matches the simulated truth", () => {
    const event = senal({
      id: "evt-a397",
      category: "route-blocked",
      description: "La A-397 queda cortada por el frente.",
    });

    const twin = buildDigitalTwin(mundo({ blockedRoads: ["A-397"] }), [event], { now: AHORA });
    const roads = twin.facts.find((fact) => fact.id === "roads");

    expect(roads?.perceived).toBe("A-397");
    expect(roads?.truth).toBe("A-397");
    expect(roads?.status).toBe("confirmed");
    expect(roads?.evidenceEventIds).toEqual(["evt-a397"]);
    expect(twin.mismatches).toBe(0);
  });

  it("detects a divergence when the hidden world changed before evidence arrived", () => {
    const twin = buildDigitalTwin(mundo({ blockedRoads: ["A-397"] }), [], { now: AHORA });
    const roads = twin.facts.find((fact) => fact.id === "roads");

    expect(roads?.status).toBe("unknown");
    expect(roads?.perceived).toBe("ninguna");
    expect(roads?.truth).toBe("A-397");
    expect(twin.mismatches).toBe(0);

    const staleEvidence = senal({
      id: "evt-a92",
      category: "route-blocked",
      description: "La A-92 queda cortada.",
      zoneId: "zone-east",
    });
    const divergent = buildDigitalTwin(mundo({ blockedRoads: ["A-397"] }), [staleEvidence], {
      now: AHORA,
    });
    const divergentRoads = divergent.facts.find((fact) => fact.id === "roads");

    expect(divergentRoads?.status).toBe("mismatch");
    expect(divergentRoads?.perceived).toBe("A-92");
    expect(divergentRoads?.truth).toBe("A-397");
    expect(divergent.mismatches).toBe(1);
  });
});
