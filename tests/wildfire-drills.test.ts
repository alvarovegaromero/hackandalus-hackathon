import { describe, expect, it } from "vitest";
import {
  actionUnavailable,
  applyDrillAction,
  createDrill,
  DEFAULT_WILDFIRE_DRILL,
  drillMetrics,
  replayDrill,
  tickDrill,
  type DrillRun,
} from "../src/lib/emergency-drills";
import { reviewedDrillBriefing } from "../src/lib/drill-agent-context";
import { evaluateDrillPolicies } from "../src/lib/drill-evaluation";
import { validateAuditedDrill } from "../src/lib/drill-learning";
import { EMPTY_NOTEBOOK, readDrillNotebook, storeDrillRun } from "../src/lib/drill-storage";

const firstId = "00000000-0000-4000-8000-000000000101";
const secondId = "00000000-0000-4000-8000-000000000102";
const firstAt = "2026-01-01T00:00:00.000Z";
const secondAt = "2026-01-02T00:00:00.000Z";

function completed(id = firstId, startedAt = firstAt): DrillRun {
  return tickDrill(createDrill(DEFAULT_WILDFIRE_DRILL, id, startedAt), 20, startedAt);
}

function reviewed(run: DrillRun): DrillRun {
  return {
    ...run,
    learningReview: [
      {
        lessonId: "access",
        verdict: "approved",
        reviewer: "local-facilitator",
        reviewedAt: run.completedAt!,
      },
    ],
  };
}

describe("wildfire rehearsal and reviewed memory", () => {
  it("dispatches without assessment, freezes on closure, reroutes and conserves teams", () => {
    let run = createDrill({ ...DEFAULT_WILDFIRE_DRILL, teams: 3 }, firstId, firstAt);
    run = tickDrill(run, 4, firstAt);
    expect(actionUnavailable(run, "evacuate", "residential")).toBeNull();
    run = applyDrillAction(run, "evacuate", "residential");
    run = tickDrill(run, 1, firstAt);
    expect(run.routeOpen).toBe(false);
    expect(run.teamsAvailable).toBe(1);
    const progress = run.missions[0].progress;
    run = tickDrill(run, 1, firstAt);
    expect(run.missions[0].progress).toBe(progress);
    run = applyDrillAction(run, "reroute", "residential");
    expect(run.missions[0].reroutedFrom).toBe(progress);
    expect(run.teamsAvailable).toBe(0);
    run = tickDrill(run, 14, firstAt);
    expect(drillMetrics(run).evacuated).toBe(70);
    expect(drillMetrics(run).inTransit).toBe(0);
    expect(run.teamsAvailable).toBe(3);
    expect(validateAuditedDrill(run)).toEqual(run);
    expect(replayDrill(run, 20)).toEqual(run);
  });

  it("explains an unrecoverable allocation instead of promising a blocked arrival", () => {
    let run = createDrill({ ...DEFAULT_WILDFIRE_DRILL, teams: 2 }, firstId, firstAt);
    run = applyDrillAction(tickDrill(run, 4, firstAt), "evacuate", "care");
    run = tickDrill(run, 1, firstAt);
    expect(actionUnavailable(run, "reroute", "care")).toContain("held on the blocked route");
    const final = tickDrill(run, 15, firstAt);
    expect(drillMetrics(final).inTransit).toBe(70);
    expect(final.teamsAvailable).toBe(0);
    expect(validateAuditedDrill(final)).toEqual(final);
  });

  it("carries only facilitator-approved evidence through storage into the next rehearsal", () => {
    const source = reviewed(completed());
    source.learningReview!.push({
      lessonId: "communications",
      verdict: "rejected",
      reviewer: "local-facilitator",
      reviewedAt: firstAt,
    });
    source.notes = "Unreviewed free text must not become an approved rule.";
    const saved = readDrillNotebook(JSON.stringify(storeDrillRun(EMPTY_NOTEBOOK, source)));
    const next = createDrill(source.config, secondId, secondAt);
    const briefing = reviewedDrillBriefing(next.config, saved.history, next);
    expect(briefing.skippedRunIds).toEqual([]);
    expect(briefing.records).toHaveLength(1);
    expect(briefing.records[0]).toMatchObject({
      lessonId: "access",
      sourceRunId: firstId,
      authority: "untrusted-reference-data",
    });
    expect(briefing.records[0].evidenceRefs.length).toBeGreaterThan(0);
    expect(JSON.stringify(briefing)).not.toContain(source.notes);
    expect(
      reviewedDrillBriefing(source.config, [{ ...source, learningReview: [] }]).records,
    ).toEqual([]);
  });

  it("excludes self, later runs, different scenarios, legacy models and demo approvals", () => {
    const source = reviewed(completed());
    const later = reviewed(completed(secondId, secondAt));
    expect(reviewedDrillBriefing(source.config, [source, later], source).records).toEqual([]);
    expect(reviewedDrillBriefing({ ...source.config, population: 800 }, [source]).records).toEqual(
      [],
    );
    expect(
      reviewedDrillBriefing(
        {
          ...source.config,
          scenario: { ...source.config.scenario!, seed: 999 },
        },
        [source],
      ).records,
    ).toEqual([]);
    const legacy = tickDrill(createDrill(DEFAULT_WILDFIRE_DRILL, firstId, firstAt, 2), 20, firstAt);
    expect(reviewedDrillBriefing(source.config, [legacy]).records).toEqual([]);
    expect(reviewedDrillBriefing(legacy.config, [source], legacy).records).toEqual([]);
    source.learningReview![0].reviewer = "synthetic-review-fixture";
    expect(reviewedDrillBriefing(source.config, [source]).records).toEqual([]);
  });

  it("fails closed on altered outcomes and keeps the newest approved source per lesson", () => {
    const older = reviewed(completed());
    const newer = reviewed(completed(secondId, secondAt));
    const records = reviewedDrillBriefing(newer.config, [older, newer]).records;
    expect(records).toHaveLength(1);
    expect(records[0].sourceRunId).toBe(secondId);
    const altered = { ...newer, exposure: newer.exposure + 10 };
    const briefing = reviewedDrillBriefing(newer.config, [altered]);
    expect(briefing.records).toEqual([]);
    expect(briefing.skippedRunIds).toEqual([secondId]);
  });

  it("scopes the frozen evaluation to wildfire without changing cases or outcomes", () => {
    const full = evaluateDrillPolicies();
    const wildfire = evaluateDrillPolicies("wildfire");
    expect(wildfire.hazardScope).toBe("wildfire");
    expect(wildfire.results).toEqual(
      full.results.filter((result) => result.config.hazard === "wildfire"),
    );
    expect(wildfire.results).toHaveLength(6);
    expect(wildfire.heldOut).toEqual({ cases: 2, nonRegressing: 2 });
    expect(wildfire.promotionRecommendation).toContain("Human review required");
    expect(
      wildfire.results
        .filter((result) => result.split === "held-out")
        .every((result) => result.delta.coveragePoints === 0),
    ).toBe(true);
  });
});
