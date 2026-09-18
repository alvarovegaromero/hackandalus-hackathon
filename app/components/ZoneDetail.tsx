"use client";

// Detalle de una zona: por qué puntúa lo que puntúa y qué hay abierto en ella.

import { ArrowLeft, Plus } from "lucide-react";
import type { CrisisZone, SituationState } from "@/lib/types";
import {
  actionStatusLabels,
  agoLabel,
  chainStatusLabels,
  confidenceLabels,
  executionLabel,
  isOpenAction,
  resourceStatusLabels,
  severityLabels,
  zoneStatusLabels
} from "./shared";

interface Props {
  zone: CrisisZone;
  situation: SituationState;
  nowMs: number;
  onClose: () => void;
  onCreateAction: (zoneId: string) => void;
}

export default function ZoneDetail({ zone, situation, nowMs, onClose, onCreateAction }: Props) {
  const priority = situation.plan.priorities.find((candidate) => candidate.zoneId === zone.id) ?? null;
  const rank = situation.plan.priorities.findIndex((candidate) => candidate.zoneId === zone.id) + 1;
  const events = situation.events.filter((event) => event.zoneId === zone.id).slice(0, 6);
  const resources = situation.resources.filter(
    (resource) => resource.zoneId === zone.id || resource.homeZoneId === zone.id
  );
  const actions = situation.actions.filter((action) => action.zoneId === zone.id && isOpenAction(action));
  const chains = situation.chains.filter((chain) => chain.zoneId === zone.id);

  const factors = priority?.factors ?? [];
  const declared = factors.reduce((total, factor) => total + factor.value, 0);
  const rest = (priority?.score ?? 0) - declared;
  const rows = [...factors, ...(rest !== 0 ? [{ label: "Ajuste no desglosado", value: rest }] : [])];
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  return (
    <section className="panel zone-detail" aria-label={`Detalle de ${zone.name}`}>
      <div className="panel-title">
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Cerrar el detalle y volver a las prioridades"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2>{zone.name}</h2>
        <span className={`pill zone-${zone.status}`}>{zoneStatusLabels[zone.status]}</span>
      </div>

      <div className="zone-stats">
        <div>
          <span>Prioridad</span>
          <strong>{rank > 0 ? `#${rank}` : "—"}</strong>
        </div>
        <div>
          <span>Puntuación</span>
          <strong>{priority?.score ?? zone.riskScore}</strong>
        </div>
        <div>
          <span>Personas en riesgo</span>
          <strong>{zone.populationAtRisk.toLocaleString("es-ES")}</strong>
        </div>
        <div>
          <span>{typeof zone.minutesToImpact === "number" ? "Impacto en" : "Actualizada"}</span>
          <strong>
            {typeof zone.minutesToImpact === "number"
              ? `${zone.minutesToImpact} min`
              : agoLabel(zone.lastUpdatedAt, nowMs)}
          </strong>
        </div>
      </div>

      {zone.vulnerableSites && zone.vulnerableSites.length > 0 ? (
        <>
          <h3 className="section-head">Puntos vulnerables ({zone.vulnerableSites.length})</h3>
          <ul className="mini-list">
            {zone.vulnerableSites.map((site) => (
              <li key={site.id} className={`mini-row ${site.evacuated ? "" : "sev-high"}`}>
                <div>
                  <strong>{site.name}</strong>
                  <small>
                    {site.kind} · {site.people} personas · peso ×{site.multiplier}
                  </small>
                </div>
                <span className={site.evacuated ? "pill zone-stable" : "pill zone-critical"}>
                  {site.evacuated ? "Evacuado" : "Sin evacuar"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="section-head">Por qué puntúa así</h3>
      <p className="muted-note">{priority?.reason ?? "Sin motivo registrado para esta zona."}</p>
      <ul className="factor-list">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="factor-label">{row.label}</span>
            <span className="factor-bar" aria-hidden="true">
              <i
                className={row.value < 0 ? "negative" : ""}
                style={{ width: `${(Math.abs(row.value) / maxValue) * 100}%` }}
              />
            </span>
            <b>{row.value > 0 ? `+${row.value}` : row.value}</b>
          </li>
        ))}
        <li className="factor-total">
          <span className="factor-label">Puntuación total</span>
          <span />
          <b>{priority?.score ?? zone.riskScore}</b>
        </li>
      </ul>

      {zone.needs.length > 0 ? (
        <>
          <h3 className="section-head">Necesidades abiertas</h3>
          <div className="chip-row">
            {zone.needs.map((need) => (
              <span key={need} className="pill need">
                {need}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <h3 className="section-head">Señales de la zona ({events.length})</h3>
      {events.length === 0 ? (
        <p className="muted-note">Todavía no ha entrado ninguna señal de esta zona.</p>
      ) : (
        <ul className="mini-list">
          {events.map((event) => (
            <li key={event.id} className={`mini-row sev-${event.severity}`}>
              <div>
                <strong>{event.title}</strong>
                <small>
                  {severityLabels[event.severity]} · {confidenceLabels[event.confidence]} ·{" "}
                  {event.confirmed === true
                    ? "confirmada"
                    : event.confirmed === false
                      ? "descartada"
                      : "sin verificar"}
                  {event.occurrences > 1 ? ` · ${event.occurrences} avisos` : ""}
                </small>
              </div>
              <span className="pill">{agoLabel(event.createdAt, nowMs)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-head">Recursos ligados ({resources.length})</h3>
      {resources.length === 0 ? (
        <p className="muted-note">Ningún recurso tiene base ni despliegue en esta zona.</p>
      ) : (
        <ul className="mini-list">
          {resources.map((resource) => (
            <li key={resource.id} className={`mini-row res-${resource.status}`}>
              <div>
                <strong>{resource.name}</strong>
                <small>
                  {resource.type} · capacidad {resource.capacity} · {resource.capabilities.join(", ")}
                </small>
              </div>
              <span className={`pill res-${resource.status}`}>{resourceStatusLabels[resource.status]}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-head">Acciones abiertas ({actions.length})</h3>
      {actions.length === 0 ? (
        <p className="muted-note">No hay acciones vivas en esta zona.</p>
      ) : (
        <ul className="mini-list">
          {actions.map((action) => (
            <li key={action.id} className="mini-row">
              <div>
                <strong>{action.objective}</strong>
                <small>
                  {actionStatusLabels[action.status]} · {action.target} · intento {action.attempt}
                </small>
              </div>
              <span className={action.executionMode === "happyrobot" ? "pill live" : "pill mock"}>
                {executionLabel(action.executionMode)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {chains.length > 0 ? (
        <>
          <h3 className="section-head">Cadenas de escalado ({chains.length})</h3>
          <ul className="mini-list">
            {chains.map((chain) => (
              <li key={chain.id} className="mini-row">
                <div>
                  <strong>{chain.objective}</strong>
                  <small>
                    Escalón {Math.min(chain.currentStep + 1, chain.steps.length)} de {chain.steps.length}
                  </small>
                </div>
                <span className="pill">{chainStatusLabels[chain.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <button className="wide-button" onClick={() => onCreateAction(zone.id)}>
        <Plus size={15} aria-hidden="true" /> Crear una acción en esta zona
      </button>
    </section>
  );
}
