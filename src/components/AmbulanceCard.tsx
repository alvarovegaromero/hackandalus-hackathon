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
  records,
  selectedId,
  stale,
  onSelect,
  kind = "ambulances",
}: {
  kind?: "ambulances" | "police" | "civilGuard";
  state: CoordinatorState | null;
  records: TelemetryRecord[];
  selectedId?: string;
  stale: boolean;
  onSelect: (id: string) => void;
}) {
  const locations = assignedEventLocations(records);
  const inventory = state?.[kind];
  const label = { ambulances: "Ambulances", police: "Policía", civilGuard: "Guardia Civil" }[kind];
  const Icon = kind === "ambulances" ? Ambulance : kind === "police" ? Shield : ShieldCheck;
  const assigned = inventory?.units.filter((unit) => unit.status === "assigned") ?? [];
  return (
    <section className="rounded-[16px] border border-line bg-white p-4" aria-label={label}>
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
      ) : assigned.length ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-2">
            {assigned.map((unit) => {
              const location = unit.eventId ? locations.get(unit.eventId) : undefined;
              const title = state?.events
                .find((event) => event.eventId === unit.eventId)
                ?.summary.split("\n")[0];
              return (
                <li key={unit.id}>
                  <button
                    type="button"
                    disabled={!location}
                    onClick={() => onSelect(unit.id)}
                    aria-pressed={selectedId === unit.id}
                    title={
                      location
                        ? `Show ${unit.id}: ${title ?? location.title}`
                        : "Assigned event has no coordinates available"
                    }
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${selectedId === unit.id ? "border-blue-600 bg-blue-100 text-blue-900" : "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100"}`}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="font-medium">{unit.id}</span>
                    {!location ? <span>Location unavailable</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-neutral-500">
            Select an assigned unit to locate its report. Positions show assignments, not vehicle
            GPS.
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">
          {state ? "No units assigned." : "Resources could not be loaded."}
        </p>
      )}
    </section>
  );
}
