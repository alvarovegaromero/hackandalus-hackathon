import type { EngineState } from "./engine";

// Port for persistence; Supabase can implement it later.
export interface ScenarioStore {
  load(runId: string): Promise<EngineState | undefined>;
  save(runId: string, state: EngineState): Promise<void>;
}

export function createMemoryStore(): ScenarioStore {
  const runs = new Map<string, EngineState>();
  return {
    async load(runId) {
      const state = runs.get(runId);
      return state && structuredClone(state);
    },
    async save(runId, state) {
      runs.set(runId, structuredClone(state));
    },
  };
}
