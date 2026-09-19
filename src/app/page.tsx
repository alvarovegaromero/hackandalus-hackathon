"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CrisisZone, Plan } from "@/lib/types";
import { coordinatorStateSchema, type CoordinatorState } from "@/lib/contracts/coordinator";
import EventLog from "@/components/EventLog";
import { useTelemetry } from "@/components/use-telemetry";

const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
  loading: () => <p>Loading map?</p>,
});
const mapPlan: Plan = {
  id: "map-context",
  version: 0,
  previousVersion: null,
  generatedAt: "",
  summary: "Illustrative geography",
  priorities: [],
  proposedActionIds: [],
  invalidatedActionIds: [],
  changes: [],
  trigger: "static-map",
};

export default function Home() {
  const [state, setState] = useState<CoordinatorState | null>(null);
  const [zones, setZones] = useState<CrisisZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/map", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Map unavailable");
        return r.json();
      })
      .then((data) => setZones(data.zones))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (stopped || busy) return;
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(refresh, 3000);
        return;
      }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch("/api/state", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("Coordinator state unavailable; displayed data may be stale.");
        const next = coordinatorStateSchema.parse(await response.json());
        if (!stopped) {
          setState((previous) =>
            previous?.stateId === next.stateId && previous.revision > next.revision
              ? previous
              : next,
          );
          setError(null);
        }
      } catch {
        if (!stopped) setError("Coordinator state unavailable; displayed data may be stale.");
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!stopped) timer = setTimeout(refresh, 3000);
      }
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return (
    <main className="shell flex flex-col gap-4">
      <h1 className="text-[16px] font-medium">FARO ? Sierra Bermeja</h1>
      <p>
        Simulated coordination. Assigned ambulances remain committed; resource release is not
        enabled.
      </p>
      {error && <p role="alert">{error}</p>}
      {state ? (
        <section className="flex flex-col gap-3" aria-label="Current coordination state">
          <p>
            <strong>
              Available ambulances: {state.ambulances.available}/{state.ambulances.total}
            </strong>{" "}
            ? Assigned: {state.ambulances.allocated} ? Revision {state.revision}
          </p>
          <p>{state.situationOverview || "Awaiting the first coordinated situation update."}</p>
          {state.plan && (
            <div>
              <h2>{state.plan.objective}</h2>
              <ol className="list-decimal pl-5">
                {state.plan.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          <ul>
            {state.events.map((event) => (
              <li key={event.eventId}>
                <strong>{event.priority ?? "Pending priority"}</strong>: {event.summary}
                <p>{event.rationale}</p>
              </li>
            ))}
          </ul>
          <details>
            <summary>Ambulance assignments</summary>
            <ul>
              {state.ambulances.units.map((unit) => (
                <li key={unit.id}>
                  {unit.id}: {unit.status}
                  {unit.eventId ? " ? " + unit.eventId : ""}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : (
        <p>Loading coordinator state?</p>
      )}
      {zones.length > 0 && (
        <LeafletMap
          zones={zones}
          plan={mapPlan}
          events={telemetry.records}
          selectedZoneId={selectedZoneId}
          onSelect={(id) => setSelectedZoneId(id === selectedZoneId ? null : id)}
        />
      )}
      <EventLog records={telemetry.records} status={telemetry.status} />
    </main>
  );
}
