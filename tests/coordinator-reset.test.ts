import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  prepare: vi.fn(),
  cycle: vi.fn(),
  dispatch: vi.fn(),
  missions: vi.fn(),
  pending: vi.fn(),
  pendingDispatch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => undefined }));
vi.mock("../src/lib/coordinator/runtime", () => ({
  readCoordinatorState: mocks.read,
  prepareCoordinatorReport: mocks.prepare,
  runCoordinatorCycle: mocks.cycle,
}));
vi.mock("../src/lib/subagents/dispatch", () => ({
  dispatchPlanMissions: mocks.dispatch,
  processSubagentMissions: mocks.missions,
}));
vi.mock("../src/lib/contracts/coordinator", () => ({
  coordinatorStateSchema: { parse: (value: unknown) => value },
}));
vi.mock("../src/lib/supabase/server", () => ({
  createServerSupabase: () => {
    const query = {
      from: () => query,
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: mocks.pending,
      maybeSingle: mocks.pendingDispatch,
    };
    return query;
  },
}));
import {
  processCoordinatorInBackground,
  resetCoordinatorBackground,
} from "../src/lib/coordinator/background";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCoordinatorBackground("old-run");
  mocks.read.mockResolvedValue({ runId: "old-run", events: [] });
  mocks.pending.mockResolvedValue({ data: [], error: null });
  mocks.pendingDispatch.mockResolvedValue({
    data: { dispatch_replan_pending: false },
    error: null,
  });
  mocks.prepare.mockResolvedValue(true);
  mocks.cycle.mockResolvedValue({ outcome: "NO_ACTIVE_EVENTS" });
  mocks.missions.mockResolvedValue(undefined);
  mocks.dispatch.mockResolvedValue({ needsReplan: false });
});

it("a filter finishing after reset cannot schedule a plan for the fresh run", async () => {
  const filter = deferred<boolean>();
  mocks.prepare.mockReturnValueOnce(filter.promise);
  mocks.pending.mockResolvedValueOnce({ data: [{ input: {} }], error: null });
  const processing = processCoordinatorInBackground();
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
  resetCoordinatorBackground("new-run");
  filter.resolve(true);
  await processing;
  expect(mocks.cycle).not.toHaveBeenCalled();
  expect(mocks.missions).not.toHaveBeenCalled();
});

it("a model finishing after reset cannot dispatch old missions", async () => {
  const model = deferred<unknown>();
  mocks.pending.mockResolvedValueOnce({ data: [{ input: {} }], error: null });
  mocks.cycle.mockReturnValueOnce(model.promise);
  const processing = processCoordinatorInBackground();
  await vi.waitFor(() => expect(mocks.cycle).toHaveBeenCalled());
  const signal = mocks.cycle.mock.calls[0][2] as AbortSignal;
  resetCoordinatorBackground("new-run");
  expect(signal.aborted).toBe(true);
  model.resolve({ outcome: "OK", proposal: {}, state: { runId: "old-run" } });
  await processing;
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("late reads from old requests cannot replace a newly reset background run", async () => {
  const read = deferred<unknown>();
  mocks.read.mockReturnValueOnce(read.promise);
  const processing = processCoordinatorInBackground();
  resetCoordinatorBackground("new-run");
  read.resolve({ runId: "old-run", events: [] });
  await processing;
  expect(globalThis.coordinatorBackground?.runId).toBe("new-run");
  expect(mocks.pending).not.toHaveBeenCalled();
});

it("later intake recovers queued missions without requiring a new accepted report", async () => {
  await processCoordinatorInBackground();
  expect(mocks.missions).toHaveBeenCalledWith(
    expect.any(Function),
    "old-run",
    expect.any(AbortSignal),
  );
  expect(mocks.cycle).not.toHaveBeenCalled();
  const oldCallback = mocks.missions.mock.calls[0][0] as () => void;
  resetCoordinatorBackground("new-run");
  oldCallback();
  await Promise.resolve();
  expect(mocks.cycle).not.toHaveBeenCalled();
});

it("dispatch callbacks replan through the current run scheduler", async () => {
  mocks.pendingDispatch.mockResolvedValue({ data: { dispatch_replan_pending: true }, error: null });
  await processCoordinatorInBackground();
  expect(mocks.cycle).toHaveBeenCalledWith("dispatch.result", "old-run", expect.any(AbortSignal));
});
