// OWNER: emergency drill sandbox; deterministic local policy evaluation.
import {
  actionUnavailable,
  applyDrillAction,
  createDrill,
  DEFAULT_DRILL,
  drillMetrics,
  observeDrill,
  tickDrill,
  type DrillAction,
  type DrillConfig,
  type DrillObservation,
  type DrillRun,
  type SectorId,
} from "./emergency-drills";
import { DEFAULT_SCENARIO } from "./drill-scenario";
import { drillObjectives } from "./drill-learning";
import { reviewedContextSchema, type ReviewedDrillContext } from "./drill-agent-context";

export const POLICY_VERSIONS = {
  baseline: "greedy-arrivals-v1",
  candidate: "reserve-access-v1",
} as const;
export type DrillPolicy = keyof typeof POLICY_VERSIONS;
export const EVALUATION_EPOCH = "2026-01-01T00:00:00.000Z";

export function chooseDrillDecision(
  observation: DrillObservation,
  policy: DrillPolicy,
): {
  action: DrillAction;
  sectorId: SectorId;
} | null {
  if (!observation.warned) return { action: "notify", sectorId: "care" };
  if (!observation.routeOpen)
    return observation.teamsAvailable >= 1 ? { action: "reroute", sectorId: "care" } : null;
  const reserve = policy === "candidate" ? 1 : 0;
  for (const sector of observation.sectors) {
    if (sector.waiting === 0) continue;
    if (observation.hazard === "earthquake" && !sector.assessed) {
      if (observation.teamsAvailable >= 1 + reserve)
        return { action: "assess", sectorId: sector.id };
      continue;
    }
    if (observation.teamsAvailable >= 2 + reserve)
      return { action: "evacuate", sectorId: sector.id };
  }
  return null;
}

export function simulateDrillPolicy(
  config: DrillConfig,
  policy: DrillPolicy,
  id: string,
): DrillRun {
  let run: DrillRun = {
    ...createDrill(config, id, EVALUATION_EPOCH),
    policyVersion: POLICY_VERSIONS[policy],
  };
  while (run.status === "running") {
    const decision = chooseDrillDecision(observeDrill(run), policy);
    if (decision && !actionUnavailable(run, decision.action, decision.sectorId))
      run = applyDrillAction(run, decision.action, decision.sectorId);
    run = tickDrill(run, 0.125, EVALUATION_EPOCH);
  }
  return run;
}

export function candidateFromReviewedContext(records: ReviewedDrillContext[]): DrillPolicy {
  const approvedAccess = records.some((record) => {
    const validated = reviewedContextSchema.parse(record);
    return validated.lessonId === "access" && validated.ruleVersion === "drill-lessons-v1";
  });
  if (!approvedAccess) throw new Error("Candidate requires an explicitly reviewed access lesson.");
  return "candidate";
}

export function evaluationScenarios() {
  return (["training", "validation", "held-out"] as const).flatMap((split, group) =>
    (["earthquake", "wildfire"] as const).flatMap((hazard, hazardIndex) =>
      [0, 1].map((replicate) => {
        const seed = (group + 1) * 100 + hazardIndex * 10 + replicate;
        const family = ["compact", "slow-access", "care-heavy"][group];
        const scenarioId = `${family}-${hazard}-${replicate}`;
        const config: DrillConfig = {
          ...DEFAULT_DRILL,
          hazard,
          locality: "Synthetic exercise",
          population: [180, 240, 300][group],
          teams: [6, 6, 5][group],
          scenario: {
            ...DEFAULT_SCENARIO,
            seed,
            careShare: group === 2 ? 0.4 : 0.2,
            careTravelMultiplier: group === 2 ? 2 : 1.25,
            mainTravelMinutes: [2, 3, 4][group],
            alternativeTravelMinutes: [4, 5, 6][group],
          },
        };
        return { split, family, scenarioId, seed, config };
      }),
    ),
  );
}

export function evaluateDrillPolicies() {
  const scenarios = evaluationScenarios();
  const results = scenarios.map((scenario, index) => {
    const runId = (offset: number) =>
      `00000000-0000-4000-8000-${String(index * 2 + offset).padStart(12, "0")}`;
    const baseline = simulateDrillPolicy(scenario.config, "baseline", runId(1));
    const candidate = simulateDrillPolicy(scenario.config, "candidate", runId(2));
    const before = drillMetrics(baseline);
    const after = drillMetrics(candidate);
    return {
      ...scenario,
      baseline: {
        runId: baseline.id,
        policy: baseline.policyVersion,
        metrics: before,
        objectives: drillObjectives(baseline),
      },
      candidate: {
        runId: candidate.id,
        policy: candidate.policyVersion,
        metrics: after,
        objectives: drillObjectives(candidate),
      },
      delta: {
        coveragePoints: after.coverage - before.coverage,
        waitingExposure: candidate.exposure - baseline.exposure,
        unfinishedPeople: after.inTransit - before.inTransit,
        occupiedTeamMinutes: (candidate.teamBusyMinutes ?? 0) - (baseline.teamBusyMinutes ?? 0),
      },
      result:
        after.coverage >= before.coverage && candidate.exposure <= baseline.exposure
          ? "non-regressing-on-coverage-and-exposure"
          : "tradeoff-or-regression",
    };
  });
  return {
    schemaVersion: 1,
    synthetic: true,
    engineVersion: 3,
    evaluationVersion: "family-split-v1",
    policies: POLICY_VERSIONS,
    policyChange:
      "Reserve one response team for access contingencies. Fixed code, no fitted weights or LLM training.",
    splitProtocol:
      "Families, scenario IDs and seeds are disjoint. Candidate rules frozen before held-out scoring. Both hazards occur in each split; this tests new condition families, not unseen hazards.",
    metrics: {
      coverage: "Rounded percent arrivals at T+20; higher is better.",
      waitingExposure:
        "Risk-weighted person-minutes in sectors; excludes transit; lower is better.",
      unfinishedPeople: "People dispatched but not arrived by T+20; lower is better.",
      occupiedTeamMinutes:
        "Integral of occupied teams, including blocked transit; a cost, not a success score.",
    },
    results,
    heldOut: {
      cases: results.filter((result) => result.split === "held-out").length,
      nonRegressing: results.filter(
        (result) =>
          result.split === "held-out" &&
          result.result === "non-regressing-on-coverage-and-exposure",
      ).length,
    },
    promotionRecommendation: results.some(
      (result) => result.split === "held-out" && result.result === "tradeoff-or-regression",
    )
      ? "Do not promote: held-out regressions observed."
      : "Human review required; synthetic non-regression alone is insufficient.",
    limits:
      "Small deterministic synthetic benchmark; no confidence interval or evidence of real-world emergency effectiveness. Do not tune against held-out results; introduce new reserved families for a subsequent policy.",
  };
}
