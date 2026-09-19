import { describe, expect, it } from "vitest";
import { signalSchema } from "../signals/schema";
import { advance, createState, factValue, probe } from "./engine";
import { scenarioPackSchema } from "./pack";
import { toFeed } from "./world";

// A flood pack with no wildfire vocabulary, to prove the engine is crisis-agnostic.
const spot = { lat: 37.39, lon: -5.98, accuracyM: 0, placeName: "Puente del Cachorro" };
const flood = scenarioPackSchema.parse({
  id: "flood-test",
  name: "Test flood",
  durationMin: 40,
  facts: [
    {
      id: "river",
      kind: "river_level",
      entityLabel: "el rio",
      location: spot,
      initial: 2,
      alternatives: [1, 4],
      unit: "m"
    },
    {
      id: "underpass",
      kind: "underpass_status",
      entityLabel: "el paso inferior",
      location: spot,
      initial: "abierto",
      alternatives: ["inundado"]
    }
  ],
  sources: [
    {
      id: "gauge",
      channel: "sensor",
      reliability: 0.99,
      delayMin: [0, 1],
      lossRate: 0,
      accuracyM: 5
    },
    {
      id: "neighbours",
      channel: "citizen_call",
      reliability: 0.7,
      delayMin: [0, 2],
      lossRate: 0.1,
      accuracyM: 200
    },
    {
      id: "civil-protection",
      channel: "verification",
      reliability: 0.95,
      delayMin: [1, 2],
      lossRate: 0,
      accuracyM: 10
    }
  ],
  templates: {
    river_level: ["El rio lleva {value} metros en {place}"],
    underpass_status: ["{entity} esta {value}"]
  },
  events: [
    {
      id: "surge",
      atMin: 10,
      kind: "chaos",
      label: "Crecida",
      effects: [
        { type: "set_fact", factId: "river", value: 4 },
        { type: "set_fact", factId: "underpass", value: "inundado" },
        { type: "witness", factId: "underpass", count: 5, sourceIds: ["neighbours"] },
        { type: "witness", factId: "river", count: 1, sourceIds: ["gauge"] }
      ]
    }
  ]
});

describe("second crisis pack", () => {
  it("runs through the unchanged engine with the same invariants", () => {
    const first = advance(flood, createState(flood, 7), 40);
    expect(first.emitted).toEqual(advance(flood, createState(flood, 7), 40).emitted);
    for (const s of toFeed(first.emitted)) expect(signalSchema.safeParse(s).success).toBe(true);
    expect(factValue(first.state, "underpass", 10)).toBe("inundado");
    expect(probe(flood, first.state, "river", "civil-protection", 20)?.signal.channel).toBe("verification");
  });
});
