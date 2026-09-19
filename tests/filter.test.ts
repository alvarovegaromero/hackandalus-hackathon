import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { filterForTriage, filterReport } from "@/lib/filtering/filter-report";
import { DEFAULT_FILTER_POLICY, JEV_ENDPOINT } from "@/lib/filtering/jev";
import {
  filterRequestSchema,
  filterResultSchema,
  priorityRequestSchema,
  toPriorityRequest,
} from "@/lib/contracts/filter";
import { filterCases, filterRequestFixture } from "./fixtures/filter-reports";

const env = { TYPESAFE_API_KEY: "fixture-only-placeholder" };
const now = () => new Date("2026-09-19T12:01:00Z");
function answer(probability: unknown) {
  return { model: "jev-fixture", answers: { relevant: { type: "noul", noul: probability } } };
}
function setup(probability: unknown = 0.95) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(answer(probability)));
  const log = vi.fn();
  return { fetcher, log, env, now };
}

afterEach(() => vi.useRealTimers());

describe("P1 → Jev → P3 contract", () => {
  it.each(filterCases)(
    "routes $name using a typed Jev answer",
    async ({ text, probability, decision }) => {
      const options = setup(probability);
      const input = structuredClone(filterRequestFixture);
      input.report.text = text;
      const { result, priorityRequest } = await filterForTriage(input, null, options);
      expect(filterResultSchema.parse(result)).toMatchObject({
        status: "completed",
        decision,
        relevanceProbability: probability,
        eventId: input.eventId,
        runId: input.runId,
        executionId: input.executionId,
        evidence: input.evidence,
        decidedAt: now().toISOString(),
        failure: null,
      });
      if (decision === "relevant" || decision === "uncertain") {
        expect(priorityRequestSchema.parse(priorityRequest)).toMatchObject({
          report: input.report,
          filter: result,
          sourceProfileId: null,
        });
      } else {
        expect(priorityRequest).toBeNull();
      }
      expect(input.report.text).toBe(text);
      expect(options.log).toHaveBeenCalledWith(
        expect.objectContaining({
          decision,
          next: decision === "irrelevant" ? "stop" : "triage",
        }),
      );
    },
  );

  it.each([
    [0, "irrelevant"],
    [0.2, "irrelevant"],
    [0.20001, "uncertain"],
    [0.79999, "uncertain"],
    [0.8, "relevant"],
    [1, "relevant"],
  ])("handles probability %s at the configured boundaries", async (p, decision) => {
    expect((await filterReport(filterRequestFixture, setup(p))).decision).toBe(decision);
  });

  it("uses the official HTTP shape and only allowlisted evidence", async () => {
    const options = setup();
    const request = structuredClone(filterRequestFixture);
    request.report.extracted = { category: "untrusted-provider-category" };
    request.report.externalRef = "private-provider-delivery";
    await filterReport(request, options);
    const [url, init] = options.fetcher.mock.calls[0];
    expect(url).toBe(JEV_ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "jev-latest",
      state: { report: { text: request.report.text, location: null } },
      questions: { relevant: { type: "noul" } },
    });
    expect(String(init?.body)).not.toContain("private-provider-delivery");
    expect(String(init?.body)).not.toContain("untrusted-provider-category");
    expect(String(init?.body)).not.toContain(request.runId);
  });

  it("logs a backend discard without report text, credentials, or raw provider output", async () => {
    const options = setup(0.01);
    const result = await filterReport(filterRequestFixture, options);
    const serialized = JSON.stringify(options.log.mock.calls);
    expect(serialized).toContain('"next":"stop"');
    expect(serialized).toContain(result.filterDecisionId);
    expect(serialized).not.toContain(filterRequestFixture.report.text);
    expect(serialized).not.toContain(env.TYPESAFE_API_KEY);
  });

  it("keeps decision identity on retries and changes it for reassessment or policy changes", async () => {
    const first = await filterReport(filterRequestFixture, setup());
    const retry = await filterReport(filterRequestFixture, setup());
    const reassessment = await filterReport(
      { ...filterRequestFixture, executionId: "44444444-4444-4444-8444-444444444444" },
      setup(),
    );
    const newPolicy = await filterReport(filterRequestFixture, {
      ...setup(),
      policy: { ...DEFAULT_FILTER_POLICY, relevantMin: 0.9 },
    });
    expect(retry.filterDecisionId).toBe(first.filterDecisionId);
    expect(reassessment.filterDecisionId).not.toBe(first.filterDecisionId);
    expect(newPolicy.filterDecisionId).not.toBe(first.filterDecisionId);
    expect(newPolicy.policyVersion).not.toBe(first.policyVersion);
  });

  it("rejects mismatched P1 identity and unknown fields before any network call", async () => {
    const options = setup();
    const request = { ...filterRequestFixture, eventId: "44444444-4444-4444-8444-444444444444" };
    await expect(filterReport(request, options)).rejects.toThrow();
    expect(
      filterRequestSchema.safeParse({ ...filterRequestFixture, groundTruth: {} }).success,
    ).toBe(false);
    expect(filterRequestSchema.safeParse({ ...filterRequestFixture, evidence: [] }).success).toBe(
      false,
    );
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it("rejects another execution's result and never forwards a failed or rejected result", async () => {
    const relevant = await filterReport(filterRequestFixture, setup());
    expect(() =>
      toPriorityRequest(filterRequestFixture, {
        ...relevant,
        executionId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow();
    const irrelevant = await filterReport(filterRequestFixture, setup(0));
    expect(toPriorityRequest(filterRequestFixture, irrelevant)).toBeNull();
    const validHandoff = toPriorityRequest(filterRequestFixture, relevant);
    expect(priorityRequestSchema.safeParse({ ...validHandoff, filter: irrelevant }).success).toBe(
      false,
    );
  });
});

describe("failures remain reviewable, never false discards", () => {
  it.each([undefined, "", "   "])("does not call Jev without a configured key", async (key) => {
    const options = { ...setup(), env: { TYPESAFE_API_KEY: key } };
    const { result, priorityRequest } = await filterForTriage(filterRequestFixture, null, options);
    expect(result).toMatchObject({
      status: "unavailable",
      decision: null,
      failure: { code: "FILTER_UNAVAILABLE", retryable: false },
    });
    expect(priorityRequest).toBeNull();
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.log).toHaveBeenCalledWith(expect.objectContaining({ next: "review" }));
  });

  it("rejects inverted thresholds before invoking the provider", async () => {
    const options = {
      ...setup(),
      policy: { ...DEFAULT_FILTER_POLICY, irrelevantMax: 0.9, relevantMin: 0.1 },
    };
    expect(await filterReport(filterRequestFixture, options)).toMatchObject({
      status: "unavailable",
      failure: { retryable: false },
    });
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { JEV_IRRELEVANT_MAX: "" },
    { JEV_RELEVANT_MIN: "not-a-number" },
    { JEV_TIMEOUT_MS: "0" },
    { JEV_MODEL: "" },
  ])("returns unavailable for invalid environment policy %j", async (settings) => {
    const options = { ...setup(), env: { ...env, ...settings } };
    expect(await filterReport(filterRequestFixture, options)).toMatchObject({
      status: "unavailable",
      failure: { code: "FILTER_UNAVAILABLE", retryable: false },
    });
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, false],
    [422, false],
    [429, true],
    [529, true],
    [503, true],
  ])("maps HTTP %s without exposing its error body", async (status, retryable) => {
    const options = setup();
    options.fetcher.mockResolvedValue(
      Response.json({ error: "private-provider-error" }, { status }),
    );
    const response = await filterForTriage(filterRequestFixture, null, options);
    expect(response.result).toMatchObject({
      status: "unavailable",
      decision: null,
      failure: { code: "FILTER_UNAVAILABLE", retryable },
    });
    expect(response.priorityRequest).toBeNull();
    expect(JSON.stringify(response)).not.toContain("private-provider-error");
    expect(options.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([-0.01, 1.1, "0.9", null, undefined])("rejects invalid probability %s", async (p) => {
    const options = setup();
    options.fetcher.mockResolvedValue(Response.json(answer(p)));
    const response = await filterForTriage(filterRequestFixture, null, options);
    expect(response.result).toMatchObject({
      status: "unavailable",
      failure: { code: "FILTER_INVALID_RESULT" },
    });
    expect(response.priorityRequest).toBeNull();
  });

  it.each([{}, { answers: { relevant: { type: "choice", choice: "yes" } } }])(
    "rejects an unexpected response shape",
    async (body) => {
      const options = setup();
      options.fetcher.mockResolvedValue(Response.json(body));
      expect(await filterReport(filterRequestFixture, options)).toMatchObject({
        failure: { code: "FILTER_INVALID_RESULT" },
      });
    },
  );

  it("handles malformed JSON and network errors without leaking exceptions", async () => {
    const options = setup();
    options.fetcher.mockResolvedValue(new Response("not JSON"));
    expect(await filterReport(filterRequestFixture, options)).toMatchObject({
      failure: { code: "FILTER_INVALID_RESULT" },
    });
    options.fetcher.mockRejectedValue(new Error("private-network-details"));
    const result = await filterReport(filterRequestFixture, options);
    expect(result).toMatchObject({ failure: { code: "FILTER_UNAVAILABLE", retryable: true } });
    expect(JSON.stringify(result)).not.toContain("private-network-details");
  });

  it.each(["headers", "body"])(
    "bounds a stalled response %s and aborts the request",
    async (stage) => {
      vi.useFakeTimers();
      const options = { ...setup(), policy: { ...DEFAULT_FILTER_POLICY, timeoutMs: 25 } };
      if (stage === "headers") options.fetcher.mockImplementation(() => new Promise(() => {}));
      else options.fetcher.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
      const pending = filterForTriage(filterRequestFixture, null, options);
      await vi.advanceTimersByTimeAsync(26);
      const { result, priorityRequest } = await pending;
      expect(result).toMatchObject({
        status: "unavailable",
        failure: { code: "FILTER_TIMEOUT", retryable: true },
      });
      expect(priorityRequest).toBeNull();
      expect(options.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    },
  );
});
