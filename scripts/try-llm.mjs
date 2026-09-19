// On-demand backend exercise. --with-jev chains real P2 -> P3 -> P4.
// No HTTP intake, frontend, live tools, persistence adapter, hooks or automated tests.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run llm:try -- [--with-jev] [--limit 1..9] [--available 0..10] [--dry-run]",
  );
  console.log(
    "Runs a bounded agent with mock tools. --with-jev adds real filtering and saves .data/pipeline-smoke-results.json; otherwise saves .data/llm-smoke-results.json.",
  );
  process.exit(0);
}
let limit;
let dryRun = false;
let withJev = false;
let available = 10;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") dryRun = true;
  else if (args[i] === "--with-jev") withJev = true;
  else if (args[i] === "--available" && /^(10|[0-9])$/.test(args[i + 1] ?? ""))
    available = Number(args[++i]);
  else if (args[i] === "--limit" && /^[1-9]$/.test(args[i + 1] ?? "")) limit = Number(args[++i]);
  else {
    console.error("Invalid arguments. Use --help for usage.");
    process.exit(2);
  }
}
if (!withJev && limit === 9) {
  console.error("The ninth case requires --with-jev.");
  process.exit(2);
}

// Load this checkout's settings only; shell values take precedence. Never print credentials.
const envPath = path.join(root, ".env.local");
const localEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};

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
      const filename = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { prepareAgentRequest } = await import("../src/lib/triage/impact.ts");
const { planReport, AgentPlanningError } = await import("../src/lib/agents/plan-report.ts");
const { agentRequestSchema, plannerPriorityDecisionSchema } =
  await import("../src/lib/contracts/triage.ts");
const { agentPlanSchema, agentMessageSchema, planningContextSchema, simulatedToolExecutionSchema } =
  await import("../src/lib/contracts/agent.ts");
const { createPlannerModel, PLANNER_ENV_KEYS, PlannerModelConfigurationError } =
  await import("../src/lib/agents/model.ts");
const { filterForTriage } = await import("../src/lib/filtering/filter-report.ts");
const { readFilterPolicy } = await import("../src/lib/filtering/jev.ts");
hooks.deregister();

for (const key of PLANNER_ENV_KEYS) {
  if (process.env[key] === undefined && localEnv[key] !== undefined)
    process.env[key] = localEnv[key];
}
if (!dryRun) {
  try {
    createPlannerModel(randomUUID()); // Configuration only; does not call the provider.
  } catch (error) {
    console.error(
      error instanceof PlannerModelConfigurationError
        ? error.message
        : "Invalid planner configuration.",
    );
    console.error(
      "No calls made. Configure the selected provider in .env.local or the environment.",
    );
    process.exit(2);
  }
  if (withJev) {
    const filterEnv = { ...localEnv, ...process.env };
    try {
      if (!filterEnv.TYPESAFE_API_KEY?.trim()) throw new Error();
      readFilterPolicy(filterEnv);
    } catch {
      console.error("Configure TYPESAFE_API_KEY and valid JEV_* settings. No calls made.");
      process.exit(2);
    }
  }
}

const cases = [
  {
    name: "Campsite wildfire",
    text: "Flames threaten a Sierra Bermeja campsite with 80 people. Harm is expected in 10 minutes.",
    values: [4, 80, "general", 10],
  },
  {
    name: "School evacuation",
    text: "Fire threatens a school with 120 people. Harm is expected in 15 minutes.",
    values: [4, 120, "school", 15],
  },
  {
    name: "Nursing home",
    text: "Smoke threatens a nursing home with 40 residents. Harm is expected in 5 minutes.",
    values: [5, 40, "nursing_home", 5],
  },
  {
    name: "Uncertain smoke",
    text: "There may be smoke or dust near the campsite. The number of people and time to harm are unknown.",
    values: [null, null, "general", null],
    uncertain: true,
  },
  {
    name: "Wildfire reaches settlement",
    text: "The Sierra Bermeja wildfire has reached a settlement with 120 people still exposed. Coordinate evacuation corridors, public warnings and area response immediately.",
    values: [5, 120, "general", 0],
  },
  {
    name: "Evacuated campsite",
    text: "The campsite is confirmed empty following evacuation. Monitor the fire and avoid repeating completed evacuation work.",
    values: [3, 0, "general", 30],
  },
  {
    name: "Missing time to harm",
    text: "Fire threatens 30 people near Sierra Bermeja. The time until harm cannot yet be estimated.",
    values: [4, 30, "general", null],
  },
  {
    name: "Road closure replan",
    text: "The A-397 is now blocked. Reconsider the pending route for assistance to 20 exposed people; do not repeat completed warnings.",
    values: [4, 20, "general", 20],
    replan: true,
  },
];
if (withJev)
  cases.unshift({
    name: "Greeting stops before triage",
    text: "Hello, good morning!",
    values: [null, null, null, null],
    stop: true,
  });
cases.splice(limit ?? cases.length);

