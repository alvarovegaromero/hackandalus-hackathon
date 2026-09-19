"use client";

import Skeleton from "./Skeleton";
import { Ambulance, Shield, ShieldCheck } from "lucide-react";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import type { TelemetryRecord } from "@/lib/event-pipeline";

export function assignedEventLocations(records: TelemetryRecord[]) {
  const locations = new Map<string, { position: [number, number]; title: string }>();
  for (const record of records) {
    if (record.type !== "event.accepted") continue;
    const location = record.payload.location as
      { latitude?: unknown; longitude?: unknown } | undefined;
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      continue;
    locations.set(record.eventId, {
      position: [lat, lng],
      title: typeof record.payload.title === "string" ? record.payload.title : "Assigned event",
    });
  }
  return locations;
}

export default function AmbulanceCard({
  state,
  stale,
  kind = "ambulances",
}: {
  kind?: "ambulances" | "police" | "civilGuard";
  state: CoordinatorState | null;
  records: TelemetryRecord[];
  selectedId?: string;
  stale: boolean;
  onSelect: (id: string) => void;
}) {
  const inventory = state?.[kind];
  const label = { ambulances: "Ambulances", police: "Policía", civilGuard: "Guardia Civil" }[kind];
  const Icon = kind === "ambulances" ? Ambulance : kind === "police" ? Shield : ShieldCheck;
  return (
    <section className="resource-summary" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Icon size={20} aria-hidden="true" /> {label}
        </h2>
        <dl className="flex gap-6 text-sm">
          {[
            ["Total", inventory?.total],
            ["Assigned", inventory?.allocated],
            ["Available", inventory?.available],
          ].map(([label, count]) => (
            <div key={label}>
              <dt className="text-xs text-neutral-500">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {!state && !stale ? <Skeleton className="h-7 w-8" /> : (count ?? "—")}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {stale ? (
        <p role="status" className="mt-2 text-xs text-amber-800">
          Resource state unavailable{state ? " · showing last known values" : ""}.
        </p>
      ) : null}
      {!state && !stale ? (
        <div className="mt-3" role="status" aria-label="Loading resources">
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : null}
    </section>
  );
}
