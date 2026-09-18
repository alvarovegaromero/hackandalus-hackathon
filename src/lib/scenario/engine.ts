import type { Signal } from "../signals/schema";
import type { Effect, ScenarioEvent } from "./events";
import { between, chooseValue, hashSeed, jitter, pick, render, rng } from "./noise";
import type { ScenarioPack, Source } from "./pack";
import {
  valueAt,
  withKeyframe,
  type FactDef,
  type FactValue,
  type Keyframe,
  type LabeledSignal,
  type TruthLabel,
} from "./world";

// Plain data, so it can be stored and replayed. The engine is a pure function of (pack, state, time).
export type EngineState = {
  seed: number;
  nowMin: number;
  facts: Record<string, Keyframe[]>;
  fired: string[];
  pending: LabeledSignal[];
};

export type Step = { state: EngineState; emitted: LabeledSignal[]; fired: string[] };

export function createState(pack: ScenarioPack, seed: number): EngineState {
  return {
    seed,
    nowMin: 0,
    facts: Object.fromEntries(pack.facts.map((f) => [f.id, [{ atMin: 0, value: f.initial }]])),
    fired: [],
    pending: [],
  };
}

export const factValue = (state: EngineState, factId: string, t: number) =>
  valueAt(state.facts[factId], t);

type Claim = Pick<FactDef, "kind" | "entityLabel" | "location" | "unit">;

function report(
  pack: ScenarioPack,
  r: () => number,
  source: Source,
  claim: Claim,
  value: FactValue,
  id: string,
  atMin: number,
): Signal | null {
  if (r() < source.lossRate) return null;
  const receivedAtMin = +(atMin + between(r, source.delayMin)).toFixed(2);
  const location = jitter(r, claim.location, source.accuracyM);
  const body: Signal["body"] =
    source.channel === "sensor"
      ? { type: "reading", metric: claim.kind, value, ...(claim.unit ? { unit: claim.unit } : {}) }
      : {
          type: "text",
          text: render(pick(r, pack.templates[claim.kind]), {
            entity: claim.entityLabel,
            value: String(value),
            place: location.placeName,
          }),
        };
  return { id, channel: source.channel, sourceId: source.id, receivedAtMin, location, body };
}

const sourceOf = (pack: ScenarioPack, id: string) => {
  const source = pack.sources.find((s) => s.id === id);
  if (!source) throw new Error(`unknown source ${id}`);
  return source;
};

function truthAt(frames: Keyframe[], t: number) {
  const upTo = frames.filter((f) => f.atMin <= t);
  return { truth: upTo.at(-1)!.value, previous: upTo.at(-2)?.value };
}

function runEvent(
  pack: ScenarioPack,
  state: EngineState,
  event: ScenarioEvent,
  atMin: number,
): EngineState {
  const r = rng(hashSeed(state.seed, event.id));
  const facts = { ...state.facts };
  const made: LabeledSignal[] = [];
  let n = 0;
  const emit = (signal: Signal | null, label: TruthLabel) => {
    if (signal) made.push({ signal, label });
  };

  for (const effect of event.effects as Effect[]) {
    if (effect.type === "set_fact") {
      facts[effect.factId] = withKeyframe(facts[effect.factId], atMin, effect.value);
    } else if (effect.type === "witness") {
      const fact = pack.facts.find((f) => f.id === effect.factId)!;
      const { truth, previous } = truthAt(facts[fact.id], atMin);
      let sawTruth = false;
      for (let i = 0; i < effect.count; i++) {
        const source = sourceOf(pack, pick(r, effect.sourceIds));
        const { value, wrong } = chooseValue(
          r,
          source.reliability,
          truth,
          previous,
          fact.alternatives,
        );
        const truthLabel = wrong ? "wrong" : sawTruth ? "duplicate" : "genuine";
        emit(report(pack, r, source, fact, value, `${event.id}-${n++}`, atMin), {
          truth: truthLabel,
          eventId: event.id,
          factId: fact.id,
        });
        if (!wrong) sawTruth = true;
      }
    } else {
      for (let i = 0; i < effect.count; i++) {
        const source = sourceOf(pack, pick(r, effect.sourceIds));
        emit(report(pack, r, source, effect, effect.value, `${event.id}-${n++}`, atMin), {
          truth: "hoax",
          eventId: event.id,
        });
      }
    }
  }
  return {
    ...state,
    facts,
    fired: [...state.fired, event.id],
    pending: [...state.pending, ...made],
  };
}

function flush(state: EngineState): { state: EngineState; emitted: LabeledSignal[] } {
  const byArrival = (a: LabeledSignal, b: LabeledSignal) =>
    a.signal.receivedAtMin - b.signal.receivedAtMin || a.signal.id.localeCompare(b.signal.id);
  const due = state.pending.filter((l) => l.signal.receivedAtMin <= state.nowMin).sort(byArrival);
  return {
    state: {
      ...state,
      pending: state.pending.filter((l) => l.signal.receivedAtMin > state.nowMin),
    },
    emitted: due,
  };
}

// Runs every scheduled event up to `toMin` once and releases signals that have arrived by then.
export function advance(pack: ScenarioPack, state: EngineState, toMin: number): Step {
  if (toMin < state.nowMin) return { state, emitted: [], fired: [] };
  const due = pack.events
    .filter((e) => e.atMin <= toMin && !state.fired.includes(e.id))
    .sort((a, b) => a.atMin - b.atMin);
  let next = state;
  for (const event of due) next = runEvent(pack, next, event, event.atMin);
  const { state: settled, emitted } = flush({ ...next, nowMin: toMin });
  return { state: settled, emitted, fired: due.map((e) => e.id) };
}

// Manual injection (chaos button): same mechanism as a scheduled event, at most once.
export function fire(
  pack: ScenarioPack,
  state: EngineState,
  eventId: string,
  atMin = state.nowMin,
): Step {
  const event = pack.events.find((e) => e.id === eventId);
  if (!event) throw new Error(`unknown event ${eventId}`);
  if (state.fired.includes(eventId)) return { state, emitted: [], fired: [] };
  const { state: settled, emitted } = flush(runEvent(pack, state, event, atMin));
  return { state: settled, emitted, fired: [eventId] };
}

// FARO asks a responder about one fact; the answer comes from the hidden truth, with source noise.
export function probe(
  pack: ScenarioPack,
  state: EngineState,
  factId: string,
  sourceId: string,
  atMin: number,
): LabeledSignal | null {
  const fact = pack.facts.find((f) => f.id === factId);
  if (!fact) throw new Error(`unknown fact ${factId}`);
  const source = sourceOf(pack, sourceId);
  if (source.channel !== "verification") throw new Error(`source ${sourceId} cannot be probed`);
  const r = rng(hashSeed(state.seed, "probe", factId, sourceId, atMin));
  const { truth, previous } = truthAt(state.facts[factId], atMin);
  const { value, wrong } = chooseValue(r, source.reliability, truth, previous, fact.alternatives);
  const signal = report(
    pack,
    r,
    source,
    fact,
    value,
    `probe-${factId}-${sourceId}-${atMin}`,
    atMin,
  );
  return (
    signal && { signal, label: { truth: wrong ? "wrong" : "genuine", eventId: "probe", factId } }
  );
}
