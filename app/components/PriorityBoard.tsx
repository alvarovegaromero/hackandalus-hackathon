"use client";

// Zona 2 de FARO: el ranking en vivo. Quién va primero, si sube o baja respecto
// a la versión anterior del plan, y el motivo en una sola línea.

import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import type { Plan, CrisisZone } from "@/lib/types";
import { zoneStatusLabels } from "./shared";

interface Props {
  plan: Plan;
  planHistory: Plan[];
  zones: CrisisZone[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
}

/** El motivo, recortado a una frase para que quepa en una línea. */
function oneLine(reason: string) {
  const firstSentence = reason.split(". ")[0] ?? reason;
  return firstSentence.endsWith(".") ? firstSentence.slice(0, -1) : firstSentence;
}

export default function PriorityBoard({
  plan,
  planHistory,
  zones,
  selectedZoneId,
  onSelect,
}: Props) {
  const previous = planHistory[0] ?? null;
  const previousRank = new Map(
    (previous?.priorities ?? []).map((priority, index) => [priority.zoneId, index]),
  );

  return (
    <section className="panel priority-panel" aria-label="Prioridades">
      <div className="panel-title">
        <h2>Qué va primero</h2>
        <span className="hint">Ranking en vivo</span>
      </div>
      <ol className="priority-board">
        {plan.priorities.map((priority, index) => {
          const zone = zones.find((candidate) => candidate.id === priority.zoneId);
          if (!zone) return null;
          const before = previousRank.get(priority.zoneId);
          const movement =
            before === undefined ? "new" : before > index ? "up" : before < index ? "down" : "same";
          return (
            <li key={priority.zoneId}>
              <button
                className={`priority-row ${index === 0 ? "top" : ""} ${
                  selectedZoneId === priority.zoneId ? "selected" : ""
                }`}
                onClick={() => onSelect(priority.zoneId)}
                aria-label={`${zone.name}, puesto ${index + 1}, puntuación ${priority.score}. Abrir el detalle.`}
              >
                <strong>{index + 1}</strong>
                <div>
                  <h3>
                    {zone.name}
                    <span className={`move ${movement}`} aria-hidden="true">
                      {movement === "up" ? (
                        <ArrowUp size={14} />
                      ) : movement === "down" ? (
                        <ArrowDown size={14} />
                      ) : movement === "new" ? (
                        <ArrowRight size={14} />
                      ) : (
                        <Minus size={14} />
                      )}
                    </span>
                    <span className={`pill zone-${zone.status}`}>
                      {zoneStatusLabels[zone.status]}
                    </span>
                  </h3>
                  <p className="one-line" title={priority.reason}>
                    {oneLine(priority.reason)}
                  </p>
                </div>
                <span className="score">{priority.score}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
