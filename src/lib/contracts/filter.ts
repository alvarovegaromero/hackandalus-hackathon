// OWNER: P0/P2 shared relevance-filter contracts (docs/poc-contracts.md).
import { z } from "zod";
import { normalizedReportSchema } from "../report";

export const processingContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  eventId: z.uuid(),
  executionId: z.uuid(),
});

export const evidenceRefSchema = z.strictObject({ id: z.uuid() });

const filterRequestObject = processingContextSchema.extend({
  report: normalizedReportSchema,
  evidence: z.array(evidenceRefSchema).min(1),
});

export const filterRequestSchema = filterRequestObject.superRefine((request, ctx) => {
  if (request.report.id !== request.eventId || request.report.runId !== request.runId) {
    ctx.addIssue({
      code: "custom",
      path: ["report"],
      message: "Report context must match request.",
    });
  }
  if (!request.evidence.some(({ id }) => id === request.eventId)) {
    ctx.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "Original report evidence is required.",
    });
  }
});

export const filterFailureSchema = z.strictObject({
  code: z.enum(["FILTER_TIMEOUT", "FILTER_UNAVAILABLE", "FILTER_INVALID_RESULT"]),
  retryable: z.boolean(),
  message: z.string().min(1),
});

const filterAuditSchema = processingContextSchema.extend({
  evidence: z.array(evidenceRefSchema).min(1),
  summary: z.string().min(1),
  decidedAt: z.iso.datetime(),
  filterDecisionId: z.uuid(),
  policyVersion: z.string().min(1),
});

export const filterResultSchema = z.discriminatedUnion("status", [
  filterAuditSchema.extend({
    status: z.literal("completed"),
    decision: z.enum(["relevant", "irrelevant", "uncertain"]),
    relevanceProbability: z.number().min(0).max(1).nullable(),
    failure: z.null(),
  }),
  filterAuditSchema.extend({
    status: z.literal("unavailable"),
    decision: z.null(),
    relevanceProbability: z.null(),
    failure: filterFailureSchema,
  }),
]);

export const priorityRequestSchema = processingContextSchema
  .extend({
    report: normalizedReportSchema,
    filter: filterResultSchema,
    sourceProfileId: z.uuid().nullable(),
  })
  .superRefine((request, ctx) => {
    if (request.report.id !== request.eventId || request.report.runId !== request.runId) {
      ctx.addIssue({
        code: "custom",
        path: ["report"],
        message: "Report context must match request.",
      });
    }
    const filter = request.filter;
    if (
      filter.eventId !== request.eventId ||
      filter.runId !== request.runId ||
      filter.executionId !== request.executionId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["filter"],
        message: "Filter context must match request.",
      });
    }
    if (filter.status !== "completed" || filter.decision === "irrelevant") {
      ctx.addIssue({
        code: "custom",
        path: ["filter"],
        message: "Only relevant or uncertain reports may enter triage.",
      });
    }
  });

export type FilterRequest = z.infer<typeof filterRequestSchema>;
export type FilterResult = z.infer<typeof filterResultSchema>;
export type FilterFailure = z.infer<typeof filterFailureSchema>;
export type PriorityRequest = z.infer<typeof priorityRequestSchema>;

/** P3 owns scoring; P2 must not invent an AgentRequest or bypass priority. */
export function toPriorityRequest(
  input: FilterRequest,
  output: FilterResult,
  sourceProfileId: string | null = null,
): PriorityRequest | null {
  const request = filterRequestSchema.parse(input);
  const filter = filterResultSchema.parse(output);
  if (
    filter.runId !== request.runId ||
    filter.eventId !== request.eventId ||
    filter.executionId !== request.executionId
  ) {
    throw new Error("Cannot hand off a filter result from another processing context.");
  }
  if (filter.status !== "completed" || filter.decision === "irrelevant") return null;
  return priorityRequestSchema.parse({
    schemaVersion: request.schemaVersion,
    runId: request.runId,
    eventId: request.eventId,
    executionId: request.executionId,
    report: request.report,
    filter,
    sourceProfileId,
  });
}
