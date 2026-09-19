// PROPIETARIO: contrato de entrada a triaje (docs/input-contract.md).
//
// Sobre común que producen todos los adaptadores de canal antes del triaje.
// Cada adaptador valida su salida contra este esquema; así convergen el
// formulario público, HappyRobot y el motor de escenarios.

import { z } from "zod";

export const reportLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    reference: z.enum(["incident", "reporter", "unknown"]).default("unknown"),
  })
  .strict()
  .refine((l) => (l.latitude === undefined) === (l.longitude === undefined), {
    message: "latitude and longitude go together",
  })
  .refine((l) => l.latitude !== undefined || l.description !== undefined, {
    message: "location needs coordinates, a description, or both",
  });

export const normalizedReportSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    source: z.enum(["operator", "sensor", "happyrobot", "public", "scenario", "webhook"]),
    channel: z.string().min(1).optional(),
    externalRef: z.string().min(1).optional(),
    receivedAt: z.iso.datetime(),
    occurredAt: z.iso.datetime().optional(),
    text: z.string().trim().min(1).max(4000),
    location: reportLocationSchema.optional(),
    extracted: z
      .object({
        category: z.string().min(1).optional(),
        peopleReportedPresent: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export type NormalizedReport = z.infer<typeof normalizedReportSchema>;
