"use client";

// Operator screen: tactical map plus the live event log.

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { SituationState } from "@/lib/types";
import EventLog from "@/components/EventLog";
import { maybe } from "@/components/shared";
import { useTelemetry } from "@/components/use-telemetry";

const POLL_MS = 4000;

// Leaflet touches `window`, so the map only renders in the browser.
const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
  loading: () => <p>Loading Sierra Bermeja map…</p>,
});

export default function Home() {
  const [situation, setSituation] = useState<SituationState | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  const [startingDemo, setStartingDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const restartEvents = async () => {
    if (startingDemo) return;
    setStartingDemo(true);
    setDemoMessage(null);
    try {
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

  // GET /api/situation also advances the scenario script.
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/situation");
        if (!response.ok) throw new Error(`HTTP ${response.status} on /api/situation`);
        const next = (await response.json()) as SituationState;
        if (!stopped) {
          setSituation(next);
          setError(null);
        }
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Unexpected error");
      }
    };
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="shell flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[16px] font-medium">Faro</h1>
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
      <div className="event-map-layout">
        <div className="min-w-0">
          <EventLog records={telemetry.records} status={telemetry.status} />
        </div>
        <div className="min-w-0">
          {situation ? (
            <LeafletMap
              zones={situation.zones}
              plan={situation.plan}
              world={maybe(situation, "world")}
              events={telemetry.records}
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
