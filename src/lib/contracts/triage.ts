// OWNER: P0/P3 impact assessment and planner handoff contracts.
import { z } from "zod";
import { resourceStateSchema } from "./resource-state";
import { normalizedReportSchema } from "../report";
import { evidenceRefSchema, filterResultSchema, processingContextSchema } from "./filter";

export const vulnerabilityGroupSchema = z.enum(["general", "school", "nursing_home"]);
const assessed = <T extends z.ZodType>(valueSchema: T) =>
  z
    .strictObject({
      value: valueSchema.nullable(),
      evidence: z.array(evidenceRefSchema),
      method: z.string().min(1),
    })
    .refine(
      (factor) => ("value" in factor && factor.value === null) || factor.evidence.length > 0,
      {
        message: "Known factors require supporting evidence references.",
      },
    );

export const impactFactorsSchema = z.strictObject({
  gravity: assessed(z.number().int().min(1).max(5)),
  peopleExposed: assessed(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  vulnerabilityGroup: assessed(vulnerabilityGroupSchema),
  minutesToHarm: assessed(z.number().nonnegative()),
});
export const impactAssessmentSchema = processingContextSchema.extend({
  assessedAt: z.iso.datetime(),
  factors: impactFactorsSchema,
});

export const impactPolicySchema = z.strictObject({
  timeScaleMinutes: z.number().positive(),
  vulnerabilityMultipliers: z.strictObject({
    general: z.number().min(1),
    school: z.number().min(1),
    nursing_home: z.number().min(1),
  }),
});

export const priorityResultSchema = processingContextSchema
  .extend({
    priorityDecisionId: z.uuid(),
    filterDecisionId: z.uuid(),
    formulaVersion: z.literal("source-of-truth-impact-v1"),
    weightsVersion: z.string().min(1),
    policy: impactPolicySchema,
    assessedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime(),
    evidence: z.array(evidenceRefSchema).min(1),
    factors: impactFactorsSchema,
    summary: z.string().min(1),
  })
  .extend({
    calculation: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("scored"),
        score: z.number().nonnegative(), // Raw impact, not a normalized 0–100 priority.
        terms: z.strictObject({
          gravity: z.number().int().min(1).max(5),
          exposureLog10: z.number().nonnegative(),
          vulnerabilityMultiplier: z.number().min(1),
          timeDiscount: z.number().min(0).max(1),
        }),
        missingFactors: z.array(z.string()).length(0),
      }),
      z.strictObject({
        status: z.literal("incomplete"),
        score: z.null(),
        terms: z.null(),
        missingFactors: z
          .array(z.enum(["gravity", "peopleExposed", "vulnerabilityGroup", "minutesToHarm"]))
          .min(1),
      }),
    ]),
  })
  .superRefine((result, ctx) => {
    const missing = Object.entries(result.factors)
      .filter(([, factor]) => factor.value === null)
      .map(([key]) => key);
    const reportedMissing = result.calculation.missingFactors;
    if (
      (result.calculation.status === "scored") !== (missing.length === 0) ||
      reportedMissing.length !== missing.length ||
      new Set(reportedMissing).size !== reportedMissing.length ||
      missing.some((key) => !reportedMissing.some((reported) => reported === key))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["calculation"],
        message: "Calculation status and missing factors must match the assessment.",
      });
    }
    if (!result.evidence.some(({ id }) => id === result.eventId)) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Original report evidence is required.",
      });
    }
  });

export const agentRequestSchema = processingContextSchema
  .extend({
    report: normalizedReportSchema,
    filter: filterResultSchema,
    priority: priorityResultSchema,
    sourceProfileId: z.uuid().nullable(),
    // P2 estimates relevance only. Truthfulness/confidence are not yet assessed.
    evidenceConfidence: z.null(),
    resources: z.union([
      z.strictObject({
        availability: z.literal("unlimited"),
        mode: z.literal("poc_assumption"),
      }),
      z.strictObject({ availability: z.literal("finite"), snapshot: resourceStateSchema }),
    ]),
    expectedRunRevision: z.number().int().nonnegative(),
    activePlanId: z.uuid().nullable(),
  })
  .superRefine((request, ctx) => {
    const sameContext = (value: { runId: string; eventId: string; executionId: string }) =>
      value.runId === request.runId &&
      value.eventId === request.eventId &&
      value.executionId === request.executionId;
    if (
      request.report.id !== request.eventId ||
      request.report.runId !== request.runId ||
      !sameContext(request.filter) ||
      !sameContext(request.priority) ||
      request.priority.filterDecisionId !== request.filter.filterDecisionId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Planner context must match report, filter and priority.",
      });
    }
    if (request.filter.status !== "completed" || request.filter.decision === "irrelevant") {
      ctx.addIssue({
        code: "custom",
        path: ["filter"],
        message: "Only relevant or uncertain reports can reach the planner.",
      });
    }
  });

// P4 can use this to validate its later LLM decision. No allocation is executed here.
export const plannerPriorityDecisionSchema = processingContextSchema.extend({
  priorityDecisionId: z.uuid(),
  expectedRunRevision: z.number().int().nonnegative(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  rationale: z.string().min(1),
  assumptions: z.array(z.string().min(1)),
  verificationNeeded: z.array(z.string().min(1)),
  proposedResources: z.array(
    z.strictObject({
      resourceType: z.literal("ambulance"),
      quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      purpose: z.string().min(1),
    }),
  ),
});

export type ImpactAssessment = z.infer<typeof impactAssessmentSchema>;
export type ImpactFactors = z.infer<typeof impactFactorsSchema>;
export type ImpactPolicy = z.infer<typeof impactPolicySchema>;
export type PriorityResult = z.infer<typeof priorityResultSchema>;
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type PlannerPriorityDecision = z.infer<typeof plannerPriorityDecisionSchema>;
