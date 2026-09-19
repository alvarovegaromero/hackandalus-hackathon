"use client";

import { TextSkeleton } from "./Skeleton";
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

type PanelProps = { state: CoordinatorState | null; error: string | null };

export function OverviewPanel({ state, error }: PanelProps) {
  return (
    <section className="dashboard-overview" aria-label="Overview">
      <h2>Overview</h2>
      {!state && !error ? (
        <TextSkeleton />
      ) : (
        <p>
          {state?.situationOverview ||
            (error ? "Situation unavailable." : "Waiting for the first assessment.")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-amber-800">
          {error}
        </p>
      )}
    </section>
  );
}

export default function CoordinatorPanel({ state, error }: PanelProps) {
  const plan = state?.plan;
  return (
    <section className="orchestrator-panel" aria-label="Orchestrator">
      <h2>
        <span className="agent-node" aria-hidden="true" /> Orchestrator
      </h2>
      {!state && !error ? (
        <TextSkeleton />
      ) : plan ? (
        <>
          <p className="plan-objective">{plan.objective}</p>
          <ol>
            {plan.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-neutral-500">
          {error ? "Plan unavailable." : "Waiting for report assessment."}
        </p>
      )}
    </section>
  );
}
