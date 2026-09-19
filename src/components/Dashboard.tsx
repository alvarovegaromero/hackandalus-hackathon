"use client";

// Operator screen. Panorama answers three questions (severity, capacity, system
// activity); the breakdown row below explains each answer in detail.

import { FaroIcon, FaroWordmark } from "@/components/landing/logo";
import { MapSkeleton } from "@/components/Skeleton";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { CrisisZone } from "@/lib/types";
import MissionsPanel, { useMissions } from "@/components/MissionsPanel";
import SituationPanel, { useCoordinator } from "@/components/CoordinatorPanel";
import { useTelemetry } from "@/components/use-telemetry";
import SeverityCard from "@/components/dashboard/severity-card";
import ResourcesCard from "@/components/dashboard/resources-card";
import SystemCard from "@/components/dashboard/system-card";
import PriorityQueue from "@/components/dashboard/priority-queue";
import { allUnits, clock, foldReports, rankEvents } from "@/components/dashboard/model";

// Leaflet touches `window`, so the map only renders in the browser.
const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export default function Dashboard({
  demoControlsEnabled,
  expiresAt,
}: {
  demoControlsEnabled: boolean;
  expiresAt?: number;
}) {
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(
      () => window.location.reload(),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const [situation, setSituation] = useState<{ zones: CrisisZone[] } | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  const coordinator = useCoordinator();
  const missions = useMissions(coordinator.state?.runId);
  const [ambulanceFocus, setAmbulanceFocus] = useState<{ id: string; request: number } | null>(
    null,
  );
  const selectAmbulance = (id: string) => {
    setAmbulanceFocus((previous) => ({ id, request: (previous?.request ?? 0) + 1 }));
  };
  const selectEvent = (id: string) => setSelectedEventId((current) => (current === id ? null : id));
  const [startingDemo, setStartingDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const reports = useMemo(() => foldReports(telemetry.records), [telemetry.records]);
  const ranked = useMemo(
    () => rankEvents(coordinator.state, reports),
    [coordinator.state, reports],
  );
  const discarded = reports.filter((report) => report.filter === "discarded");
  const summaries = new Map(ranked.map((event) => [event.id, event.summary]));
  const priorities = new Map(ranked.map((event) => [event.id, event.priority]));
  const coordinatorLoading = !coordinator.state && !coordinator.error;

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
          setMapError(null);
        }
      } catch (caught) {
        if (!stopped) setMapError(caught instanceof Error ? caught.message : "Unexpected error");
      }
    };
    void refresh();
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <main className="faro-dashboard">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-4">
          <h1 className="flex items-center gap-2">
            <FaroIcon className="h-6 w-6" gradientId="dashboard-brand" />
            <FaroWordmark className="h-4 w-auto" />
            <span className="sr-only">FARO</span>
          </h1>
          <span className="text-body text-muted">Sierra Bermeja wildfire</span>
          {coordinator.state?.executionMode === "simulation" && (
            <span className="rounded-sm border border-muted px-1.5 text-meta font-semibold tracking-wide text-ink uppercase">
              Simulation
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-meta text-muted">
          {coordinator.error ? (
            <span role="alert" className="flex items-center gap-1 text-ink">
              <TriangleAlert size={12} aria-hidden="true" />
              {coordinator.error}
              {coordinator.state && " Showing last known state."}
            </span>
          ) : coordinator.state ? (
            <span className="tabular-nums">
              Updated{" "}
              <time dateTime={coordinator.state.updatedAt}>
                {clock(coordinator.state.updatedAt)}
              </time>
            </span>
          ) : null}
          {demoControlsEnabled && (
            <>
              <span role="status">{demoMessage}</span>
              <button
                type="button"
                onClick={restartEvents}
                disabled={startingDemo}
                className="rounded-md border border-line px-2 py-1 text-meta text-muted hover:text-ink disabled:opacity-50"
              >
                {startingDemo ? "Starting…" : "Reset & run events"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="dashboard-panorama">
        <SeverityCard events={ranked} loading={coordinatorLoading} />
        <ResourcesCard
          state={coordinator.state}
          summaries={summaries}
          selectedId={ambulanceFocus?.id}
          onSelect={selectAmbulance}
        />
        <SystemCard
          state={coordinator.state}
          missions={missions.missions}
          loading={coordinatorLoading}
        />
      </div>

      <div className="dashboard-breakdown">
        <div className="dashboard-queue">
          <PriorityQueue
            events={ranked}
            discarded={discarded}
            status={telemetry.status}
            selectedId={selectedEventId}
            onSelect={selectEvent}
          />
        </div>
        <div className="dashboard-map">
          {situation ? (
            <LeafletMap
              key={coordinator.state?.runId ?? "loading"}
              zones={situation.zones}
              events={telemetry.records}
              priorities={priorities}
              selectedEventId={selectedEventId}
              onSelectEvent={selectEvent}
              ambulances={coordinator.state ? allUnits(coordinator.state) : []}
              ambulanceFocus={ambulanceFocus}
              onSelectAmbulance={selectAmbulance}
              selectedZoneId={selectedZoneId}
              onSelect={(zoneId) => setSelectedZoneId(zoneId === selectedZoneId ? null : zoneId)}
            />
          ) : mapError ? (
            <p role="status" className="flex items-center gap-1 text-meta">
              <TriangleAlert size={12} aria-hidden="true" /> Map could not be loaded ({mapError}).
            </p>
          ) : (
            <MapSkeleton />
          )}
        </div>
        <aside className="dashboard-agents" aria-label="Agent activity">
          <SituationPanel state={coordinator.state} />
          <MissionsPanel
            missions={missions.missions}
            loading={missions.loading && !coordinator.error}
            unavailable={missions.error || (!coordinator.state && !!coordinator.error)}
          />
        </aside>
      </div>
    </main>
  );
}
