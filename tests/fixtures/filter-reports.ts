import type { FilterRequest } from "@/lib/contracts/filter";

export const filterRequestFixture: FilterRequest = {
  schemaVersion: 1,
  runId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  executionId: "33333333-3333-4333-8333-333333333333",
  report: {
    id: "22222222-2222-4222-8222-222222222222",
    runId: "11111111-1111-4111-8111-111111111111",
    source: "public",
    receivedAt: "2026-09-19T12:00:00Z",
    text: "Smoke near the campsite; people are still inside.",
    extracted: {},
  },
  evidence: [{ id: "22222222-2222-4222-8222-222222222222" }],
};

// Synthetic provider answers test routing, not the live model's accuracy.
export const filterCases = [
  { name: "greeting", text: "Hello!", probability: 0.02, decision: "irrelevant" },
  {
    name: "clear incident",
    text: filterRequestFixture.report.text,
    probability: 0.97,
    decision: "relevant",
  },
  {
    name: "ambiguous message",
    text: "Something seems strange outside.",
    probability: 0.5,
    decision: "uncertain",
  },
  {
    name: "response update",
    text: "A-397 is now closed to traffic.",
    probability: 0.95,
    decision: "relevant",
  },
  {
    name: "correction",
    text: "The earlier smoke report was wrong; it is dust.",
    probability: 0.9,
    decision: "relevant",
  },
] as const;
