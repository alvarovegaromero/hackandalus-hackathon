// OWNER: emergency drill sandbox.
import { z } from "zod";

export const drillScenarioSchema = z.strictObject({
  version: z.literal(1),
  seed: z.number().int().min(0).max(4294967295),
  careShare: z.number().min(0.1).max(0.4),
  careTravelMultiplier: z.number().min(1).max(2),
  mainTravelMinutes: z.number().int().min(2).max(4),
  alternativeTravelMinutes: z.number().int().min(4).max(6),
  serviceMinutes: z.number().min(0.5).max(2).multipleOf(0.125),
  events: z.strictObject({
    roadClosureMinute: z.literal(5),
    communicationsFailureMinute: z.literal(10),
    escalationMinute: z.literal(15),
    unbriefedCapacityMultiplier: z.number().min(0.5).max(1),
    escalationRisk: z.number().int().min(5).max(25),
  }),
  objectives: z.strictObject({
    minimumCoverage: z.number().int().min(0).max(100),
    maximumExposurePerPerson: z.number().min(0).max(20),
  }),
});

export type DrillScenario = z.infer<typeof drillScenarioSchema>;
export const DEFAULT_SCENARIO: DrillScenario = {
  version: 1,
  seed: 112,
  careShare: 0.2,
  careTravelMultiplier: 1.25,
  mainTravelMinutes: 2,
  alternativeTravelMinutes: 4,
  serviceMinutes: 1,
  events: {
    roadClosureMinute: 5,
    communicationsFailureMinute: 10,
    escalationMinute: 15,
    unbriefedCapacityMultiplier: 0.7,
    escalationRisk: 10,
  },
  objectives: { minimumCoverage: 80, maximumExposurePerPerson: 8 },
};

export function scenarioVariation(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967296;
}
