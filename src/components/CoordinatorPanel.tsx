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
  return (
    <section
      className="mt-4 rounded-[16px] border border-line bg-white p-4 text-sm"
      aria-label="Coordinator"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Coordinator</h2>
        <span className="text-xs text-neutral-500">
          Simulation
          {state
            ? ` · Revision ${state.revision} · ${new Date(state.updatedAt).toLocaleTimeString()}`
            : ""}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-amber-800">
          {error} {state ? "Showing the last available state." : ""}
        </p>
      ) : null}
      {!state ? (
        <p className="mt-3 text-neutral-500">
          {error ? "State could not be loaded." : "Loading coordinator…"}
        </p>
      ) : (
        <>
          <p className="mt-3">
            {state.situationOverview || "Waiting for the coordinator's first assessment."}
          </p>
          <h3 className="mt-4 font-medium">Plan</h3>
          {state.plan ? (
            <>
              <p className="mt-1">{state.plan.objective}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {state.plan.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mt-1 text-neutral-500">
              No plan yet. Reports must be processed by the coordinator worker.
            </p>
          )}
          <h3 className="mt-4 font-medium">
            Ambulances{" "}
            <span className="font-normal text-neutral-500">
              {state.ambulances.available}/{state.ambulances.total} available ·{" "}
              {state.ambulances.allocated} assigned
            </span>
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {state.ambulances.units.map((unit) => {
              const event = state.events.find((item) => item.eventId === unit.eventId);
              return (
                <li
                  key={unit.id}
                  className={`rounded-lg border px-3 py-2 ${unit.status === "assigned" ? "border-blue-200 bg-blue-50" : "border-neutral-200 bg-neutral-50"}`}
                >
                  <p className="text-xs font-medium">
                    {unit.id} · {unit.status}
                  </p>
                  {unit.eventId ? (
                    <p className="mt-1 max-w-64 text-xs">
                      {event?.summary.split("\n")[0] ?? unit.eventId}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
