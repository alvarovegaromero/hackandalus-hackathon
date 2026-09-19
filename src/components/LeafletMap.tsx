"use client";

// Sierra Bermeja tactical map. Event pins come from the live SSE telemetry stream.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Marker, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { resourceSummary } from "./resource-summary";
import { assignedEventLocations, type PriorityLevel } from "./dashboard/model";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import type { TelemetryRecord } from "@/lib/event-pipeline";
import type { CrisisZone } from "@/lib/types";

interface Props {
  zones: CrisisZone[];
  ambulances?: CoordinatorState["ambulances"]["units"];
  ambulanceFocus?: { id: string; request: number } | null;
  onSelectAmbulance?: (id: string) => void;
  /** Telemetry records (SSE); `event.accepted` ones with coordinates are plotted. */
  events?: TelemetryRecord[];
  /** Coordinator priority by event ID; pins without one render as unassessed. */
  priorities?: Map<string, PriorityLevel>;
  selectedEventId?: string | null;
  onSelectEvent?: (eventId: string) => void;
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
  /** Called once if the base map cannot load any tiles. */
  onTilesUnavailable?: () => void;
}

interface EventPin {
  id: string;
  position: [number, number];
  title: string;
  eventId: string;
  reference: string;
  description?: string;
}

// Telemetry payloads are untyped JSON: keep only accepted events with a valid
// coordinate pair. Events without coordinates are not drawn (none are invented).
function eventPins(records: TelemetryRecord[]): EventPin[] {
  const pins: EventPin[] = [];
  for (const record of records) {
    if (record.type !== "event.accepted") continue;
    const { location, title } = record.payload as {
      location?: {
        latitude?: unknown;
        longitude?: unknown;
        reference?: unknown;
        description?: unknown;
      };
      title?: unknown;
    };
    if (typeof location?.latitude !== "number" || typeof location.longitude !== "number") continue;
    pins.push({
      id: record.id,
      position: [location.latitude, location.longitude],
      title: typeof title === "string" ? title : "Event",
      eventId: record.eventId,
      reference: typeof location.reference === "string" ? location.reference : "unknown",
      description: typeof location.description === "string" ? location.description : undefined,
    });
  }
  return pins;
}

const defaultCenter: [number, number] = [36.525, -5.185];
const tilesFailedThreshold = 6;

