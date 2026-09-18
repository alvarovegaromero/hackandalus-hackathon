"use client";

// Mapa operativo. Cada marcador es un botón real: abre el detalle de la zona.

import type { CrisisZone, Plan } from "@/lib/types";
import { zoneStatusLabels } from "./shared";

interface Props {
  zones: CrisisZone[];
  plan: Plan;
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
}

export default function OperationsMap({ zones, plan, selectedZoneId, onSelect }: Props) {
  const rankByZone = new Map(plan.priorities.map((priority, index) => [priority.zoneId, index + 1]));

  return (
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
        <path className="map-land border-context" d="M86 214 L126 226 L94 285 L121 335 L83 354 L55 296 Z" />
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
  );
}
