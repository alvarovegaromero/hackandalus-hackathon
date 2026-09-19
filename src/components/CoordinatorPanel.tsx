"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorStateSchema, type CoordinatorState } from "@/lib/contracts/coordinator";
import Skeleton from "@/components/Skeleton";

export function useCoordinator() {
  const [state, setState] = useState<CoordinatorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const [pollGeneration, setPollGeneration] = useState(0);
  const applyReset = useCallback((value: unknown) => {
    const next = coordinatorStateSchema.parse(value);
    generation.current++;
    setState(next);
    setError(null);
    setPollGeneration(generation.current);
  }, []);
  useEffect(() => {
    const currentGeneration = generation.current;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 3000;
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error(`Coordinator unavailable (HTTP ${response.status}).`);
        const next = coordinatorStateSchema.parse(await response.json());
        if (abort.signal.aborted || currentGeneration !== generation.current) return;
        delay = next.pollAfterMs;
        setState((previous) =>
          previous?.stateId === next.stateId && previous.revision >= next.revision
            ? previous
            : next,
        );
        setError(null);
      } catch (caught) {
        if (!abort.signal.aborted && currentGeneration === generation.current)
          setError(caught instanceof Error ? caught.message : "Coordinator unavailable.");
      } finally {
        if (!abort.signal.aborted && currentGeneration === generation.current)
          timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [pollGeneration]);
  return { state, error, applyReset };
}

/** Detail for the System card: the model's situation summary and full plan, on demand. */
export default function SituationPanel({
  state,
  loading,
}: {
  state: CoordinatorState | null;
  loading: boolean;
}) {
  if (!loading && !state?.situationOverview && !state?.plan) return null;
  return (
    <section className="grid gap-2 border-b border-line pb-4" aria-labelledby="situation-title">
      <h2 id="situation-title" className="text-body font-medium text-muted">
        Situation
      </h2>
      {loading ? (
        <div role="status" aria-label="Loading situation" className="grid gap-2">
          <div className="grid h-[4.5em] content-center gap-1.5 text-body">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
          <Skeleton className="h-[1.5em] w-24 text-meta" />
        </div>
      ) : null}
      {!loading && state?.situationOverview && (
        <details className="group min-h-[4.5em] text-body">
          <summary className="cursor-pointer list-none">
            <span className="line-clamp-3 group-open:line-clamp-none">
              {state.situationOverview}
            </span>
          </summary>
        </details>
      )}
      {!loading && state?.plan && (
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
