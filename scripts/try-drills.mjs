// On-demand synthetic drill verification and artifact generation. No network or providers.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const args = process.argv.slice(2);
const allowed = ["--out", "--run", "--demo-review"];
if (args.includes("--help")) {
  console.log("npm run drills:try -- [--out directory] [--run report.json] [--demo-review]");
  process.exit(0);
}
for (let index = 0; index < args.length; index++) {
  if (!allowed.includes(args[index])) throw new Error(`Unknown argument ${args[index]}`);
  if (args[index] !== "--demo-review") {
    if (!args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error("Missing argument value");
    index++;
  }
}
const argument = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const out = resolve(argument("--out") ?? ".data/drills-learning");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        fileName: fileURLToPath(url),
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const engine = await import("../src/lib/emergency-drills.ts");
const learning = await import("../src/lib/drill-learning.ts");
const evaluation = await import("../src/lib/drill-evaluation.ts");
const adapter = await import("../src/lib/drill-agent-context.ts");
const scenario = await import("../src/lib/drill-scenario.ts");
const contracts = await import("../src/lib/contracts/coordinator.ts");
const storage = await import("../src/lib/drill-storage.ts");
hooks.deregister();
const at = evaluation.EVALUATION_EPOCH;
const id = "00000000-0000-4000-8000-000000000090";
const results = [];
function verify(name, check) {
  check();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
const scenarios = evaluation.evaluationScenarios();
verify("disjoint scenario IDs, seeds and condition families across splits", () => {
  for (const field of ["scenarioId", "seed", "family"]) {
    for (const left of scenarios)
      for (const right of scenarios)
        if (left.split !== right.split) assert.notEqual(left[field], right[field]);
  }
});
verify("scenario schema rejects incompatible timelines, bounds and fractional travel", () => {
  const config = scenario.DEFAULT_SCENARIO;
  assert.equal(scenario.drillScenarioSchema.safeParse({ ...config, seed: -1 }).success, false);
  assert.equal(
    scenario.drillScenarioSchema.safeParse({ ...config, careShare: 0.8 }).success,
    false,
  );
  assert.equal(
    scenario.drillScenarioSchema.safeParse({ ...config, mainTravelMinutes: 2.2 }).success,
    false,
  );
  assert.equal(
    scenario.drillScenarioSchema.safeParse({
      ...config,
      events: { ...config.events, roadClosureMinute: 4 },
    }).success,
    false,
  );
});
verify("deterministic policies, byte-stable evaluation and exact replay for both hazards", () => {
  for (const item of scenarios) {
    for (const policy of ["baseline", "candidate"]) {
      const run = evaluation.simulateDrillPolicy(item.config, policy, id);
      assert.deepEqual(run, evaluation.simulateDrillPolicy(item.config, policy, id));
      learning.validateAuditedDrill(run);
      assert.deepEqual(
        engine.drillRunSchema.parse(run),
        engine.drillRunSchema.parse(engine.replayDrill(run, 20)),
      );
    }
  }
  assert.deepEqual(evaluation.evaluateDrillPolicies(), evaluation.evaluateDrillPolicies());
});
verify(
  "occupied teams persist across closure; reroute, arrival and service release conserve resources",
  () => {
    let run = engine.createDrill({ ...engine.DEFAULT_DRILL, hazard: "wildfire", teams: 3 }, id, at);
    run = engine.tickDrill(run, 4, at);
    run = engine.applyDrillAction(run, "evacuate", "care");
    run = engine.tickDrill(run, 1, at);
    const progress = run.missions[0].progress;
    assert.equal(run.teamsAvailable, 1);
    assert.equal(run.routeOpen, false);
    run = engine.tickDrill(run, 0.5, at);
    assert.equal(run.missions[0].progress, progress);
    run = engine.applyDrillAction(run, "reroute", "care");
    assert.equal(run.teamsAvailable, 0);
    assert.equal(run.missions[0].route, "alternative");
    assert.equal(run.missions[0].progress, 0);
    run = engine.tickDrill(run, 1, at);
    assert.equal(run.teamsAvailable, 1);
    run = engine.tickDrill(run, 5, at);
    assert.equal(run.teamsAvailable, 3);
    assert.notEqual(run.missions[0].arrivedAt, null);
    assert.equal(engine.drillMetrics(run).evacuated, run.missions[0].people);
    learning.validateAuditedDrill(run);
  },
);
verify("all configurable effects change their intended modeled consequence", () => {
  const config = {
    ...engine.DEFAULT_DRILL,
    hazard: "wildfire",
    scenario: scenario.DEFAULT_SCENARIO,
  };
  const make = (changes) =>
    engine.createDrill({ ...config, scenario: { ...config.scenario, ...changes } }, id, at);
  assert.notDeepEqual(make({ seed: 1 }).sectors, make({ seed: 2 }).sectors);
  assert.notEqual(
    make({ careShare: 0.1 }).sectors[1].population,
    make({ careShare: 0.4 }).sectors[1].population,
  );
  for (const [key, lower, upper, minute, sectorId] of [
    ["mainTravelMinutes", 2, 4, 0, "residential"],
    ["alternativeTravelMinutes", 4, 6, 5, "residential"],
    ["careTravelMultiplier", 1, 2, 0, "care"],
  ]) {
    const dispatch = (value) => {
      let run = engine.tickDrill(make({ [key]: value }), minute, at);
      if (!run.routeOpen) run = engine.applyDrillAction(run, "reroute", sectorId);
      return engine.applyDrillAction(run, "evacuate", sectorId).missions[0].travelMinutes;
    };
    assert.ok(dispatch(lower) < dispatch(upper));
  }
  const service = (serviceMinutes) =>
    engine.tickDrill(engine.applyDrillAction(make({ serviceMinutes }), "protect", "care"), 1, at);
  assert.ok(service(0.5).teamsAvailable > service(2).teamsAvailable);
  const network = (unbriefedCapacityMultiplier) => {
    let run = engine.tickDrill(
      make({ events: { ...config.scenario.events, unbriefedCapacityMultiplier } }),
      10,
      at,
    );
    run = engine.applyDrillAction(run, "reroute", "care");
    return engine.applyDrillAction(run, "evacuate", "care").missions[0].people;
  };
  assert.ok(network(0.5) < network(1));
  const escalated = (escalationRisk) =>
    engine.tickDrill(make({ events: { ...config.scenario.events, escalationRisk } }), 15, at);
  assert.ok(escalated(5).sectors[0].risk < escalated(25).sectors[0].risk);
  const protectedRun = engine.tickDrill(
    engine.applyDrillAction(make({}), "protect", "care"),
    15,
    at,
  );
  assert.ok(protectedRun.sectors[1].risk < escalated(10).sectors[1].risk);
  assert.equal(
    learning.drillObjectives(
      make({ objectives: { minimumCoverage: 0, maximumExposurePerPerson: 20 } }),
    ).coverageMet,
    true,
  );
  assert.equal(learning.drillObjectives(make({})).coverageMet, false);
});
verify("partial tick batching, decision observations and tamper rejection", () => {
  const run = engine.createDrill(engine.DEFAULT_DRILL, id, at);
  assert.deepEqual(learning.learningLessons(run), []);
  assert.deepEqual(learning.drillLearningReport(run).lessons, []);
  assert.deepEqual(
    engine.tickDrill(run, 7.5, at),
    engine.tickDrill(engine.tickDrill(run, 3.25, at), 4.25, at),
  );
  const full = evaluation.simulateDrillPolicy(scenarios[0].config, "candidate", id);
  assert.deepEqual(
    engine.comparableDrills(
      {
        ...full.config,
        scenario: { ...full.config.scenario, seed: Number.NaN },
      },
      [full],
    ),
    [],
  );
  const traces = learning.drillTraces(full);
  assert.ok(traces.length > 0);
  for (const trace of traces) {
    learning.drillTraceSchema.parse(trace);
    assert.equal(trace.observation.minute, trace.decision.minute);
    for (const ref of trace.observation.eventIds)
      assert.ok(full.log.find((entry) => entry.id === ref).minute <= trace.decision.minute);
    assert.equal("seed" in trace.observation, false);
    assert.equal("config" in trace.observation, false);
    assert.equal(trace.valuation.correctness, "unreviewed");
  }
  assert.throws(() => learning.drillTraces({ ...full, exposure: full.exposure + 1 }));
  const bad = structuredClone(full);
  bad.log.find((entry) => entry.kind === "decision").observation.minute = 20;
  assert.throws(() => learning.drillTraces(bad));
});
verify("legacy notebook versions remain readable and model semantics stay isolated", () => {
  for (const modelVersion of [1, 2, 3]) {
    let run = engine.createDrill(
      { ...engine.DEFAULT_DRILL, hazard: "wildfire" },
      id,
      at,
      modelVersion,
    );
    run = engine.applyDrillAction(run, "evacuate", "care");
    assert.equal(engine.drillMetrics(run).evacuated > 0, modelVersion === 1);
    run = engine.tickDrill(run, 20, at);
    const notebook = storage.storeDrillRun(storage.EMPTY_NOTEBOOK, run);
    assert.equal(
      storage.readDrillNotebook(JSON.stringify(notebook)).history[0].modelVersion,
      modelVersion,
    );
    assert.equal(engine.comparableDrills(run.config, [run], modelVersion === 3 ? 2 : 3).length, 0);
  }
});

mkdirSync(out, { recursive: true });
const json = (name, value) =>
  writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + "\n");
const runs = ["earthquake", "wildfire"].map((hazard, index) => {
  const training = scenarios.find(
    (item) => item.split === "training" && item.config.hazard === hazard,
  );
  return evaluation.simulateDrillPolicy(
    training.config,
    "baseline",
    `00000000-0000-4000-8000-${String(91 + index).padStart(12, "0")}`,
  );
});
if (argument("--run")) {
  const imported = JSON.parse(readFileSync(resolve(argument("--run")), "utf8"));
  runs.push(engine.drillRunSchema.parse(imported.run ?? imported));
}
let reviewedRecords = [];
for (let run of runs) {
  verify(`${run.config.hazard} unreviewed/rejected lessons excluded`, () => {
    assert.equal(adapter.reviewedDrillContext({ ...run, learningReview: [] }).length, 0);
    assert.throws(() => evaluation.candidateFromReviewedContext([]));
    assert.equal(
      adapter.reviewedDrillContext({
        ...run,
        learningReview: [
          {
            lessonId: "access",
            verdict: "rejected",
            reviewedAt: at,
            reviewer: "synthetic-review-fixture",
          },
        ],
      }).length,
      0,
    );
  });
  if (args.includes("--demo-review") && !run.learningReview?.length) {
    run = {
      ...run,
      learningReview: [
        {
          lessonId: "access",
          verdict: "approved",
          reviewedAt: at,
          reviewer: "synthetic-review-fixture",
        },
      ],
    };
  }
  const stem = `${run.config.hazard}-${run.id}`;
  const sourceScenario = scenarios.find(
    (item) => JSON.stringify(item.config) === JSON.stringify(run.config),
  );
  const split = sourceScenario
    ? {
        name: sourceScenario.split,
        family: sourceScenario.family,
        scenarioId: sourceScenario.scenarioId,
      }
    : null;
  json(`${stem}.json`, learning.drillLearningReport(run));
  writeFileSync(resolve(out, `${stem}.md`), learning.drillMarkdown(run));
  writeFileSync(resolve(out, `${stem}-traces.jsonl`), learning.traceJsonl(run));
  writeFileSync(
    resolve(out, `${stem}-candidates.jsonl`),
    learning
      .trainingCandidates(run, split)
      .map((row) => JSON.stringify(row) + "\n")
      .join(""),
  );
  reviewedRecords.push(...adapter.reviewedDrillContext(run));
  assert.equal(
    learning.traceJsonl(run).trim().split("\n").filter(Boolean).length,
    learning.drillTraces(run).length,
  );
}
json("reviewed-context.json", reviewedRecords);
const evaluationResult = evaluation.evaluateDrillPolicies();
json("evaluation.json", evaluationResult);
json("trace.schema.json", z.toJSONSchema(learning.drillTraceSchema));
json("reviewed-context.schema.json", z.toJSONSchema(adapter.reviewedContextSchema));
json("scenario.schema.json", z.toJSONSchema(scenario.drillScenarioSchema));

const eventId = "00000000-0000-4000-8000-000000000099";
const query = {
  hazard: reviewedRecords[0]?.hazard ?? "earthquake",
  severity: reviewedRecords[0]?.severity ?? "severe",
};
const input = contracts.coordinatorInputSchema.parse({
  report: {
    id: eventId,
    runId: id,
    source: "scenario",
    channel: "offline-drill-fixture",
    receivedAt: at,
    text: `Synthetic observed ${query.hazard}. Main access is blocked. No live emergency.`,
    extracted: { category: query.hazard },
  },
});
const state = contracts.coordinatorStateSchema.parse({
  schemaVersion: 2,
  stateId: "00000000-0000-4000-8000-000000000098",
  runId: id,
  revision: 0,
  updatedAt: at,
  generatedAt: at,
  storage: "supabase",
  executionMode: "simulation",
  pollAfterMs: 3000,
  situationOverview: input.report.text,
  plan: null,
  events: [
    { eventId, summary: input.report.text, status: "active", priority: null, rationale: null },
  ],
  ambulances: {
    total: 10,
    available: 10,
    allocated: 0,
    units: Array.from({ length: 10 }, (_, index) => ({
      id: `ambulance-${index + 1}`,
      status: "available",
      eventId: null,
    })),
  },
});
const context = adapter.buildOfflineCoordinatorContext(state, reviewedRecords, query);
const proposal = contracts.validateCoordinatorProposal(state, {
  basedOnRevision: state.revision,
  situationOverview: state.situationOverview,
  plan: {
    objective: "Offline human review of access contingencies",
    steps: ["Review synthetic access lesson evidence before any operational proposal."],
  },
  priorities: [
    {
      eventId,
      priority: "medium",
      rationale: "Synthetic proposal fixture; not an agent judgment or real urgency assessment.",
    },
  ],
  assignments: [],
});
verify("offline input, state and proposal use current coordinator schemas; no assignments", () => {
  contracts.coordinatorInputSchema.parse(input);
  contracts.coordinatorStateSchema.parse(context.promptData.state);
  assert.equal(proposal.assignments.length, 0);
  assert.equal(context.operationalActions, 0);
  assert.equal(context.modelInvoked, false);
  assert.throws(() =>
    contracts.validateCoordinatorProposal(state, { ...proposal, basedOnRevision: 1 }),
  );
  assert.deepEqual(
    adapter.retrieveDrillContext(
      reviewedRecords.map((record) => ({ ...record, severity: "severe" })),
      {
        hazard: "earthquake",
        severity: "moderate",
        excludeRunId: id,
      },
    ),
    [],
  );
});
if (reviewedRecords.length) {
  verify("reviewed access selects frozen candidate; retrieval excludes the target run", () => {
    if (reviewedRecords.some((record) => record.lessonId === "access"))
      assert.equal(evaluation.candidateFromReviewedContext(reviewedRecords), "candidate");
    else assert.throws(() => evaluation.candidateFromReviewedContext(reviewedRecords));
    assert.ok(context.promptData.observations[0].records.length > 0);
    assert.equal(
      adapter
        .retrieveDrillContext(reviewedRecords, {
          hazard: reviewedRecords[0].hazard,
          severity: reviewedRecords[0].severity,
          excludeRunId: reviewedRecords[0].sourceRunId,
        })
        .some((record) => record.sourceRunId === reviewedRecords[0].sourceRunId),
      false,
    );
  });
}
json("offline-coordinator-demo.json", {
  ...context,
  input,
  proposalFixture: proposal,
  syntheticReviewFixture: args.includes("--demo-review"),
  storageCaveat:
    "The literal supabase is required by the state contract; this fixture is never stored or submitted.",
});
json("verification.json", {
  schemaVersion: 1,
  synthetic: true,
  platform: process.platform,
  node: process.version,
  results,
  networkCalls: 0,
});
console.log(
  JSON.stringify({
    out,
    checks: results.length,
    heldOut: evaluationResult.heldOut,
    reviewedContexts: reviewedRecords.length,
  }),
);
