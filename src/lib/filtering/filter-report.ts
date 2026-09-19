// OWNER: P2 relevance filter and P1/P3 handoff (docs/jev-filter.md).
import "server-only";
import { createHash } from "node:crypto";
import {
  filterRequestSchema,
  filterResultSchema,
  toPriorityRequest,
  type FilterRequest,
  type FilterResult,
  type PriorityRequest,
} from "../contracts/filter";
import {
  evaluateWithJev,
  filterPolicySchema,
  filterPolicyVersion,
  JevFailure,
  readFilterPolicy,
  type FilterPolicy,
} from "./jev";

export type FilterLog = {
  type: "filtering.completed" | "filtering.failed";
  runId: string;
  eventId: string;
  executionId: string;
  filterDecisionId: string;
  policyVersion: string;
  decision: FilterResult["decision"];
  relevanceProbability: number | null;
  next: "triage" | "stop" | "review";
  failureCode: string | null;
};

export type FilterOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  policy?: FilterPolicy;
  fetcher?: typeof fetch;
  log?: (entry: FilterLog) => void;
  now?: () => Date;
};

/** UUIDv8: retries under the same context/policy identify the same decision. */
function decisionId(request: FilterRequest, policyVersion: string): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify([
        "filter",
        request.runId,
        request.eventId,
        request.executionId,
        policyVersion,
      ]),
    )
    .digest("hex");
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function filterReport(
  input: FilterRequest,
  options: FilterOptions = {},
): Promise<FilterResult> {
  // Invalid P1 context is a programmer/adapter error; do not call Jev or
  // misrepresent a malformed report as a completed filtering decision.
  const request = filterRequestSchema.parse(input);
  const env = options.env ?? process.env;
  let policyVersion = "crisis-relevance-v1/invalid-configuration";
  let outcome: Pick<
    FilterResult,
    "status" | "decision" | "relevanceProbability" | "failure" | "summary"
  >;
  try {
    let policy: FilterPolicy;
    try {
      policy = options.policy ? filterPolicySchema.parse(options.policy) : readFilterPolicy(env);
    } catch {
      throw new JevFailure({
        code: "FILTER_UNAVAILABLE",
        retryable: false,
        message: "Jev filter configuration is invalid.",
      });
    }
    policyVersion = filterPolicyVersion(policy);
    const evaluation = await evaluateWithJev(
      request.report,
      policy,
      env.TYPESAFE_API_KEY,
      options.fetcher,
    );
    const p = evaluation.probability;
    const decision =
      p <= policy.irrelevantMax ? "irrelevant" : p >= policy.relevantMin ? "relevant" : "uncertain";
    outcome = {
      status: "completed",
      decision,
      relevanceProbability: p,
      failure: null,
      // Code-generated policy explanation; Jev Noul does not generate reasons.
      summary: `Relevance ${p} from ${evaluation.model}; policy classifies the report as ${decision} (discard <= ${policy.irrelevantMax}, relevant >= ${policy.relevantMin}; uncertain reports also continue).`,
    };
  } catch (error) {
    if (!(error instanceof JevFailure)) throw error;
    outcome = {
      status: "unavailable",
      decision: null,
      relevanceProbability: null,
      failure: error.failure,
      summary: error.failure.message,
    };
  }
  const result = filterResultSchema.parse({
    schemaVersion: request.schemaVersion,
    runId: request.runId,
    eventId: request.eventId,
    executionId: request.executionId,
    filterDecisionId: decisionId(request, policyVersion),
    policyVersion,
    evidence: request.evidence,
    decidedAt: (options.now?.() ?? new Date()).toISOString(),
    ...outcome,
  });
  const next =
    result.decision === "relevant" || result.decision === "uncertain"
      ? "triage"
      : result.decision === "irrelevant"
        ? "stop"
        : "review";
  const log = options.log ?? ((entry: FilterLog) => console.info(JSON.stringify(entry)));
  log({
    type: result.status === "completed" ? "filtering.completed" : "filtering.failed",
    runId: result.runId,
    eventId: result.eventId,
    executionId: result.executionId,
    filterDecisionId: result.filterDecisionId,
    policyVersion,
    decision: result.decision,
    relevanceProbability: result.relevanceProbability,
    next,
    failureCode: result.failure?.code ?? null,
  });
  // TBD (P0/P5): persist result and publish the existing filtering telemetry
  // payload after commit. Backend logging is the only notification in P2 now.
  return result;
}

/** Callable P1 integration seam; no SSE, agent call, priority fabrication or persistence. */
export async function filterForTriage(
  input: FilterRequest,
  sourceProfileId: string | null = null,
  options: FilterOptions = {},
): Promise<{ result: FilterResult; priorityRequest: PriorityRequest | null }> {
  const request = filterRequestSchema.parse(input);
  const result = await filterReport(request, options);
  return { result, priorityRequest: toPriorityRequest(request, result, sourceProfileId) };
}
