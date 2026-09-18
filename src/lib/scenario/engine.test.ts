import { describe, expect, it } from "vitest";
import { signalSchema } from "../signals/schema";
import { crisisMinutes } from "./clock";
import { advance, createState, factValue, fire, probe } from "./engine";
import { scenarioPackSchema } from "./pack";
import { sierraBermeja as pack } from "./packs/sierra-bermeja";
import { createMemoryStore } from "./store";
import { toFeed, valueAt } from "./world";

const run = (seed: number, toMin = 70) => advance(pack, createState(pack, seed), toMin);

describe("scenario engine", () => {
  it("is deterministic per seed and differs across seeds", () => {
    expect(run(1).emitted).toEqual(run(1).emitted);
    expect(run(1).emitted).not.toEqual(run(2).emitted);
  });

  it("emits only schema-valid signals with no truth labels in the feed", () => {
    const feed = toFeed(run(1).emitted);
    for (const s of feed) expect(signalSchema.safeParse(s).success).toBe(true);
    expect(JSON.stringify(feed)).not.toMatch(/hoax|duplicate|genuine|wrong|truth|label/i);
  });

  it("is idempotent and monotonic", () => {
    const first = run(1);
    const again = advance(pack, first.state, 70);
    expect(again.emitted).toEqual([]);
    expect(again.fired).toEqual([]);
    expect(advance(pack, first.state, 10).state).toBe(first.state);
  });

  it("splits time across calls without changing the result", () => {
    const whole = run(3).emitted;
    const a = advance(pack, createState(pack, 3), 25);
    const b = advance(pack, a.state, 70);
    expect([...a.emitted, ...b.emitted]).toEqual(whole);
  });

  it("releases signals only once they have arrived", () => {
    for (const { signal } of run(1, 5).emitted) expect(signal.receivedAtMin).toBeLessThanOrEqual(5);
  });

  it("emits a T+0 burst of roughly 40 signals with a hoax and duplicates", () => {
    const burst = run(1, 30).emitted.filter((l) => l.label.eventId === "t0-burst");
    expect(burst.length).toBeGreaterThanOrEqual(30);
    expect(burst.length).toBeLessThanOrEqual(40);
    expect(burst.some((l) => l.label.truth === "hoax")).toBe(true);
    expect(burst.some((l) => l.label.truth === "duplicate")).toBe(true);
  });

  it("hoaxes describe a place that is not in the world", () => {
    const hoaxes = run(1).emitted.filter((l) => l.label.truth === "hoax");
    expect(hoaxes.every((l) => l.label.factId === undefined)).toBe(true);
    expect(hoaxes.every((l) => l.signal.location.placeName === "Ronda centro")).toBe(true);
  });

  it("chaos changes the hidden world at its scheduled time", () => {
    const { state } = run(1);
    expect(valueAt(state.facts.wind, 29)).toBe("NE");
    expect(factValue(state, "wind", 30)).toBe("SO");
    expect(factValue(state, "road-a397", 39)).toBe("abierta");
    expect(factValue(state, "road-a397", 40)).toBe("cortada");
    expect(factValue(state, "sms-provider", 50)).toBe("caido");
    expect(factValue(state, "camping-headcount", 60)).toBe(170);
  });

  it("can mislabel stale testimony after a chaos event", () => {
    const wrong = run(1).emitted.filter(
      (l) => l.label.eventId === "chaos-wind-sw" && l.label.truth === "wrong",
    );
    for (const l of wrong) expect(l.label.factId).toBe("wind");
  });
});

describe("manual injection", () => {
  it("fires an event by id at most once, ahead of schedule", () => {
    const start = createState(pack, 1);
    const early = fire(pack, start, "chaos-a397-closed", 5);
    expect(early.fired).toEqual(["chaos-a397-closed"]);
    expect(factValue(early.state, "road-a397", 6)).toBe("cortada");
    expect(fire(pack, early.state, "chaos-a397-closed", 6).fired).toEqual([]);
    expect(advance(pack, early.state, 70).fired).not.toContain("chaos-a397-closed");
  });

  it("generates the same content whenever it is injected", () => {
    const at5 = fire(pack, createState(pack, 1), "chaos-wind-sw", 5);
    const at9 = fire(pack, createState(pack, 1), "chaos-wind-sw", 9);
    const texts = (s: typeof at5) => s.state.pending.map((l) => l.signal.body);
    expect(texts(at5)).toEqual(texts(at9));
  });

  it("rejects unknown events", () => {
    expect(() => fire(pack, createState(pack, 1), "nope")).toThrow();
  });
});

describe("probe", () => {
  it("answers from the hidden truth, deterministically", () => {
    const { state } = run(1);
    const a = probe(pack, state, "road-a397", "fire-chief", 45);
    expect(a).toEqual(probe(pack, state, "road-a397", "fire-chief", 45));
    if (a) expect(a.signal.channel).toBe("verification");
  });

  it("errs at roughly the source's unreliability", () => {
    const { state } = run(1);
    const answers = Array.from({ length: 400 }, (_, i) =>
      probe(pack, state, "road-a397", "mayor", 45 + i * 0.01),
    ).filter((a) => a !== null);
    const wrongRate = answers.filter((a) => a.label.truth === "wrong").length / answers.length;
    expect(wrongRate).toBeGreaterThan(0.04);
    expect(wrongRate).toBeLessThan(0.18);
  });

  it("only probes verification sources", () => {
    expect(() => probe(pack, createState(pack, 1), "wind", "citizens-sms", 1)).toThrow();
  });
});

describe("support", () => {
  it("compresses the clock 10x by default", () => {
    expect(crisisMinutes(60_000)).toBe(10);
    expect(crisisMinutes(-5)).toBe(0);
  });

  it("round-trips state through the memory store as a copy", async () => {
    const store = createMemoryStore();
    const { state } = run(1);
    await store.save("run", state);
    const loaded = await store.load("run");
    expect(loaded).toEqual(state);
    expect(loaded).not.toBe(state);
  });

  it("rejects packs with dangling references", () => {
    const bad = {
      ...pack,
      events: [{ ...pack.events[0], effects: [{ type: "set_fact", factId: "ghost", value: 1 }] }],
    };
    expect(scenarioPackSchema.safeParse(bad).success).toBe(false);
  });
});
