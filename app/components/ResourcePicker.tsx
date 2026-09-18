"use client";

// Reasignación manual de recurso. Antes de corregir al sistema, el operador ve
// el mismo ranking que usó el motor: puntuación, distancia, qué cubre cada
// candidato y por qué se descartó a los demás.

import { Check } from "lucide-react";
import type { Action, CrisisZone, Resource } from "@/lib/types";
import { explainUnassignable, rankResourcesForAction } from "@/lib/resources";
import { resourceStatusLabels } from "./shared";

interface Props {
  action: Action;
  resources: Resource[];
  zones: CrisisZone[];
  busy: boolean;
  onAssign: (resourceId: string) => void;
}

export default function ResourcePicker({ action, resources, zones, busy, onAssign }: Props) {
  const candidates = rankResourcesForAction(
    { zoneId: action.zoneId, objective: action.objective, channel: action.channel },
    resources,
    zones
  );
  const usable = candidates.filter(
    (candidate) => candidate.compatible && candidate.resource.status !== "unavailable"
  );
  const discarded = candidates.filter((candidate) => candidate.rejection !== null);

  return (
    <div className="resource-picker">
      <h4>Recursos candidatos para esta acción</h4>
      {usable.length === 0 ? (
        <p className="muted-note warn">
          {explainUnassignable(
            { zoneId: action.zoneId, objective: action.objective, channel: action.channel },
            resources,
            zones
          )}
        </p>
      ) : null}

      <ul className="candidate-list">
        {usable.map((candidate) => {
          const current = candidate.resource.id === action.resourceId;
          return (
            <li key={candidate.resource.id} className={current ? "current" : ""}>
              <div className="candidate-score" aria-hidden="true">
                <b>{Math.round(candidate.score)}</b>
                <span>/100</span>
              </div>
              <div>
                <strong>
                  {candidate.resource.name}
                  {current ? <em className="count-tag">asignado ahora</em> : null}
                </strong>
                <small>
                  Cubre {candidate.matched.join(", ") || "nada específico"} ·{" "}
                  {candidate.distance === null
                    ? "recurso regional sin base fija"
                    : `distancia ${Math.round(candidate.distance)}`}{" "}
                  · capacidad {candidate.resource.capacity} ·{" "}
                  {resourceStatusLabels[candidate.resource.status]}
                </small>
              </div>
              <button
                onClick={() => onAssign(candidate.resource.id)}
                disabled={busy || current}
                aria-label={`Asignar ${candidate.resource.name} a la acción ${action.objective}`}
              >
                <Check size={14} aria-hidden="true" /> Asignar
              </button>
            </li>
          );
        })}
      </ul>

      {discarded.length > 0 ? (
        <details>
          <summary>Por qué se descartaron los otros {discarded.length}</summary>
          <ul className="mini-list">
            {discarded.map((candidate) => (
              <li key={candidate.resource.id} className="mini-row">
                <div>
                  <strong>{candidate.resource.name}</strong>
                  <small>{candidate.rejection}</small>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
