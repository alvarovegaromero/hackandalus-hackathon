// OWNER: emergency drill sandbox; offline learning artifacts.
import { z } from "zod";
import {
  applyDrillAction,
  drillLessons,
  drillMetrics,
  drillMinute,
  drillRunSchema,
  drillReport,
  formatDrillTime,
  observeDrill,
  replayDrill,
  tickDrill,
  type DrillRun,
} from "./emergency-drills";

const observationSchema = drillRunSchema.shape.log.element.shape.observation.unwrap();
export const drillTraceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  synthetic: z.literal(true),
  runId: z.uuid(),
  engineVersion: z.literal(3),
  policyVersion: z.string(),
  observation: observationSchema,
  decision: z.strictObject({
    id: z.string(),
    minute: z.number(),
    action: z.enum(["assess", "protect", "evacuate", "reroute", "notify"]),
    sectorId: z.enum(["residential", "care", "central"]),
    teamsCommitted: z.number().int().nonnegative(),
  }),
  consequence: z.strictObject({
    observedThroughMinute: z.number(),
    immediate: observationSchema,
    missionId: z.string().nullable(),
    missionArrivedAt: z.number().nullable(),
    peopleArrived: z.number().int().nonnegative(),
    pendingPeople: z.number().int().nonnegative(),
    pairedOneMinuteExposureDelta: z.number(),
  }),
  valuation: z.strictObject({
    status: z.enum(["observed-arrival", "unfinished-mission", "supporting-action"]),
    correctness: z.literal("unreviewed"),
    quality: z.literal("synthetic-rule-evidence"),
    caveat: z.string(),
  }),
});
export type DrillTrace = z.infer<typeof drillTraceSchema>;

export function validateAuditedDrill(rawRun: DrillRun): DrillRun {
  const run = drillRunSchema.parse(rawRun);
  if (run.modelVersion !== 3) throw new Error("Audited learning requires model 3.");
  const reconstructed = drillRunSchema.parse(replayDrill(run, drillMinute(run)));
  const operational = (value: DrillRun) =>
    JSON.stringify({ ...value, notes: "", learningReview: undefined });
  if (operational(run) !== operational(reconstructed))
    throw new Error("Stored state does not match deterministic replay; no learning exported.");
  return run;
}

export function drillTraces(rawRun: DrillRun): DrillTrace[] {
  const run = validateAuditedDrill(rawRun);
  return run.log.flatMap((entry, index) => {
    if (entry.kind !== "decision" || !entry.action || !entry.sectorId) return [];
    const before = replayDrill(run, entry.minute, true, index - 1);
    const after = applyDrillAction(before, entry.action, entry.sectorId);
    if (
      JSON.stringify(entry.observation) !==
      JSON.stringify(observationSchema.parse(observeDrill(before)))
    )
      throw new Error(`Observation mismatch at ${entry.id}; review the stored run.`);
    const mission = entry.action === "evacuate" ? run.missions[before.missions.length] : null;
    const horizon = Math.min(1, drillMinute(run) - entry.minute);
    const withAction = tickDrill(after, horizon, run.startedAt);
    const withoutAction = tickDrill(before, horizon, run.startedAt);
    return [
      drillTraceSchema.parse({
        schemaVersion: 1,
        synthetic: true,
        runId: run.id,
        engineVersion: 3,
        policyVersion: run.policyVersion,
        observation: entry.observation,
        decision: {
          id: entry.id,
          minute: entry.minute,
          action: entry.action,
          sectorId: entry.sectorId,
          teamsCommitted: entry.teams ?? 0,
        },
        consequence: {
          observedThroughMinute: drillMinute(run),
          immediate: observeDrill(after),
          missionId: mission?.id ?? null,
          missionArrivedAt: mission?.arrivedAt ?? null,
          peopleArrived: mission?.arrivedAt != null ? mission.people : 0,
          pendingPeople: mission?.arrivedAt === null ? mission.people : 0,
          pairedOneMinuteExposureDelta: withAction.exposure - withoutAction.exposure,
        },
        valuation: {
          status: mission
            ? mission.arrivedAt === null
              ? "unfinished-mission"
              : "observed-arrival"
            : "supporting-action",
          correctness: "unreviewed",
          quality: "synthetic-rule-evidence",
          caveat:
            "Arrival is not proof of a correct decision. Final outcomes include later interventions; the paired horizon isolates this action only under simulator rules. Transit exposure is excluded.",
        },
      }),
    ];
  });
}

