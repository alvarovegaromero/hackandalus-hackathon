"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
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

/** The coordinator's current plan: objective up front, steps on demand. */
export default function PlanPanel({ state }: { state: CoordinatorState | null }) {
  if (!state?.plan) return null;
  return (
    <section
      className="grid gap-2 rounded-xl border border-focus/30 bg-gradient-to-br from-focus/15 via-focus/[0.05] to-transparent p-3"
      aria-labelledby="plan-title"
    >
      <h2 id="plan-title" className="flex items-center gap-2 text-body font-medium text-focus">
        <Sparkles size={14} aria-hidden="true" />
        Coordinator plan
        <span className="ml-auto text-meta font-normal text-muted tabular-nums">
          rev. {state.revision}
        </span>
      </h2>
      <p className="line-clamp-3 text-lead leading-snug" title={state.plan.objective}>
        {state.plan.objective}
      </p>
      <details className="text-meta text-muted">
        <summary className="cursor-pointer hover:text-ink">{state.plan.steps.length} steps</summary>
        <ol className="mt-1 grid list-decimal gap-1 pl-5">
          {state.plan.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
