"use client";

// Sierra Bermeja tactical map. Event pins come from the live SSE telemetry stream.

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Popup, CircleMarker, useMap } from "react-leaflet";
import type { TelemetryRecord } from "@/lib/event-pipeline";
import type { CrisisZone, Severity } from "@/lib/types";

interface Props {
  zones: CrisisZone[];
  /** Telemetry records (SSE); `event.accepted` ones with coordinates are plotted. */
  events?: TelemetryRecord[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
  /** Called once if the base map cannot load any tiles. */
  onTilesUnavailable?: () => void;
}

// Los trazados de Leaflet (SVG) necesitan colores literales: reflejan --red,
// --amber y --blue de globals.css.
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

export default function LeafletMap({
  zones,
  events = [],
  selectedZoneId,
  onTilesUnavailable,
}: Props) {
  const tiles = useRef({ loaded: 0, failed: 0, reported: false });
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

        {eventPins(events).map((pin) => (
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
      </MapContainer>
    </div>
  );
}
