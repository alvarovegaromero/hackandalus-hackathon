"use client";

// Sierra Bermeja tactical map. Event pins come from the live SSE telemetry stream.

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Popup, CircleMarker, Marker, useMap } from "react-leaflet";
import { divIcon, type Marker as LeafletMarker } from "leaflet";
import { assignedEventLocations } from "./AmbulanceCard";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import type { TelemetryRecord } from "@/lib/event-pipeline";
import type { CrisisZone, Severity } from "@/lib/types";

interface Props {
  zones: CrisisZone[];
  ambulances?: CoordinatorState["ambulances"]["units"];
  ambulanceFocus?: { id: string; request: number } | null;
  onSelectAmbulance?: (id: string) => void;
  /** Telemetry records (SSE); `event.accepted` ones with coordinates are plotted. */
  events?: TelemetryRecord[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
  /** Called once if the base map cannot load any tiles. */
  onTilesUnavailable?: () => void;
}

// Leaflet SVG paths require literal colors matching the CSS palette.
const colors = { danger: "#a11b12", warn: "#96490f", info: "#17527f", fire: "#e05638" };

const severityColors: Record<Severity, string> = {
  low: colors.info,
  medium: colors.warn,
  high: colors.fire,
  critical: colors.danger,
};

interface EventPin {
  id: string;
  position: [number, number];
  title: string;
  severity: Severity;
  reference: string;
  description?: string;
}

// Telemetry payloads are untyped JSON: keep only accepted events with a valid
// coordinate pair. Events without coordinates are not drawn (none are invented).
function eventPins(records: TelemetryRecord[]): EventPin[] {
  const pins: EventPin[] = [];
  for (const record of records) {
    if (record.type !== "event.accepted") continue;
    const { location, title, severity } = record.payload as {
      location?: {
        latitude?: unknown;
        longitude?: unknown;
        reference?: unknown;
        description?: unknown;
      };
      title?: unknown;
      severity?: unknown;
    };
    if (typeof location?.latitude !== "number" || typeof location.longitude !== "number") continue;
    pins.push({
      id: record.id,
      position: [location.latitude, location.longitude],
      title: typeof title === "string" ? title : "Event",
      severity:
        typeof severity === "string" && severity in severityColors
          ? (severity as Severity)
          : "medium",
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
  useEffect(() => {
    if (!pins.length) {
      seen.current.clear();
      return;
    }
    const fresh = pins.filter((pin) => !seen.current.has(pin.id));
    seen.current = new Set(pins.map((pin) => pin.id));
    if (!fresh.length) return;
    map.stop();
    map.fitBounds(
      pins.slice(-8).map((pin) => pin.position),
      {
        padding: [60, 60],
        maxZoom: 15,
        animate: false,
      },
    );
  }, [map, pins]);
  return null;
}

export default function LeafletMap({
  zones,
  events = [],
  ambulances = [],
  ambulanceFocus,
  onSelectAmbulance,
  selectedZoneId,
  onTilesUnavailable,
}: Props) {
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
    <div className="relative w-full h-[480px] rounded-[16px] overflow-hidden border border-line shadow-xs">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
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
            radius={8}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: severityColors[pin.severity],
              fillOpacity: 0.95,
              // Only an explicit incident pin is solid; reporter/unknown positions are dashed.
              dashArray: pin.reference === "incident" ? undefined : "3, 3",
            }}
          >
            <Popup>
              <div className="p-1 text-[12px] font-sans">
                <b className="text-ink">{pin.title}</b>
                <p className="text-neutral-700 mt-1">
                  Severity {pin.severity} · location {pin.reference}
                </p>
                {pin.description ? (
                  <p className="text-neutral-500 mt-1">{pin.description}</p>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {[...groups.entries()].map(([key, group]) => (
          <AmbulanceMarker
            key={key}
            group={group}
            focus={ambulanceFocus}
            onSelect={onSelectAmbulance}
          />
        ))}
      </MapContainer>
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
  const map = useMap();
  const marker = useRef<LeafletMarker>(null);
  const selected = group.units.some((unit) => unit.id === focus?.id);
  const [lat, lng] = group.position;
  useEffect(() => {
    if (!selected) return;
    map.stop();
    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: false });
    marker.current?.openPopup();
  }, [selected, focus?.request, lat, lng, map]);
  const unitId = (group.units.find((unit) => unit.id === focus?.id) ?? group.units[0]).id;
  const medical = unitId.startsWith("ambulance-");
  const civilGuard = unitId.startsWith("civil-guard-");
  const icon = divIcon({
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:${selected ? "#1d4ed8" : "#fff"};color:${selected ? "#fff" : "#1d4ed8"};border:2px solid #1d4ed8;border-radius:12px;box-shadow:0 2px 8px #0003"><svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${medical ? '<path d="M10 10H6m2-2v4M3 17V5h11v12M14 9h4l3 4v4h-3M7 17h7M17 10v3h4"/><circle cx="5" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>' : civilGuard ? '<path d="M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>' : '<path d="M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/>'}</svg>${group.units.length > 1 ? `<span style="position:absolute;right:-6px;top:-6px;background:#1d4ed8;color:white;border-radius:99px;padding:1px 5px;font-size:11px">${group.units.length}</span>` : ""}</div>`,
  });
  return (
    <Marker
      ref={marker}
      position={group.position}
      icon={icon}
      zIndexOffset={selected ? 1100 : 1000}
      title={group.units.map((unit) => unit.id).join(", ")}
      alt={
        medical ? "Assigned ambulance" : civilGuard ? "Assigned Guardia Civil" : "Assigned Policía"
      }
      eventHandlers={{ click: () => onSelect?.(group.units[0].id) }}
    >
      <Popup autoPan={false}>
        <div className="text-xs">
          {group.units.map((unit) => (
            <div key={unit.id} className="mb-2">
              <strong>{unit.id}</strong>
              <p>{unit.title}</p>
            </div>
          ))}
          <p className="text-neutral-500">Assigned report location · not vehicle GPS</p>
        </div>
      </Popup>
    </Marker>
  );
}
