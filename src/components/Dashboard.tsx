"use client";

// Operator screen. The pipeline strip follows the system left to right (reports
// filtered, incidents ranked, units deployed, agents at work); below it the
// priority queue, the Sierra Bermeja map as hero, and the plan and mission log.

import { FaroIcon, FaroWordmark } from "@/components/landing/logo";
import { MapSkeleton } from "@/components/Skeleton";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { CrisisZone } from "@/lib/types";
import MissionsPanel, { useMissions } from "@/components/MissionsPanel";
import PlanPanel, { useCoordinator } from "@/components/CoordinatorPanel";
import { useTelemetry } from "@/components/use-telemetry";
import SeverityCard from "@/components/dashboard/severity-card";
import ResourcesCard from "@/components/dashboard/resources-card";
import SystemCard from "@/components/dashboard/system-card";
import IntakeCard from "@/components/dashboard/intake-card";
import PriorityQueue from "@/components/dashboard/priority-queue";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  allUnits,
  clock,
  foldReports,
  rankEvents,
} from "@/components/dashboard/model";

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

  const live = telemetry.status === "Live" && !coordinator.error;

  return (
    <main className="faro-dashboard">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1">
        <div className="flex items-center gap-4">
          <h1 className="flex items-center gap-2">
            <FaroIcon className="h-6 w-6" gradientId="dashboard-brand" />
            <FaroWordmark className="h-4 w-auto" />
            <span className="sr-only">FARO</span>
          </h1>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <span className="text-body text-ink">Sierra Bermeja wildfire</span>
          <span className="text-body text-muted">112 Andalucía</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-meta text-muted">
          {coordinator.error ? (
            <span role="alert" className="flex items-center gap-1 text-ink">
              <TriangleAlert size={12} aria-hidden="true" />
              {coordinator.error}
              {coordinator.state && " Showing last known state."}
            </span>
          ) : null}
          <span className="glass flex items-center gap-2 rounded-full px-3 py-1">
            <span className="live-dot" data-state={live ? "live" : "down"} aria-hidden="true" />
            <span className="text-ink">{live ? "Live" : telemetry.status}</span>
            {coordinator.state && (
              <span className="tabular-nums">
                · updated{" "}
                <time dateTime={coordinator.state.updatedAt}>
                  {clock(coordinator.state.updatedAt)}
                </time>
              </span>
            )}
          </span>
          {coordinator.state?.executionMode === "simulation" && (
            <span className="rounded-full border border-medium/40 px-3 py-1 text-medium">
              Simulation · no live calls
            </span>
          )}
          {demoControlsEnabled && (
            <>
              <span role="status">{demoMessage}</span>
              <button
                type="button"
                onClick={restartEvents}
                disabled={startingDemo}
                className="rounded-full bg-focus px-3 py-1 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {startingDemo ? "Starting…" : "Reset & run events"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="dashboard-pipeline">
        <IntakeCard reports={reports} />
        <SeverityCard events={ranked} loading={coordinatorLoading} />
        <ResourcesCard
          state={coordinator.state}
          summaries={summaries}
          selectedId={ambulanceFocus?.id}
          onSelect={selectAmbulance}
        />
        <SystemCard
          missions={missions.missions}
          loading={coordinatorLoading}
          unavailable={missions.error || !!coordinator.error}
        />
      </div>

      <div className="dashboard-main">
        <PriorityQueue
          events={ranked}
          discarded={discarded}
          status={telemetry.status}
          selectedId={selectedEventId}
          onSelect={selectEvent}
        />
        <div className="dashboard-map glass relative overflow-hidden p-0">
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
            <p role="status" className="flex items-center gap-1 p-4 text-meta">
              <TriangleAlert size={12} aria-hidden="true" /> Map could not be loaded ({mapError}).
            </p>
          ) : (
            <MapSkeleton />
          )}
          <ul
            className="glass pointer-events-none absolute top-3 right-3 z-[1000] flex gap-3 rounded-full px-3 py-1.5 text-meta text-muted"
            aria-label="Map legend"
          >
            {PRIORITIES.slice(0, 4).map((level) => (
              <li key={level} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: `var(--${level})` }}
                />
                {PRIORITY_LABELS[level]}
              </li>
            ))}
          </ul>
          {coordinator.state?.situationOverview && (
            <section
              className="glass absolute bottom-3 left-3 z-[1000] w-[min(460px,calc(100%-24px))] px-4 py-3"
              aria-labelledby="situation-title"
            >
              <h2 id="situation-title" className="text-meta text-muted">
                Situation assessment
              </h2>
              <p
                className="mt-1 line-clamp-3 text-body leading-snug"
                title={coordinator.state.situationOverview}
              >
                {coordinator.state.situationOverview}
              </p>
            </section>
          )}
        </div>
        <aside className="glass flex flex-col gap-4 p-4" aria-label="Agent activity">
          <PlanPanel state={coordinator.state} />
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
