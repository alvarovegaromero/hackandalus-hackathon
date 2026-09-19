import { z } from "zod";
import { locationSchema } from "../signals/schema";
import { factValueSchema } from "./world";

const count = z.number().int().min(1).max(100);
const sourceIds = z.array(z.string().min(1)).min(1);

export const effectSchema = z.discriminatedUnion("type", [
  // Change the hidden world.
  z
    .object({ type: z.literal("set_fact"), factId: z.string().min(1), value: factValueSchema })
    .strict(),
  // Sources report the current value of a real fact (with noise).
  z.object({ type: z.literal("witness"), factId: z.string().min(1), count, sourceIds }).strict(),
  // Sources report something that does not exist in the world.
  z
    .object({
      type: z.literal("hoax"),
      kind: z.string().min(1),
      entityLabel: z.string().min(1),
      value: factValueSchema,
      location: locationSchema,
      count,
      sourceIds,
    })
    .strict(),
]);

export const scenarioEventSchema = z
  .object({
    id: z.string().min(1),
    atMin: z.number().min(0),
    kind: z.enum(["scheduled", "chaos", "noise_burst"]),
    label: z.string().min(1),
    effects: z.array(effectSchema).min(1),
  })
  .strict();

export type Effect = z.infer<typeof effectSchema>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
