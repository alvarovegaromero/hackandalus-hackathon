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
  zoneStatusLabels,
} from "./shared";

interface Props {
  zone: CrisisZone;
  situation: SituationState;
  nowMs: number;
  onClose: () => void;
  onCreateAction: (zoneId: string) => void;
}

export default function ZoneDetail({ zone, situation, nowMs, onClose, onCreateAction }: Props) {
  const priority =
    situation.plan.priorities.find((candidate) => candidate.zoneId === zone.id) ?? null;
  const rank = situation.plan.priorities.findIndex((candidate) => candidate.zoneId === zone.id) + 1;
  const events = situation.events.filter((event) => event.zoneId === zone.id).slice(0, 6);
  const resources = situation.resources.filter(
    (resource) => resource.zoneId === zone.id || resource.homeZoneId === zone.id,
  );
  const actions = situation.actions.filter(
    (action) => action.zoneId === zone.id && isOpenAction(action),
  );
  const chains = situation.chains.filter((chain) => chain.zoneId === zone.id);

  const factors = priority?.factors ?? [];
  const declared = factors.reduce((total, factor) => total + factor.value, 0);
  const rest = (priority?.score ?? 0) - declared;
  const rows = [
    ...factors,
    ...(rest !== 0 ? [{ label: "Unitemized adjustment", value: rest }] : []),
  ];
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  return (
    <section className="panel zone-detail" aria-label={`Details for ${zone.name}`}>
      <div className="panel-title">
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close details and return to priorities"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2>{zone.name}</h2>
        <span className={`pill zone-${zone.status}`}>{zoneStatusLabels[zone.status]}</span>
      </div>

      <div className="zone-stats">
        <div>
          <span>Priority</span>
          <strong>{rank > 0 ? `#${rank}` : "—"}</strong>
        </div>
        <div>
          <span>Score</span>
          <strong>{priority?.score ?? zone.riskScore}</strong>
        </div>
        <div>
          <span>People at risk</span>
          <strong>{zone.populationAtRisk.toLocaleString("en-US")}</strong>
        </div>
        <div>
          <span>{typeof zone.minutesToImpact === "number" ? "Impact in" : "Updated"}</span>
          <strong>
            {typeof zone.minutesToImpact === "number"
              ? `${zone.minutesToImpact} min`
              : agoLabel(zone.lastUpdatedAt, nowMs)}
          </strong>
        </div>
      </div>

      {zone.vulnerableSites && zone.vulnerableSites.length > 0 ? (
        <>
          <h3 className="section-head">Vulnerable sites ({zone.vulnerableSites.length})</h3>
          <ul className="mini-list">
            {zone.vulnerableSites.map((site) => (
              <li key={site.id} className={`mini-row ${site.evacuated ? "" : "sev-high"}`}>
                <div>
                  <strong>{site.name}</strong>
                  <small>
                    {site.kind} · {site.people} people · weight ×{site.multiplier}
                  </small>
                </div>
                <span className={site.evacuated ? "pill zone-stable" : "pill zone-critical"}>
                  {site.evacuated ? "Evacuated" : "Unevacuated"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="section-head">Score rationale</h3>
      <p className="muted-note">{priority?.reason ?? "No rationale recorded for this zone."}</p>
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
          <span className="factor-label">Total score</span>
          <span />
          <b>{priority?.score ?? zone.riskScore}</b>
        </li>
      </ul>

      {zone.needs.length > 0 ? (
        <>
          <h3 className="section-head">Open needs</h3>
          <div className="chip-row">
            {zone.needs.map((need) => (
              <span key={need} className="pill need">
                {need}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <h3 className="section-head">Zone signals ({events.length})</h3>
      {events.length === 0 ? (
        <p className="muted-note">No signals received from this zone yet.</p>
      ) : (
        <ul className="mini-list">
          {events.map((event) => (
            <li key={event.id} className={`mini-row sev-${event.severity}`}>
              <div>
                <strong>{event.title}</strong>
                <small>
                  {severityLabels[event.severity]} · {confidenceLabels[event.confidence]} ·{" "}
                  {event.confirmed === true
                    ? "confirmed"
                    : event.confirmed === false
                      ? "discarded"
                      : "unverified"}
                  {event.occurrences > 1 ? ` · ${event.occurrences} reports` : ""}
                </small>
              </div>
              <span className="pill">{agoLabel(event.createdAt, nowMs)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-head">Linked resources ({resources.length})</h3>
      {resources.length === 0 ? (
        <p className="muted-note">No resources based or deployed in this zone.</p>
      ) : (
        <ul className="mini-list">
          {resources.map((resource) => (
            <li key={resource.id} className={`mini-row res-${resource.status}`}>
              <div>
                <strong>{resource.name}</strong>
                <small>
                  {resource.type} · capacity {resource.capacity} ·{" "}
                  {resource.capabilities.join(", ")}
                </small>
              </div>
              <span className={`pill res-${resource.status}`}>
                {resourceStatusLabels[resource.status]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-head">Open actions ({actions.length})</h3>
      {actions.length === 0 ? (
        <p className="muted-note">No active actions in this zone.</p>
      ) : (
        <ul className="mini-list">
          {actions.map((action) => (
            <li key={action.id} className="mini-row">
              <div>
                <strong>{action.objective}</strong>
                <small>
                  {actionStatusLabels[action.status]} · {action.target} · attempt {action.attempt}
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
          <h3 className="section-head">Escalation chains ({chains.length})</h3>
          <ul className="mini-list">
            {chains.map((chain) => (
              <li key={chain.id} className="mini-row">
                <div>
                  <strong>{chain.objective}</strong>
                  <small>
                    Step {Math.min(chain.currentStep + 1, chain.steps.length)} of{" "}
                    {chain.steps.length}
                  </small>
                </div>
                <span className="pill">{chainStatusLabels[chain.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <button className="wide-button" onClick={() => onCreateAction(zone.id)}>
        <Plus size={15} aria-hidden="true" /> Create an action in this zone
      </button>
    </section>
  );
}
