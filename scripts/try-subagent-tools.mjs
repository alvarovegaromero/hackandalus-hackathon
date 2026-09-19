// Person B worker: consumes reserved missions; never reserves or releases inventory.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import ts from "typescript";
if (existsSync(".env.local"))
  for (const [key, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8"))))
    process.env[key] ??= value;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    return next(url, context);
  },
});
const { randomUUID } = await import("node:crypto");
const { executeMissionAgent } = await import("../src/lib/subagents/execute.ts");
const { missionInputSchema } = await import("../src/lib/contracts/mission.ts");
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex < 0 ? 5 : Number(process.argv[limitIndex + 1]);
if (!Number.isInteger(limit) || limit < 1 || limit > 5)
  throw new Error("--limit must be 1 through 5");
const base = {
  missionId: randomUUID(),
  runId: randomUUID(),
  eventId: randomUUID(),
  revision: 1,
  objective: "Obtain a simulated acknowledgement from medical coordination",
  instructions:
    "Contact medical_coordination once, then query the result. Finish when the mock acknowledges. No real dispatch.",
  context: { incidentSummary: "Synthetic wildfire threatens a residential area", priority: "high" },
  assignedResourceIds: ["ambulance-2"],
  allowedTools: ["contactService", "getContactResult"],
};
const pendingId = randomUUID();
const cases = [
  {
    name: "medical contact and acknowledgement",
    expectedTools: ["contactService", "getContactResult"],
    expectedService: "medical_coordination",
    expectedStatus: "completed",
    input: base,
  },
  {
    name: "emergency contact and acknowledgement",
    expectedTools: ["contactService", "getContactResult"],
    expectedService: "emergency_coordination",
    expectedStatus: "completed",
    input: {
      ...base,
      objective: "Obtain a simulated acknowledgement from emergency coordination",
      instructions:
        "Contact emergency_coordination once and query its result. Finish after mock acknowledgement.",
    },
  },
  {
    name: "resume pending contact without repeating it",
    expectedTools: ["getContactResult"],
    expectedStatus: "completed",
    input: {
      ...base,
      instructions:
        "Resume the existing medical contact by querying its result. Do not start another contact.",
      allowedTools: ["getContactResult"],
    },
    operations: [
      {
        operationId: pendingId,
        service: "medical_coordination",
        message: "Previously persisted synthetic request",
        provider: "happyrobot_mock",
        status: "pending",
        realActionsExecuted: false,
      },
    ],
  },
  {
    name: "no communication tools permitted",
    expectedTools: [],
    expectedStatus: "blocked",
    input: { ...base, allowedTools: [] },
  },
  {
    name: "capacity request without assigning resources",
    expectedTools: [],
    expectedStatus: "blocked",
    needsResources: true,
    input: {
      ...base,
      assignedResourceIds: [],
      allowedTools: [],
      objective: "Request two additional ambulances from the parent",
      instructions:
        "This synthetic mission requires two ambulances but none are assigned. Return blocked with resourceRequest for two ambulances. Do not allocate or contact services.",
    },
  },
];
const results = [];
for (const scenario of cases.slice(0, limit)) {
  const mission = missionInputSchema.parse({ ...scenario.input, missionId: randomUUID() });
  const token = randomUUID();
  const operations = structuredClone(scenario.operations ?? []);
  const initialResources = JSON.stringify(mission.assignedResourceIds);
  const rpcCalls = [];
  const persistence = async (kind, lease, data) => {
    if (lease !== token || data.missionId !== mission.missionId)
      throw new Error("Invalid mission scope");
    rpcCalls.push({ kind, data: structuredClone(data) });
    if (kind === "inspect") return { code: "OK", operations: structuredClone(operations) };
    if (kind === "contact") {
      let op = operations.find((o) => o.service === data.service);
      if (!op) {
        op = {
          operationId: randomUUID(),
          service: data.service,
          message: data.message,
          provider: "happyrobot_mock",
          status: "pending",
          realActionsExecuted: false,
        };
        operations.push(op);
      }
      return { code: "OK", operation: structuredClone(op) };
    }
    if (kind === "contact_result") {
      const op = operations.find((o) => o.operationId === data.operationId);
      if (!op) return { code: "OPERATION_NOT_FOUND" };
      op.status = "acknowledged";
      return { code: "OK", operation: structuredClone(op) };
    }
    throw new Error("Unexpected persistence operation");
  };
  try {
    const output = await executeMissionAgent(
      mission,
      token,
      structuredClone(operations),
      persistence,
    );
    const names = output.toolCalls.map((c) => c.toolName);
    const issues = [];
    if (JSON.stringify(names) !== JSON.stringify(scenario.expectedTools))
      issues.push("unexpected tool sequence");
    if (output.decision.status !== scenario.expectedStatus) issues.push("unexpected status");
    if (scenario.expectedService && operations.some((o) => o.service !== scenario.expectedService))
      issues.push("wrong service");
    if (scenario.needsResources && output.decision.resourceRequest?.additionalQuantity !== 2)
      issues.push("missing resource request");
    if (JSON.stringify(mission.assignedResourceIds) !== initialResources)
      issues.push("resources changed");
    if (operations.some((o) => o.realActionsExecuted !== false))
      issues.push("unexpected real action");
    const result = {
      name: scenario.name,
      verdict: issues.length ? "FAIL" : "PASS",
      issues,
      mission,
      ...output,
      operations,
      rpcCalls,
    };
    results.push(result);
    console.log(
      JSON.stringify({
        name: result.name,
        verdict: result.verdict,
        issues,
        toolCalls: output.toolCalls,
        decision: output.decision,
      }),
    );
  } catch {
    results.push({ name: scenario.name, verdict: "ERROR", mission, rpcCalls });
    console.error(
      JSON.stringify({ name: scenario.name, verdict: "ERROR", code: "MODEL_OR_CONTRACT_ERROR" }),
    );
  }
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/subagent-tool-results.json", JSON.stringify(results, null, 2));
}
console.log(
  `Results: ${results.filter((r) => r.verdict === "PASS").length}/${results.length} passed. Live LLM; isolated persistence; no Supabase writes or real calls.`,
);
process.exitCode = results.every((r) => r.verdict === "PASS") ? 0 : 1;