async function buildCase(example) {
  const eventId = randomUUID();
  const correlation = { schemaVersion: 1, runId: randomUUID(), eventId, executionId: randomUUID() };
  const at = new Date().toISOString();
  const evidence = [{ id: eventId }];
  const priorityRequest = {
    ...correlation,
    report: {
      id: eventId,
      runId: correlation.runId,
      source: "scenario",
      receivedAt: at,
      text: example.text,
      extracted: {},
    },
    sourceProfileId: null,
    filter: {
      ...correlation,
      filterDecisionId: randomUUID(),
      policyVersion: "manual-synthetic-p2-fixture-v1",
      evidence,
      summary: "Synthetic P2 fixture for the manual P4 exercise; Jev was not called.",
      decidedAt: at,
      status: "completed",
      decision: example.stop ? "irrelevant" : example.uncertain ? "uncertain" : "relevant",
      relevanceProbability: example.stop ? 0.01 : example.uncertain ? 0.5 : 0.95,
      failure: null,
    },
  };
  const filtered =
    withJev && !dryRun
      ? await filterForTriage({ ...correlation, report: priorityRequest.report, evidence }, null, {
          env: { ...localEnv, ...process.env },
        })
      : { result: priorityRequest.filter, priorityRequest: example.stop ? null : priorityRequest };
  if (!filtered.priorityRequest)
    return {
      request: null,
      context: null,
      filter: filtered.result,
      report: priorityRequest.report,
    };
  const factors = Object.fromEntries(
    ["gravity", "peopleExposed", "vulnerabilityGroup", "minutesToHarm"].map((name, i) => [
      name,
      {
        value: example.values[i],
        evidence: example.values[i] === null ? [] : evidence,
        method:
          example.values[i] === null
            ? "Unknown in synthetic scenario observation"
            : "Structured synthetic scenario observation",
      },
    ]),
  );
  const request = prepareAgentRequest(
    filtered.priorityRequest,
    { ...correlation, assessedAt: at, factors },
    {
      expectedRunRevision: example.replan ? 2 : 0,
      activePlanId: example.replan ? randomUUID() : null,
    },
  );
  // Synthetic inventory only: exercise real P4 scarcity reasoning without reserving DB resources.
  request.resources = {
    availability: "finite",
    snapshot: {
      schemaVersion: 1,
      stateId: randomUUID(),
      runId: correlation.runId,
      revision: available === 10 ? 0 : 1,
      generatedAt: at,
      updatedAt: at,
      storage: "supabase",
      executionMode: "simulation",
      pollAfterMs: 3000,
      resources: [
        {
          resourceType: "ambulance",
          label: "Ambulances",
          unit: "vehicle",
          total: 10,
          available,
          allocated: 10 - available,
        },
      ],
      allocations:
        available === 10
          ? []
          : [
              {
                allocationId: randomUUID(),
                eventId: randomUUID(),
                executionId: randomUUID(),
                planId: randomUUID(),
                resources: [{ resourceType: "ambulance", quantity: 10 - available }],
                allocatedAt: at,
                expectedReleaseAt: null,
              },
            ],
    },
  };
  const context = {
    planVersion: example.replan ? 2 : 1,
    history: example.replan
      ? [
          {
            runId: correlation.runId,
            revision: 1,
            summary:
              "Warnings to the campsite were completed. Previous plan proposed the A-397 route for assistance; assistance has not been dispatched.",
            evidence: [{ id: randomUUID() }],
          },
        ]
      : [],
  };
  return {
    request: agentRequestSchema.parse(request),
    context: planningContextSchema.parse(context),
  };
}

// Defense in depth for local output; provider bodies and raw exceptions are never printed.
const credentials = [
  process.env.AI_GATEWAY_API_KEY,
  process.env.OPENCODE_API_KEY,
  process.env.TYPESAFE_API_KEY ?? localEnv.TYPESAFE_API_KEY,
]
  .filter((value) => value?.trim())
  .map((value) => value.trim());
function redact(value) {
  if (typeof value === "string")
    return credentials.reduce(
      (text, credential) => text.split(credential).join("[REDACTED]"),
      value,
    );
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}
function brief(value) {
  return String(redact(value))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 500);
}

function validResult(result, request, context) {
  const decision = plannerPriorityDecisionSchema.safeParse(result.decision);
  const plan = agentPlanSchema.safeParse(result.plan);
  const matches = (item) =>
    ["schemaVersion", "runId", "eventId", "executionId"].every((key) => item[key] === request[key]);
  return (
    decision.success &&
    plan.success &&
    matches(result.decision) &&
    matches(result.plan) &&
    result.decision.priorityDecisionId === request.priority.priorityDecisionId &&
    result.decision.expectedRunRevision === request.expectedRunRevision &&
    result.plan.priorityDecisionId === request.priority.priorityDecisionId &&
    result.plan.basedOnRunRevision === request.expectedRunRevision &&
    result.plan.supersedesPlanId === request.activePlanId &&
    result.plan.version === context.planVersion &&
    result.plan.steps.every((step) => step.actionId === null) &&
    result.executionMode === "simulation" &&
    result.realActionsExecuted === false &&
    result.toolExecutions.length === 1 &&
    result.toolExecutions.every(
      (execution) =>
        simulatedToolExecutionSchema.safeParse(execution).success && matches(execution),
    ) &&
    JSON.stringify(result.decision.proposedResources) ===
      JSON.stringify(result.toolExecutions[0].arguments.resources) &&
    result.messages.some((message) => message.role === "tool") &&
    result.messages.every(
      (message) =>
        agentMessageSchema.safeParse(message).success &&
        matches(message) &&
        (message.role === "tool"
          ? result.toolExecutions.some((execution) => execution.toolCallId === message.toolCallId)
          : message.toolCallId === null),
    ) &&
    (request.priority.calculation.status !== "incomplete" ||
      result.decision.verificationNeeded.length > 0)
  );
}

