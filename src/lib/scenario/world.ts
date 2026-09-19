import { z } from "zod";
import { locationSchema, type Signal } from "../signals/schema";

export const factValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type FactValue = z.infer<typeof factValueSchema>;

// A fact is one hidden variable of the simulated world. `kind` is owned by the pack.
export const factDefSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    entityLabel: z.string().min(1),
    location: locationSchema,
    initial: factValueSchema,
    alternatives: z.array(factValueSchema).default([]),
    unit: z.string().optional()
  })
  .strict();

export type FactDef = z.infer<typeof factDefSchema>;
export type Keyframe = { atMin: number; value: FactValue };

export function valueAt(frames: Keyframe[], t: number): FactValue {
  let value = frames[0].value;
  for (const frame of frames) if (frame.atMin <= t) value = frame.value;
  return value;
}

export function withKeyframe(frames: Keyframe[], atMin: number, value: FactValue): Keyframe[] {
  // Array.prototype.sort is stable, so equal times keep insertion order.
  return [...frames, { atMin, value }].sort((a, b) => a.atMin - b.atMin);
}

// Metrics only: never shown to FARO.
export type TruthLabel = {
  truth: "genuine" | "duplicate" | "hoax" | "wrong";
  eventId: string;
  factId?: string;
};
export type LabeledSignal = { signal: Signal; label: TruthLabel };

export const toFeed = (labeled: LabeledSignal[]): Signal[] => labeled.map((l) => l.signal);
