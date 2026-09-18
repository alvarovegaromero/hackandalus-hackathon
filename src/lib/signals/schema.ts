import { z } from "zod";

export const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    accuracyM: z.number().min(0),
    placeName: z.string().trim().min(1),
  })
  .strict();

export const channelSchema = z.enum(["citizen_call", "sms", "sensor", "verification"]);

// Nothing here may reveal ground truth: FARO only ever sees this shape.
export const signalSchema = z
  .object({
    id: z.string().min(1),
    channel: channelSchema,
    sourceId: z.string().min(1),
    receivedAtMin: z.number().min(0),
    location: locationSchema,
    body: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000) }).strict(),
      z
        .object({
          type: z.literal("reading"),
          metric: z.string().min(1),
          value: z.union([z.string(), z.number(), z.boolean()]),
          unit: z.string().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export type Location = z.infer<typeof locationSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Signal = z.infer<typeof signalSchema>;
