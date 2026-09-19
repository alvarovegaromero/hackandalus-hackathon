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

export default function CoordinatorPanel({
  state,
  error,
}: {
  state: CoordinatorState | null;
  error: string | null;
}) {
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const plan = state?.plan;
  const buttonClass =
    "mt-3 text-xs font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <section aria-label="Situation and plan" className="flex flex-col gap-2">
      <div className="flex justify-end text-xs text-neutral-500">
        Simulation
        {state
          ? ` · Revision ${state.revision} · Updated ${new Date(state.updatedAt).toLocaleTimeString()}`
          : ""}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-amber-800">
          {error} {state ? "Showing the last available state." : ""}
        </p>
      ) : null}
      <div className="coordinator-cards">
        <section
          className="min-w-0 rounded-[16px] border border-line bg-white p-4 text-sm"
          aria-labelledby="overview-heading"
        >
          <h2 id="overview-heading" className="font-medium">
            Overview
          </h2>
          <p
            id="overview-content"
            className={`mt-3 leading-relaxed ${overviewExpanded ? "" : "line-clamp-6"}`}
          >
            {state?.situationOverview ||
              (error && !state
                ? "State could not be loaded."
                : "Waiting for the first assessment.")}
          </p>
          {state?.situationOverview ? (
            <button
              type="button"
              className={buttonClass}
              aria-expanded={overviewExpanded}
              aria-controls="overview-content"
              onClick={() => setOverviewExpanded(!overviewExpanded)}
            >
              {overviewExpanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </section>
        <section
          className="min-w-0 rounded-[16px] border border-line bg-white p-4 text-sm"
          aria-labelledby="plan-heading"
        >
          <h2 id="plan-heading" className="font-medium">
            Plan
          </h2>
          {plan ? (
            <>
              <p className="mt-3 font-medium leading-relaxed">{plan.objective}</p>
              <ol id="plan-steps" className="mt-3 list-decimal space-y-2 pl-5 text-neutral-700">
                {(planExpanded ? plan.steps : plan.steps.slice(0, 3)).map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
              {plan.steps.length > 3 ? (
                <button
                  type="button"
                  className={buttonClass}
                  aria-expanded={planExpanded}
                  aria-controls="plan-steps"
                  onClick={() => setPlanExpanded(!planExpanded)}
                >
                  {planExpanded ? "Show less" : `Show more (${plan.steps.length - 3} more steps)`}
                </button>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-neutral-500">No plan yet. Waiting for report assessment.</p>
          )}
        </section>
      </div>
    </section>
  );
}