// Recenter only when the selected coordinates change.
function FlyToSelected({ lat, lng }: { lat: number | undefined; lng: number | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}

// Follow genuinely new geolocated reports, not filtering updates or polling renders.
function FollowEvents({ pins }: { pins: EventPin[] }) {
  const map = useMap();
  const seen = useRef(new Set<string>());
  const interacting = useRef(false);
  useEffect(() => {
    const container = map.getContainer();
    const stopFollowing = () => {
      interacting.current = true;
    };
    container.addEventListener("pointerdown", stopFollowing);
    container.addEventListener("wheel", stopFollowing, { passive: true });
    container.addEventListener("keydown", stopFollowing);
    return () => {
      container.removeEventListener("pointerdown", stopFollowing);
      container.removeEventListener("wheel", stopFollowing);
      container.removeEventListener("keydown", stopFollowing);
    };
  }, [map]);
  useEffect(() => {
    if (!pins.length) {
      seen.current.clear();
      interacting.current = false;
      return;
    }
    const fresh = pins.filter((pin) => !seen.current.has(pin.id));
    seen.current = new Set(pins.map((pin) => pin.id));
    if (!fresh.length || interacting.current) return;
    map.stop();
    map.fitBounds(
      pins.slice(0, 8).map((pin) => pin.position),
      {
        padding: [60, 60],
        maxZoom: 14,
        animate: false,
      },
    );
  }, [map, pins]);
  return null;
}

export default function LeafletMap({
  zones,
  events = [],
  priorities = new Map(),
  selectedEventId,
  onSelectEvent,
  ambulances = [],
  ambulanceFocus,
  onSelectAmbulance,
  selectedZoneId,
  onTilesUnavailable,
}: Props) {
  const [selection, setSelection] = useState<{ title: string; resources?: string[] } | null>(null);
  const tiles = useRef({ loaded: 0, failed: 0, reported: false });
  const pins = eventPins(events);
  const locations = assignedEventLocations(events);
  const groups = new Map<
    string,
    { position: [number, number]; units: { id: string; title: string }[] }
  >();
  for (const unit of ambulances) {
    const location = unit.eventId ? locations.get(unit.eventId) : undefined;
    if (unit.status !== "assigned" || !location) continue;
    const key = location.position.join(",");
    const group = groups.get(key) ?? { position: location.position, units: [] };
    group.units.push({ id: unit.id, title: location.title });
    groups.set(key, group);
  }
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          eventHandlers={{
            tileload: () => {
              tiles.current.loaded += 1;
            },
            tileerror: () => {
              const state = tiles.current;
              state.failed += 1;
              if (state.loaded === 0 && state.failed >= tilesFailedThreshold && !state.reported) {
                state.reported = true;
                onTilesUnavailable?.();
              }
            },
          }}
        />

        <FlyToSelected lat={selectedZone?.coordinates.lat} lng={selectedZone?.coordinates.lng} />

        <FollowEvents pins={pins} />

        {pins.map((pin) => (
          <CircleMarker
            key={pin.id}
            center={pin.position}
            radius={pin.eventId === selectedEventId ? 11 : 7}
            eventHandlers={{
              click: () => {
                onSelectEvent?.(pin.eventId);
                setSelection({ title: pin.title });
              },
            }}
            pathOptions={{
              // Fill comes from the priority token in CSS; Leaflet only sets the class.
              className: `map-pin map-pin-${priorities.get(pin.eventId) ?? "unassessed"}`,
              // Only an explicit incident pin is solid; reporter/unknown positions are dashed.
              dashArray: pin.reference === "incident" ? undefined : "3, 3",
            }}
          ></CircleMarker>
        ))}
        {[...groups.entries()].map(([key, group]) => (
          <AmbulanceMarker
            key={key}
            group={group}
            focus={ambulanceFocus}
            onSelect={(id) => {
              onSelectAmbulance?.(id);
              setSelection({
                title: [...new Set(group.units.map((unit) => unit.title))].join(" · "),
                resources: group.units.map((unit) => unit.id),
              });
            }}
          />
        ))}
      </MapContainer>
      {selection && (
        <div className="map-selection" role="region" aria-label="Selected location">
          <button
            type="button"
            aria-label="Close location details"
            onClick={() => setSelection(null)}
          >
            ×
          </button>
          <p>{selection.title}</p>
          {selection.resources && (
            <p className="mt-1 text-meta text-muted">{resourceSummary(selection.resources)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function AmbulanceMarker({
  group,
  focus,
  onSelect,
}: {
  group: { position: [number, number]; units: { id: string; title: string }[] };
  focus?: { id: string; request: number } | null;
  onSelect?: (id: string) => void;
}) {
  const selected = group.units.some((unit) => unit.id === focus?.id);
  const unitId = (group.units.find((unit) => unit.id === focus?.id) ?? group.units[0]).id;
  const medical = unitId.startsWith("ambulance-");
  const civilGuard = unitId.startsWith("civil-guard-");
  const icon = divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 34],
    html: `<div class="unit-marker" data-selected="${selected}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${medical ? '<path d="M10 10H6m2-2v4M3 17V5h11v12M14 9h4l3 4v4h-3M7 17h7M17 10v3h4"/><circle cx="5" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>' : civilGuard ? '<path d="M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>' : '<path d="M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/>'}</svg>${group.units.length > 1 ? `<span>${group.units.length}</span>` : ""}</div>`,
  });
  return (
    <Marker
      position={group.position}
      icon={icon}
      zIndexOffset={selected ? 1100 : 1000}
      title={group.units.map((unit) => unit.id).join(", ")}
      alt={
        medical ? "Assigned ambulance" : civilGuard ? "Assigned Guardia Civil" : "Assigned Policía"
      }
      eventHandlers={{ click: () => onSelect?.(group.units[0].id) }}
    ></Marker>
  );
}