console.log(
  `${withJev ? "P2 -> P3 -> P4" : "P3 -> P4"} manual exercise: ${cases.length} synthetic cases (${dryRun ? "dry run, no calls" : "live provider calls; agent timeout 30 seconds"}).`,
);
console.log(
  withJev
    ? "Real Jev filtering in live mode. HTTP intake, persistence and frontend are NOT exercised. All action tools remain mocked."
    : "P2 outcomes are synthetic fixtures. Tools simulate resources and HappyRobot communications locally; no Jev or live action calls.",
);
const startedAt = new Date().toISOString();
const rows = [];
const results = [];
for (const [index, example] of cases.entries()) {
  const start = performance.now();
  const { request, context, filter, report } = await buildCase(example);
  if (!request) {
    const unavailable = filter.status === "unavailable";
    const verdict = unavailable
      ? "ERROR"
      : example.stop && filter.decision === "irrelevant"
        ? "PASS"
        : "MISMATCH";
    rows.push({
      case: example.name,
      relevance: filter.decision,
      route: "stopped before P3/P4",
      verdict,
    });
    results.push({
      case: example.name,
      report,
      filter,
      result: null,
      verdict,
      elapsedMs: Math.round(performance.now() - start),
    });
    console.log(
      `[${index + 1}/${cases.length}] ${example.name}: ${dryRun ? "DRY RUN" : verdict}; stopped before triage and agent${unavailable ? `; ${filter.failure.code}` : ""}`,
    );
    continue;
  }
  if (dryRun) {
    rows.push({
      case: example.name,
      relevance: request.filter.decision,
      impact: request.priority.calculation.score,
      missing: request.priority.calculation.missingFactors.join(", "),
      version: context.planVersion,
      contract: "valid",
    });
    continue;
  }
  try {
    const result = await planReport(request, context);
    const contractValid = !example.stop && validResult(result, request, context);
    const verdict = contractValid ? "PASS" : "MISMATCH";
    const elapsedMs = Math.round(performance.now() - start);
    rows.push({
      case: example.name,
      relevance: request.filter.decision,
      priority: result.decision.priority,
      steps: result.plan.steps.length,
      verification: result.decision.verificationNeeded.length,
      verdict,
      ms: elapsedMs,
    });
    results.push({
      case: example.name,
      request,
      context,
      result,
      contractValid,
      verdict,
      elapsedMs,
    });
    console.log(
      `[${index + 1}/${cases.length}] ${example.name}: ${verdict}; priority=${result.decision.priority}`,
    );
    console.log(`  Resources: ${brief(JSON.stringify(result.decision.proposedResources))}`);
    console.log(`  Plan: ${brief(result.plan.objective)}`);
    console.log(`  Verification: ${brief(JSON.stringify(result.decision.verificationNeeded))}`);
    console.log(`  Tools: ${result.toolExecutions.length} simulated; real actions: false`);
  } catch (error) {
    const code = error instanceof AgentPlanningError ? error.code : "MANUAL_EXERCISE_ERROR";
    const elapsedMs = Math.round(performance.now() - start);
    rows.push({ case: example.name, verdict: "ERROR", code, ms: elapsedMs });
    results.push({ case: example.name, request, context, verdict: "ERROR", code, elapsedMs });
    console.log(`[${index + 1}/${cases.length}] ${example.name}: ERROR; ${code}`);
  }
}
console.table(rows);
if (dryRun) {
  console.log(
    "Dry run uses synthetic filtering outcomes. Continuing cases passed P3/P4 input contracts. No provider calls or saved outputs.",
  );
  process.exit(0);
}
const matched = rows.filter(({ verdict }) => verdict === "PASS").length;
const errors = rows.filter(({ verdict }) => verdict === "ERROR").length;
const output = path.join(
  root,
  ".data",
  withJev ? "pipeline-smoke-results.json" : "llm-smoke-results.json",
);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    redact({
      startedAt,
      mode: withJev ? "live_p2_p3_p4_modules_only" : "live_llm_synthetic_p2",
      matched,
      errors,
      total: rows.length,
      results,
    }),
    null,
    2,
  ) + "\n",
);
console.log(
  `${matched}/${rows.length} expected routes and valid downstream contracts; ${errors} errors. Outputs: ${path.relative(root, output)}`,
);
console.log(
  "Priorities/resource counts are nondeterministic and need human review. PASS means contract checks passed, not operational correctness. No resources dispatched.",
);
process.exitCode = errors ? 2 : matched === rows.length ? 0 : 1;
