"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { CrisisZone, Plan } from "@/lib/types";
import { zoneStatusLabels } from "./shared";
import { Button } from "./ui/button";
import { Layers, MapPin } from "lucide-react";

interface Props {
  zones: CrisisZone[];
  plan: Plan;
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
}

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[480px] rounded-[16px] border border-[#d8d4c9] bg-[#111317] flex flex-col items-center justify-center text-white tracking-[-0.15px] gap-2">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-white animate-spin" />
      <span className="text-[13px] font-medium text-neutral-300">
        Iniciando radar cartográfico Leaflet (Sierra Bermeja)...
      </span>
    </div>
  ),
});

export default function OperationsMap({ zones, plan, selectedZoneId, onSelect }: Props) {
  const [viewMode, setViewMode] = useState<"tactical" | "regional">("tactical");

  const rankByZone = new Map(
    plan.priorities.map((priority, index) => [priority.zoneId, index + 1]),
  );

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#5d5d5d]">
            Mapa Operativo
          </span>
          <span className="text-[12px] text-[#9e9e9e]">· 112 Andalucía</span>
        </div>
        <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-full border border-neutral-200">
          <Button
            size="sm"
            variant={viewMode === "tactical" ? "pill" : "ghost"}
            className="h-6 text-[11px] px-2.5"
            onClick={() => setViewMode("tactical")}
          >
            <MapPin size={12} aria-hidden="true" />
            Táctico Bermeja (Leaflet)
          </Button>
          <Button
            size="sm"
            variant={viewMode === "regional" ? "pill" : "ghost"}
            className="h-6 text-[11px] px-2.5"
            onClick={() => setViewMode("regional")}
          >
            <Layers size={12} aria-hidden="true" />
            Esquema Regional
          </Button>
        </div>
      </div>

      {viewMode === "tactical" ? (
        <LeafletMap zones={zones} plan={plan} selectedZoneId={selectedZoneId} onSelect={onSelect} />
      ) : (
        <div className="map">
          <div className="map-label">Andalucía · cobertura de la demo regional</div>
          <svg
            className="region-shape"
            viewBox="0 0 760 520"
            role="img"
            aria-label="Mapa esquemático de Andalucía"
          >
            <path
              className="map-land andalucia"
              d="M94 285 L126 226 L185 206 L238 165 L314 152 L371 178 L431 143 L510 157 L574 188 L647 197 L694 235 L676 291 L628 328 L590 383 L506 389 L437 365 L374 386 L301 369 L248 397 L174 374 L121 335 Z"
            />
            <path
              className="map-land border-context"
              d="M86 214 L126 226 L94 285 L121 335 L83 354 L55 296 Z"
            />
            <path
              className="map-land sea-context"
              d="M148 408 L249 421 L354 406 L451 421 L571 411 L650 374 L691 395 L632 461 L423 479 L238 459 Z"
            />
            <path
              className="map-line"
              d="M185 206 L174 374 M314 152 L301 369 M431 143 L437 365 M574 188 L590 383 M121 335 L676 291 M126 226 L628 328"
            />
          </svg>
          {zones.map((zone) => {
            const priority = plan.priorities.find((candidate) => candidate.zoneId === zone.id);
            const score = priority?.score ?? zone.riskScore;
            const rank = rankByZone.get(zone.id);
            const selected = selectedZoneId === zone.id;
            return (
              <button
                key={zone.id}
                type="button"
                className={`zone-marker ${zone.status} ${selected ? "selected" : ""}`}
                style={{ left: `${zone.coordinates.x}%`, top: `${zone.coordinates.y}%` }}
                aria-pressed={selected}
                aria-label={`${zone.name}. Estado ${zoneStatusLabels[zone.status]}. Puntuación ${score}${
                  rank ? `. Prioridad número ${rank}` : ""
                }. Abrir el detalle de la zona.`}
                onClick={() => onSelect(zone.id)}
              >
                {rank ? <em className="marker-rank">{rank}</em> : null}
                <span>{zone.name}</span>
                <b>{score}</b>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
