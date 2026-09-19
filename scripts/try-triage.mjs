// Manual P3 exercise only. No credentials, network calls, hooks or automated test runner.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

if (process.argv.length > 2) {
  console.log("Usage: npm run triage:try (10 synthetic cases, no model calls)");
  process.exit(process.argv[2] === "--help" ? 0 : 2);
}
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
const { prepareAgentRequest } = await import("../src/lib/triage/impact.ts");
const { agentRequestSchema } = await import("../src/lib/contracts/triage.ts");
hooks.deregister();

const cases = [
  { name: "Campsite", values: [4, 80, "general", 10], expected: 4.58036404530876 },
  { name: "School, same exposure", values: [4, 80, "school", 10], expected: 6.87054606796314 },
  { name: "Nursing home", values: [5, 40, "nursing_home", 5], expected: 12.095878925398015 },
  { name: "Fire reaches settlement", values: [5, 120, "general", 0], expected: 10.41392685158225 },
  { name: "Known zero people", values: [3, 0, "general", 30], expected: 0 },
  {
    name: "Uncertain, same impact",
    values: [4, 80, "general", 10],
    uncertain: true,
    expected: 4.58036404530876,
  },
  {
    name: "Unknown people",
    values: [4, null, "general", 10],
    expected: null,
    missing: ["peopleExposed"],
  },
  {
    name: "Unknown time",
    values: [4, 80, "general", null],
    expected: null,
    missing: ["minutesToHarm"],
  },
  { name: "Invalid severity", values: [6, 80, "general", 10], reject: true },
  {
    name: "Wrong execution context",
    values: [4, 80, "general", 10],
    wrongContext: true,
    reject: true,
  },
];
const rows = [];
const results = [];
for (const example of cases) {
  const context = {
    schemaVersion: 1,
    runId: randomUUID(),
    eventId: randomUUID(),
    executionId: randomUUID(),
  };
  const at = new Date().toISOString();
  const evidence = [{ id: context.eventId }];
  const input = {
    ...context,
    report: {
      id: context.eventId,
      runId: context.runId,
      source: "scenario",
      receivedAt: at,
      text: `Synthetic observation: ${example.name}.`,
      extracted: {},
    },
    sourceProfileId: null,
    filter: {
      ...context,
      filterDecisionId: randomUUID(),
      policyVersion: "synthetic-p3-exercise-v1",
      evidence,
      summary: "Synthetic Jev outcome; no provider was called.",
      decidedAt: at,
      status: "completed",
      decision: example.uncertain ? "uncertain" : "relevant",
      relevanceProbability: example.uncertain ? 0.5 : 0.95,
      failure: null,
    },
  };
  const assessment = {
    ...context,
    executionId: example.wrongContext ? randomUUID() : context.executionId,
    assessedAt: at,
    factors: Object.fromEntries(
      ["gravity", "peopleExposed", "vulnerabilityGroup", "minutesToHarm"].map((key, i) => [
        key,
        {
          value: example.values[i],
          evidence: example.values[i] === null ? [] : evidence,
          method: "Structured synthetic observation",
        },
      ]),
    ),
  };
  const planning = { expectedRunRevision: 0, activePlanId: null };
  let actual;
  let passed = false;
  let output = null;
  let error = null;
  try {
    output = prepareAgentRequest(input, assessment, planning);
    const repeated = prepareAgentRequest(input, assessment, planning);
    const calculation = output.priority.calculation;
    actual = calculation.status === "scored" ? calculation.score : "incomplete";
    passed =
      !example.reject &&
      agentRequestSchema.safeParse(output).success &&
      output.priority.priorityDecisionId === repeated.priority.priorityDecisionId &&
      output.filter.decision === input.filter.decision &&
      output.evidenceConfidence === null &&
      output.resources.availability === "unlimited" &&
      (example.expected === null
        ? calculation.status === "incomplete" &&
          calculation.score === null &&
          JSON.stringify(calculation.missingFactors) === JSON.stringify(example.missing)
        : calculation.status === "scored" &&
          Math.abs(calculation.score - example.expected) < 1e-10);
  } catch (caught) {
    actual = "rejected";
    // Only local validators are called; no provider error or credentials can appear.
    error = caught instanceof Error ? caught.message : "Unknown local error";
    passed =
      example.reject === true &&
      (example.wrongContext
        ? error === "Impact assessment must belong to the same report execution."
        : caught?.issues?.some(
            (issue) =>
              JSON.stringify(issue.path) === JSON.stringify(["factors", "gravity", "value"]),
          ));
  }
  rows.push({
    scenario: example.name,
    input: example.values.map((value) => value ?? "unknown").join(" / "),
    jev: input.filter.decision,
    output: actual,
    toP4: output !== null,
    verdict: passed ? "PASS" : "FAIL",
  });
  results.push({
    scenario: example.name,
    input,
    assessment,
    expected: example.reject ? "rejected" : example.expected,
    output,
    error,
    passed,
  });
}
console.table(rows);
const folder = new URL("../.data/", import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(
  new URL("triage-smoke-results.json", folder),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n",
);
const passed = results.filter((result) => result.passed).length;
console.log(
  `${passed}/${cases.length} P3 scenarios passed. Full inputs/outputs: .data/triage-smoke-results.json`,
);
console.log(
  "Only deterministic P3 behavior was exercised. Jev inputs are synthetic; no LLM or execution was called.",
);
process.exitCode = passed === cases.length ? 0 : 1;