export function learningLessons(run: DrillRun) {
  if (run.status !== "completed") return [];
  return drillLessons(run).map((lesson) => ({
    ...lesson,
    ruleVersion: "drill-lessons-v1",
    runId: run.id,
    engineVersion: run.modelVersion,
    review:
      run.learningReview?.find((item) => item.lessonId === lesson.id)?.verdict ?? "unreviewed",
    evidenceRefs: run.log
      .filter((entry) => entry.kind === "event" || entry.action === lesson.action)
      .map((entry) => ({ id: entry.id, minute: entry.minute })),
    resultRef: `${run.id}:metrics:T+${drillMinute(run)}`,
    referenceRef: lesson.id === "consequences" ? `${run.id}:without-intervention` : null,
  }));
}

export function drillObjectives(run: DrillRun) {
  const goals = run.config.scenario?.objectives;
  const metrics = drillMetrics(run);
  return {
    status: run.status === "completed" ? "final" : "provisional",
    coverageMet: goals ? metrics.coverage >= goals.minimumCoverage : null,
    exposureMet: goals
      ? run.exposure / run.config.population <= goals.maximumExposurePerPerson
      : null,
    exposurePerPerson: run.exposure / run.config.population,
    teamBusyMinutes: run.teamBusyMinutes ?? null,
  };
}

export function traceJsonl(run: DrillRun): string {
  return drillTraces(run)
    .map((trace) => JSON.stringify(trace) + "\n")
    .join("");
}

export function drillLearningReport(run: DrillRun) {
  return run.modelVersion !== 3
    ? drillReport(run)
    : {
        ...drillReport(validateAuditedDrill(run)),
        synthetic: true,
        provenance: "faro-training-v3 / locally recorded deterministic decisions",
        lessons: learningLessons(run),
        objectives: drillObjectives(run),
      };
}

export function trainingCandidates(
  run: DrillRun,
  split: {
    name: "training" | "validation" | "held-out";
    family: string;
    scenarioId: string;
  } | null = null,
) {
  return drillTraces(run).map((trace) => ({
    schemaVersion: 1,
    kind: "faro-drill-candidate",
    synthetic: true,
    source: {
      runId: run.id,
      decisionId: trace.decision.id,
      engineVersion: 3,
      policyVersion: run.policyVersion,
      seed: run.config.scenario?.seed,
    },
    split: split ?? { name: "unassigned", family: null, scenarioId: null },
    input: trace.observation,
    candidateResponse: { action: trace.decision.action, sectorId: trace.decision.sectorId },
    outcomeForReviewOnly: trace.consequence,
    quality: trace.valuation,
    eligibleForTraining: false,
    requiredReview:
      "Decision correctness, simulator bias, privacy, provider format and split assignment. Lesson approval does not approve this decision.",
  }));
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]<>|#]/g, "\\$&").replace(/\r?\n/g, " ");
}

