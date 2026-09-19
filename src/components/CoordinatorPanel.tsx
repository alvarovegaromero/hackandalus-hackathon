"use client";

import { useEffect, useState } from "react";
import { coordinatorStateSchema, type CoordinatorState } from "@/lib/contracts/coordinator";

export function useCoordinator() {
  const [state, setState] = useState<CoordinatorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 3000;
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error(`Coordinator unavailable (HTTP ${response.status}).`);
        const next = coordinatorStateSchema.parse(await response.json());
        if (abort.signal.aborted) return;
        delay = next.pollAfterMs;
        setState((previous) =>
          previous?.stateId === next.stateId && previous.revision >= next.revision
            ? previous
            : next,
        );
        setError(null);
      } catch (caught) {
        if (!abort.signal.aborted)
          setError(caught instanceof Error ? caught.message : "Coordinator unavailable.");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  return { state, error };
}

/** Detail for the System card: the model's situation summary and full plan, on demand. */
export default function SituationPanel({ state }: { state: CoordinatorState | null }) {
  if (!state?.situationOverview && !state?.plan) return null;
  return (
    <section className="grid gap-2 border-b border-line pb-4" aria-labelledby="situation-title">
      <h2 id="situation-title" className="text-body font-medium text-muted">
        Situation
      </h2>
      {state.situationOverview && (
        <details className="group text-body">
          <summary className="cursor-pointer list-none">
            <span className="line-clamp-3 group-open:line-clamp-none">
              {state.situationOverview}
            </span>
          </summary>
        </details>
      )}
      {state.plan && (
        <details className="text-meta text-muted">
          <summary className="cursor-pointer">Plan: {state.plan.steps.length} steps</summary>
          <ol className="mt-1 grid list-decimal gap-1 pl-5">
            {state.plan.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
