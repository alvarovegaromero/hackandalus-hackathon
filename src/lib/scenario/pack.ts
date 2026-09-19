import { z } from "zod";
import { channelSchema } from "../signals/schema";
import { scenarioEventSchema } from "./events";
import { factDefSchema } from "./world";

const range = z.tuple([z.number().min(0), z.number().min(0)]);

export const sourceSchema = z
  .object({
    id: z.string().min(1),
    channel: channelSchema,
    reliability: z.number().min(0).max(1),
    delayMin: range,
    lossRate: z.number().min(0).max(1),
    accuracyM: z.number().min(0),
  })
  .strict();

// Everything crisis-specific lives in a pack; the engine only sees facts, sources and templates.
export const scenarioPackSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    durationMin: z.number().positive(),
    facts: z.array(factDefSchema).min(1),
    sources: z.array(sourceSchema).min(1),
    // Message templates per fact kind; placeholders: {entity} {value} {place}.
    templates: z.record(z.string(), z.array(z.string().min(1)).min(1)),
    events: z.array(scenarioEventSchema).min(1),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const unique = (ids: string[], what: string) => {
      if (new Set(ids).size !== ids.length) fail(`duplicate ${what} id`);
    };
    unique(
      pack.facts.map((f) => f.id),
      "fact",
    );
    unique(
      pack.sources.map((s) => s.id),
      "source",
    );
    unique(
      pack.events.map((e) => e.id),
      "event",
    );

    const facts = new Set(pack.facts.map((f) => f.id));
    const sources = new Set(pack.sources.map((s) => s.id));
    const kinds = new Set(pack.facts.map((f) => f.kind));
    for (const event of pack.events) {
      for (const effect of event.effects) {
        if (effect.type !== "hoax" && !facts.has(effect.factId))
          fail(`${event.id}: unknown fact ${effect.factId}`);
        if (effect.type === "hoax") kinds.add(effect.kind);
        if (effect.type !== "set_fact") {
          for (const id of effect.sourceIds)
            if (!sources.has(id)) fail(`${event.id}: unknown source ${id}`);
        }
      }
    }
    for (const kind of kinds) if (!pack.templates[kind]) fail(`missing templates for kind ${kind}`);
    for (const s of pack.sources)
      if (s.delayMin[0] > s.delayMin[1]) fail(`source ${s.id}: delayMin is reversed`);
  });

export type Source = z.infer<typeof sourceSchema>;
export type ScenarioPack = z.infer<typeof scenarioPackSchema>;