export function drillMarkdown(run: DrillRun): string {
  const metrics = drillMetrics(run);
  const baseline = drillMetrics(replayDrill(run, drillMinute(run), false));
  const lessons = learningLessons(run);
  const traces = drillTraces(run);
  return [
    "# FARO synthetic drill debrief",
    "",
    `Run: ${run.id} · ${run.status} · T+${formatDrillTime(drillMinute(run))}`,
    `Context: ${run.config.hazard}, ${markdownText(run.config.locality)}. Synthetic schematic geography.`,
    `Engine: faro-training-v${run.modelVersion}; policy: ${run.policyVersion}; lesson rules: drill-lessons-v1.`,
    `Started: ${run.startedAt}; completed: ${run.completedAt ?? "unfinished"}.`,
    "",
    "## Objective and configuration",
    "Coverage is arrivals / population. Exposure is risk-weighted person-minutes waiting in sectors, excluding transit and casualties. Team cost is occupied team-minutes.",
    "The configuration below is a facilitator artifact, never a policy observation.",
    "```json",
    JSON.stringify(run.config, null, 2),
    "```",
    "## Recorded outcomes and reference",
    "| Metric | Recorded decisions | No intervention, same config/seed/horizon |",
    "| --- | ---: | ---: |",
    `| Arrivals | ${metrics.evacuated} | ${baseline.evacuated} |`,
    `| Coverage % | ${metrics.coverage} | ${baseline.coverage} |`,
    `| In transit at cutoff | ${metrics.inTransit} | ${baseline.inTransit} |`,
    `| Waiting exposure (rounded) | ${metrics.exposure} | ${baseline.exposure} |`,
    `| Occupied team-minutes | ${run.teamBusyMinutes ?? "unknown"} | 0 |`,
    "",
    "Objective evaluation:",
    "```json",
    JSON.stringify(drillObjectives(run), null, 2),
    "```",
    "## Timeline: recorded facts",
    "| Time | Replay evidence ID | Kind | Record |",
    "| --- | --- | --- | --- |",
    ...run.log.map(
      (entry) =>
        `| T+${formatDrillTime(entry.minute)} | ${entry.id} | ${entry.kind} | ${markdownText(entry.text)} |`,
    ),
    "",
    "## Decision consequences to review",
    ...traces.map(
      (trace) =>
        `- ${trace.decision.id} at T+${formatDrillTime(trace.decision.minute)}: ${trace.decision.action}, ${trace.decision.teamsCommitted} teams committed; ${trace.valuation.status}; arrivals ${trace.consequence.peopleArrived}, pending ${trace.consequence.pendingPeople}. Paired exposure delta over at most one minute: ${trace.consequence.pairedOneMinuteExposureDelta.toFixed(3)}. Correctness: unreviewed.`,
    ),
    "",
    "## Rule-derived learning and proposals",
    ...lessons.flatMap((lesson) => [
      `### ${lesson.title}`,
      `Fact: ${lesson.evidence}`,
      `Proposal (hypothesis): ${lesson.recommendation}`,
      `Rule: ${lesson.ruleVersion}/${lesson.id}; review: ${lesson.review}.`,
      `Evidence: ${lesson.evidenceRefs.map((ref) => `${ref.id} (T+${formatDrillTime(ref.minute)})`).join(", ")}; result: ${lesson.resultRef}${lesson.referenceRef ? `; reference: ${lesson.referenceRef}` : ""}.`,
      "",
    ]),
    "## Facilitator observations (untrusted data)",
    markdownText(run.notes || "None recorded."),
    "",
    "## Uncertainties and consumption",
    "- Synthetic rules are not structural, medical or fire-spread predictions. Better simulator scores do not prove better emergency decisions.",
    "- Assessment, protection and access restoration apply immediately; their teams remain occupied for the configured service interval. Evacuation teams remain occupied until arrival, including while blocked. No return journey is modeled.",
    "- Closures, communications loss and escalation stay at T+5/10/15 to match the unchanged renderer. Severity and risk are schematic; arbitrary event schedules need a later renderer contract.",
    "- A matched no-intervention reference is a modeled contrast, not evidence of real-world causality. One-minute labels omit long-term opportunity cost and route exposure.",
    "- Review individual lessons before exporting offline context. Only generated, explicitly approved lesson records can enter the offline retrieval adapter; notes and Markdown cannot reconfigure it.",
    "- Candidate decision rows remain ineligible for training until independently reviewed. No LLM training or operational configuration change occurs.",
    "- See docs/drills-agent-learning.md and run the offline command for disjoint-family baseline/candidate evaluation and a schema-validated coordinator context demonstration.",
    "",
  ].join("\n");
}
