"use client";

// Operator screen: tactical map plus the live event log.

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CrisisZone } from "@/lib/types";
import AmbulanceCard from "@/components/AmbulanceCard";
import EventLog from "@/components/EventLog";
import CoordinatorPanel, { useCoordinator } from "@/components/CoordinatorPanel";
import { useTelemetry } from "@/components/use-telemetry";

// Leaflet touches `window`, so the map only renders in the browser.
const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
  loading: () => <p>Loading Sierra Bermeja map…</p>,
});

export default function DashboardPage() {
  const [situation, setSituation] = useState<{ zones: CrisisZone[] } | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  const coordinator = useCoordinator();
  const [ambulanceFocus, setAmbulanceFocus] = useState<{ id: string; request: number } | null>(
    null,
  );
  const selectAmbulance = (id: string) => {
    setAmbulanceFocus((previous) => ({ id, request: (previous?.request ?? 0) + 1 }));
  };
  const [startingDemo, setStartingDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const restartEvents = async () => {
    if (startingDemo) return;
    setStartingDemo(true);
    setAmbulanceFocus(null);
    setDemoMessage(null);
    try {
      const reset = await fetch("/api/demo/reset", { method: "POST" });
      if (!reset.ok) {
        const result = await reset.json();
        throw new Error(result.error ?? "Could not reset the coordinator.");
      }
      const response = await fetch("/api/demo/events", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start demo events.");
      setDemoMessage(`Started ${result.count} events, one every 3 seconds.`);
    } catch (caught) {
      setDemoMessage(caught instanceof Error ? caught.message : "Could not start demo events.");
    } finally {
      setStartingDemo(false);
    }
  };

  // Map geography is read-only; viewing the dashboard never advances a scenario.
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/map");
        if (!response.ok) throw new Error(`HTTP ${response.status} on /api/map`);
        const next = (await response.json()) as { zones: CrisisZone[] };
        if (!stopped) {
          setSituation(next);
          setError(null);
        }
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Unexpected error");
      }
    };
    void refresh();
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <main className="shell flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-medium">Faro</h1>
          <Link href="/" prefetch={false} className="text-sm underline underline-offset-4">
            Back to home
          </Link>
        </div>
        {process.env.NODE_ENV === "development" ? (
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-xs text-blueprint-light">
              {demoMessage}
            </span>
            <button
              type="button"
              onClick={restartEvents}
              disabled={startingDemo}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {startingDemo ? "Starting…" : "Reset & run events"}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <CoordinatorPanel
        key={coordinator.state?.stateId ?? "loading"}
        state={coordinator.state}
        error={coordinator.error}
      />
      <AmbulanceCard
        state={coordinator.state}
        records={telemetry.records}
        selectedId={ambulanceFocus?.id}
        stale={!!coordinator.error}
        onSelect={selectAmbulance}
      />
      <div className="event-map-layout">
        <div className="min-w-0">
          <EventLog
            records={telemetry.records}
            status={telemetry.status}
            priorities={coordinator.state?.events}
          />
        </div>
        <div className="min-w-0">
          {situation ? (
            <LeafletMap
              zones={situation.zones}
              events={telemetry.records}
              ambulances={coordinator.state?.ambulances.units}
              ambulanceFocus={ambulanceFocus}
              onSelectAmbulance={selectAmbulance}
              selectedZoneId={selectedZoneId}
              onSelect={(zoneId) => setSelectedZoneId(zoneId === selectedZoneId ? null : zoneId)}
            />
          ) : (
            <p className="flex items-center gap-2">
              <Loader2 className="spin" size={16} aria-hidden="true" /> Loading map…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
