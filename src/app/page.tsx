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
      <h1 className="text-[16px] font-medium">FARO · Sierra Bermeja</h1>
      {error ? <p role="alert">{error}</p> : null}
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
      <EventLog records={telemetry.records} status={telemetry.status} />
    </main>
  );
}
