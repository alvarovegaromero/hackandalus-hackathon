"use client";

import { useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import type { CrisisZone, Plan } from "@/lib/types";
import { zoneStatusLabels } from "./shared";

interface Props {
  zones: CrisisZone[];
  plan: Plan;
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
}

// Carretera A-397 (Ronda - San Pedro / Costa del Sol)
const a397Coordinates: [number, number][] = [
  [36.742, -5.165],
  [36.671, -5.112],
  [36.601, -5.087],
  [36.535, -5.032],
  [36.488, -4.985],
];

// Carretera alternativa MA-8301 (Jubrique - Peñas Blancas - Estepona)
const ma8301Coordinates: [number, number][] = [
  [36.565, -5.215],
  [36.544, -5.234],
  [36.512, -5.187],
  [36.427, -5.145],
];

function createTacticalIcon(
  name: string,
  score: number,
  rank: number | undefined,
  status: string,
  selected: boolean,
) {
  const statusColor =
    status === "critical"
      ? "#a11b12"
      : status === "active"
        ? "#e05638"
        : status === "watch"
          ? "#96490f"
          : "#14663f";

  const borderColor = selected ? "#ffffff" : statusColor;
  const pulseClass = status === "critical" || status === "active" ? "animate-pulse" : "";

  const html = `
    <div style="
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      background: #191c24;
      border: 1.5px solid ${borderColor};
      border-radius: 9999px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      font-size: 11px;
      letter-spacing: -0.15px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5), 0 0 10px ${statusColor}44;
      white-space: nowrap;
      cursor: pointer;
      transform: translate(-50%, -50%);
    " class="${pulseClass}">
      ${
        rank
          ? `<span style="background:${statusColor}; color:white; border-radius:9999px; width:15px; height:15px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">${rank}</span>`
          : ""
      }
      <span style="font-weight:600;">${name}</span>
      <span style="color:#d8d4c9; font-size:10px; opacity:0.85;">${score}</span>
    </div>
  `;

  return L.divIcon({
    html,
    className: "tactical-zone-divicon",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

export default function LeafletMap({ zones, plan, selectedZoneId, onSelect }: Props) {
  const rankByZone = new Map(
    plan.priorities.map((priority, index) => [priority.zoneId, index + 1]),
  );

  // Centro por defecto: Sierra Bermeja
  const defaultCenter: [number, number] = [36.525, -5.185];

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const activeCenter: [number, number] =
    selectedZone?.coordinates.lat && selectedZone?.coordinates.lng
      ? [selectedZone.coordinates.lat, selectedZone.coordinates.lng]
      : defaultCenter;

  return (
    <div className="relative w-full h-[480px] rounded-[16px] overflow-hidden border border-[#d8d4c9] shadow-xs">
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-[#131720]/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-neutral-700 text-white text-[12px] font-medium tracking-[-0.15px] pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-[#a11b12] animate-ping inline-block" />
        <span>Sierra Bermeja · Radar Cartográfico 112</span>
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", background: "#111317" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        <RecenterMap center={activeCenter} />

        {/* Foco térmico principal del incendio en Sierra Bermeja */}
        <Circle
          center={[36.52, -5.14]}
          radius={2200}
          pathOptions={{
            color: "#a11b12",
            fillColor: "#e05638",
            fillOpacity: 0.22,
            weight: 1.5,
            dashArray: "4, 6",
          }}
        />

        {/* Trazado de la carretera A-397 (Crítica / Corte) */}
        <Polyline
          positions={a397Coordinates}
          pathOptions={{
            color: "#96490f",
            weight: 3,
            dashArray: "6, 8",
            opacity: 0.9,
          }}
        >
          <Popup>
            <div className="p-1 text-[12px] font-sans">
              <b className="text-[#a11b12]">Carretera A-397 (Ronda - Costa)</b>
              <p className="text-neutral-700 mt-1">
                Eje de evacuación prioritario. Sujeto a corte por humo denso.
              </p>
            </div>
          </Popup>
        </Polyline>

        {/* Trazado de ruta secundaria MA-8301 */}
        <Polyline
          positions={ma8301Coordinates}
          pathOptions={{
            color: "#17527f",
            weight: 2,
            opacity: 0.7,
          }}
        >
          <Popup>
            <div className="p-1 text-[12px] font-sans">
              <b className="text-[#17527f]">Carretera MA-8301</b>
              <p className="text-neutral-700 mt-1">
                Ruta alternativa por Jubrique y Peñas Blancas.
              </p>
            </div>
          </Popup>
        </Polyline>

        {/* Marcadores de Zonas */}
        {zones.map((zone) => {
          const lat = zone.coordinates.lat ?? 36.5 + (zone.coordinates.y - 50) * 0.005;
          const lng = zone.coordinates.lng ?? -5.15 + (zone.coordinates.x - 50) * 0.005;
          const priority = plan.priorities.find((c) => c.zoneId === zone.id);
          const score = priority?.score ?? zone.riskScore;
          const rank = rankByZone.get(zone.id);
          const selected = selectedZoneId === zone.id;

          const customIcon = createTacticalIcon(zone.name, score, rank, zone.status, selected);

          return (
            <Marker
              key={zone.id}
              position={[lat, lng]}
              icon={customIcon}
              eventHandlers={{
                click: () => onSelect(zone.id),
              }}
            >
              <Popup>
                <div className="p-1 min-w-[170px] text-[12px] font-sans">
                  <div className="flex items-center justify-between gap-2 border-b border-neutral-200 pb-1 mb-1">
                    <b className="text-[#131720] text-[13px]">{zone.name}</b>
                    <span className="text-[11px] font-semibold text-[#5d5d5d]">
                      {zoneStatusLabels[zone.status]}
                    </span>
                  </div>
                  <p className="text-neutral-600 mb-1">
                    Población expuesta: <b>{zone.populationAtRisk.toLocaleString()}</b>
                  </p>
                  <p className="text-neutral-600 mb-1">
                    Puntuación de riesgo: <b>{score}</b>
                    {rank ? ` (Prioridad #${rank})` : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-2 w-full bg-[#292929] text-white py-1 rounded-[6px] text-[11px] font-semibold hover:bg-black transition-colors"
                    onClick={() => onSelect(zone.id)}
                  >
                    Ver detalle de la zona
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
