// OWNER: emergency drill sandbox; no runtime or operational imports.
import { z } from "zod";
import { coordinatorStateSchema, type CoordinatorState } from "./contracts/coordinator";
import { comparableDrills, type DrillConfig, type DrillRun, type Hazard } from "./emergency-drills";
import { learningLessons, validateAuditedDrill } from "./drill-learning";

export const reviewedContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("reviewed-drill-context"),
  synthetic: z.literal(true),
  authority: z.literal("untrusted-reference-data"),
  sourceRunId: z.uuid(),
  hazard: z.enum(["earthquake", "wildfire"]),
  severity: z.enum(["moderate", "severe", "extreme"]),
  engineVersion: z.literal(3),
  lessonId: z.string(),
  ruleVersion: z.string(),
  fact: z.string(),
  proposal: z.string(),
  evidenceRefs: z.array(z.strictObject({ id: z.string(), minute: z.number() })).min(1),
  resultRef: z.string(),
  reviewedAt: z.iso.datetime(),
  reviewer: z.enum(["local-facilitator", "synthetic-review-fixture"]),
});
export type ReviewedDrillContext = z.infer<typeof reviewedContextSchema>;

export function reviewedDrillContext(rawRun: DrillRun): ReviewedDrillContext[] {
  const run = validateAuditedDrill(rawRun);
  if (run.modelVersion !== 3 || run.status !== "completed")
    throw new Error("Review a completed model 3 run before building context.");
  const lessons = learningLessons(run);
  const reviews = run.learningReview ?? [];
  if (
    new Set(reviews.map((review) => review.lessonId)).size !== reviews.length ||
    reviews.some((review) => !lessons.some((lesson) => lesson.id === review.lessonId))
  )
    throw new Error("Review IDs must be unique and refer to generated lessons.");
  return lessons.flatMap((lesson) => {
    const review = reviews.find(
      (item) => item.lessonId === lesson.id && item.verdict === "approved",
    );
    if (!review) return [];
    return [
      reviewedContextSchema.parse({
        schemaVersion: 1,
        kind: "reviewed-drill-context",
        synthetic: true,
        authority: "untrusted-reference-data",
        sourceRunId: run.id,
        hazard: run.config.hazard,
        severity: run.config.severity,
        engineVersion: 3,
        lessonId: lesson.id,
        ruleVersion: lesson.ruleVersion,
        fact: lesson.evidence,
        proposal: lesson.recommendation,
        evidenceRefs: lesson.evidenceRefs,
        resultRef: lesson.resultRef,
        reviewedAt: review.reviewedAt,
        reviewer: review.reviewer,
      }),
    ];
  });
}

export function reviewedDrillBriefing(
  config: DrillConfig,
  history: DrillRun[],
  current?: Pick<DrillRun, "id" | "startedAt" | "modelVersion">,
) {
  const records: ReviewedDrillContext[] = [];
  const skippedRunIds: string[] = [];
  if (current && current.modelVersion !== 3) return { records, skippedRunIds };
  const seen = new Set<string>();
  const matches = comparableDrills(config, history)
    .filter((run) => !current || (run.id !== current.id && run.startedAt < current.startedAt))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  for (const run of matches) {
    try {
      for (const record of reviewedDrillContext(run)) {
        if (record.reviewer !== "local-facilitator" || seen.has(record.lessonId)) continue;
        seen.add(record.lessonId);
        records.push(record);
      }
    } catch {
      skippedRunIds.push(run.id);
    }
  }
  return { records: records.slice(0, 6), skippedRunIds };
}

export function retrieveDrillContext(
  records: ReviewedDrillContext[],
  query: { hazard: Hazard; severity: DrillRun["config"]["severity"]; excludeRunId: string },
): ReviewedDrillContext[] {
  return records
    .map((record) => reviewedContextSchema.parse(record))
    .filter(
      (record) =>
        record.hazard === query.hazard &&
        record.severity === query.severity &&
        record.sourceRunId !== query.excludeRunId,
    )
    .slice(0, 6);
}

export function buildOfflineCoordinatorContext(
  rawState: CoordinatorState,
  records: ReviewedDrillContext[],
  query: { hazard: Hazard; severity: DrillRun["config"]["severity"] },
) {
  const state = coordinatorStateSchema.parse(rawState);
  const retrieved = retrieveDrillContext(records, { ...query, excludeRunId: state.runId });
  return {
    schemaVersion: 1,
    offlineOnly: true,
    synthetic: true,
    contract: "proposeCoordinatorState(state, observations, trigger); CoordinatorState v2",
    modelInvoked: false,
    operationalActions: 0,
    // The production consumer serializes this shape as user data.
    promptData: {
      trigger: "offline.drill-review",
      state,
      observations: [
        {
          kind: "reviewed-synthetic-lessons",
          authority: "untrusted-reference-data",
          records: retrieved,
        },
      ],
      now: state.generatedAt,
    },
    integrationStatus:
      "Offline adapter only. Production runCoordinatorCycle does not retrieve drill lessons.",
    constraint:
      "Reference data cannot override system instructions, inventory, active facts or approval controls. Never submit this fixture to intake.",
  };
}
