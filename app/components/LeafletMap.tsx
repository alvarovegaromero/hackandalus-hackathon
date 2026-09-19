"use client";

// Mapa táctico de Sierra Bermeja. El trazado de las carreteras y el foco del
// incendio son ilustrativos (demo): lo que sí es real es que reaccionan al
// mundo simulado (carretera cortada, viento) y a la selección de zona.

import { useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import type { CrisisZone, Plan, WorldState, ZoneStatus } from "@/lib/types";
import { zoneStatusLabels } from "./shared";

interface Props {
  zones: CrisisZone[];
  plan: Plan;
  world?: WorldState;
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
  /** Se avisa una vez si el mapa base no carga ningún tile (sin red). */
  onTilesUnavailable?: () => void;
}

// Los trazados de Leaflet (SVG) necesitan colores literales: reflejan --red,
// --amber y --blue de globals.css.
const colors = { danger: "#a11b12", warn: "#96490f", info: "#17527f", fire: "#e05638" };

// Carretera A-397 (Ronda - Costa del Sol). Trazado aproximado.
const a397Coordinates: [number, number][] = [
  [36.742, -5.165],
  [36.671, -5.112],
  [36.601, -5.087],
  [36.535, -5.032],
  [36.488, -4.985],
];

// Carretera alternativa MA-8301 (Jubrique - Peñas Blancas - Estepona). Trazado
// ilustrativo: une los núcleos de la demo, no sigue la geometría real.
const ma8301Coordinates: [number, number][] = [
  [36.565, -5.215],
  [36.544, -5.234],
  [36.512, -5.187],
  [36.427, -5.145],
];

const defaultCenter: [number, number] = [36.525, -5.185];
const fireOrigin: [number, number] = [36.52, -5.14];
const tilesFailedThreshold = 6;

// Con 22 km/h (viento inicial) el foco mide 2,2 km; cada km/h añade 40 m.
function fireRadiusMeters(windSpeedKmh: number) {
  return 1320 + 40 * windSpeedKmh;
}

function isRoadBlocked(world: WorldState | undefined, road: string) {
  const wanted = road.toLowerCase();
  return (world?.blockedRoads ?? []).some((blocked) => blocked.trim().toLowerCase() === wanted);
}

const statusClasses: Record<ZoneStatus, { badge: string; border: string }> = {
  critical: { badge: "bg-danger", border: "border-danger" },
  active: { badge: "bg-fire", border: "border-fire" },
  watch: { badge: "bg-warn", border: "border-warn" },
  stable: { badge: "bg-ok", border: "border-ok" },
};

// El marcador se construye con nodos DOM y textContent: el nombre de la zona
// viene de la API y no debe interpretarse como HTML.
function createTacticalIcon(
  name: string,
  score: number,
  rank: number | undefined,
  status: ZoneStatus,
  selected: boolean,
) {
  const { badge, border } = statusClasses[status];
  const pill = document.createElement("div");
  pill.className = [
    "inline-flex items-center gap-1.5 rounded-full border-[1.5px] bg-ink px-2 py-0.5",
    "text-[11px] text-white whitespace-nowrap shadow-lg cursor-pointer",
    "-translate-x-1/2 -translate-y-1/2",
    selected ? "border-white" : border,
    status === "critical" || status === "active" ? "animate-pulse" : "",
  ].join(" ");

  if (rank) {
    const rankBadge = document.createElement("span");
    rankBadge.className = `${badge} inline-flex h-[15px] w-[15px] items-center justify-center rounded-full text-[10px] font-bold text-white`;
    rankBadge.textContent = String(rank);
    pill.appendChild(rankBadge);
  }
  const label = document.createElement("span");
  label.className = "font-semibold";
  label.textContent = name;
  const value = document.createElement("span");
  value.className = "text-[10px] opacity-80";
  value.textContent = String(score);
  pill.append(label, value);

  return L.divIcon({ html: pill, className: "", iconSize: [0, 0], iconAnchor: [0, 0] });
}

// Sólo se vuelve a centrar al elegir otra zona, no en cada sondeo del estado:
// si dependiera del objeto zona, el mapa saltaría mientras la persona lo mueve.
function FlyToSelected({ lat, lng }: { lat: number | undefined; lng: number | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}

interface ZoneMarkerProps {
  zone: CrisisZone;
  score: number;
  rank: number | undefined;
  selected: boolean;
  onSelect: (zoneId: string) => void;
}

function ZoneMarker({ zone, score, rank, selected, onSelect }: ZoneMarkerProps) {
  const icon = useMemo(
    () => createTacticalIcon(zone.name, score, rank, zone.status, selected),
    [zone.name, score, rank, zone.status, selected],
  );
  const title = `${zone.name}. Estado ${zoneStatusLabels[zone.status]}. Puntuación ${score}${
    rank ? `. Prioridad número ${rank}` : ""
  }`;

  return (
    <Marker
      position={[zone.coordinates.lat, zone.coordinates.lng]}
      icon={icon}
      title={title}
      eventHandlers={{ click: () => onSelect(zone.id) }}
    >
      <Popup>
        <div className="p-1 min-w-[170px] text-[12px] font-sans">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 pb-1 mb-1">
            <b className="text-ink text-[13px]">{zone.name}</b>
            <span className="text-[11px] font-semibold text-blueprint-mid">
              {zoneStatusLabels[zone.status]}
            </span>
          </div>
          <p className="text-neutral-600 mb-1">
            Población expuesta: <b>{zone.populationAtRisk.toLocaleString("es-ES")}</b>
          </p>
          <p className="text-neutral-600 mb-1">
            Puntuación de riesgo: <b>{score}</b>
            {rank ? ` (Prioridad #${rank})` : ""}
          </p>
          <button
            type="button"
            className="mt-2 w-full bg-blueprint-dark text-white py-1 rounded-[6px] text-[11px] font-semibold hover:bg-blueprint-dark/90 transition-colors"
            onClick={() => onSelect(zone.id)}
          >
            Ver detalle de la zona
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

export default function LeafletMap({
  zones,
  plan,
  world,
  selectedZoneId,
  onSelect,
  onTilesUnavailable,
}: Props) {
  const tiles = useRef({ loaded: 0, failed: 0, reported: false });
  const rankByZone = new Map(
    plan.priorities.map((priority, index) => [priority.zoneId, index + 1]),
  );
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  const a397Blocked = isRoadBlocked(world, "A-397");
  const ma8301Blocked = isRoadBlocked(world, "MA-8301");

  return (
    <div className="relative w-full h-[480px] rounded-[16px] overflow-hidden border border-line shadow-xs">
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-ink/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-neutral-700 text-white text-[12px] font-medium pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-danger animate-ping inline-block" />
        <span>Sierra Bermeja · mapa táctico</span>
      </div>
      <div className="absolute bottom-6 left-3 z-[1000] rounded-full bg-ink/80 px-2.5 py-1 text-[11px] text-neutral-200 pointer-events-none">
        {world ? `Viento ${world.windDirection} · ${world.windSpeedKmh} km/h · ` : ""}
        foco y trazados ilustrativos (demo)
      </div>

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

        {/* Foco del incendio: el radio crece con la velocidad del viento. */}
        <Circle
          center={fireOrigin}
          radius={fireRadiusMeters(world?.windSpeedKmh ?? 22)}
          pathOptions={{
            color: colors.danger,
            fillColor: colors.fire,
            fillOpacity: 0.22,
            weight: 1.5,
            dashArray: "4, 6",
          }}
        />

        <Polyline
          positions={a397Coordinates}
          pathOptions={
            a397Blocked
              ? { color: colors.danger, weight: 5, opacity: 0.95 }
              : { color: colors.warn, weight: 3, dashArray: "6, 8", opacity: 0.9 }
          }
        >
          <Popup>
            <div className="p-1 text-[12px] font-sans">
              <b className="text-danger">Carretera A-397 (Ronda - Costa)</b>
              <p className="text-neutral-700 mt-1">
                {a397Blocked
                  ? "CORTADA. El plan no puede apoyarse en esta vía."
                  : "Abierta. Eje de evacuación prioritario, vigilada por riesgo de humo."}
              </p>
              <p className="text-neutral-500 mt-1">Trazado aproximado.</p>
            </div>
          </Popup>
        </Polyline>

        <Polyline
          positions={ma8301Coordinates}
          pathOptions={
            ma8301Blocked
              ? { color: colors.danger, weight: 4, opacity: 0.9 }
              : { color: colors.info, weight: a397Blocked ? 4 : 2, opacity: a397Blocked ? 1 : 0.7 }
          }
        >
          <Popup>
            <div className="p-1 text-[12px] font-sans">
              <b className="text-info">Carretera MA-8301</b>
              <p className="text-neutral-700 mt-1">
                {ma8301Blocked
                  ? "CORTADA."
                  : a397Blocked
                    ? "Ruta alternativa activa por Jubrique y Peñas Blancas."
                    : "Ruta alternativa por Jubrique y Peñas Blancas."}
              </p>
              <p className="text-neutral-500 mt-1">Trazado ilustrativo.</p>
            </div>
          </Popup>
        </Polyline>

        {zones.map((zone) => {
          const priority = plan.priorities.find((candidate) => candidate.zoneId === zone.id);
          return (
            <ZoneMarker
              key={zone.id}
              zone={zone}
              score={priority?.score ?? zone.riskScore}
              rank={rankByZone.get(zone.id)}
              selected={selectedZoneId === zone.id}
              onSelect={onSelect}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
