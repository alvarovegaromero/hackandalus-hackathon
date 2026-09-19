"use client";

// Zona 1 de FARO: lo primero que se lee. Nivel de alerta, lo que ha cambiado en
// los últimos cinco minutos y si el plan vigente sigue en pie.

import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { SituationState } from "@/lib/types";
import { agoLabel, planChangeLabels, severityRank } from "./shared";

interface Props {
  situation: SituationState;
  nowMs: number;
  planIsFresh: boolean;
}

const WINDOW_MS = 5 * 60 * 1000;

/** Nivel de alerta de sala, con el vocabulario del 112. */
function alertLevel(situation: SituationState) {
  const criticalZones = situation.zones.filter((zone) => zone.status === "critical").length;
  const activeZones = situation.zones.filter((zone) => zone.status === "active").length;
  const criticalSignals = situation.events.filter(
    (event) => event.confirmed !== false && severityRank[event.severity] >= severityRank.high,
  ).length;

  if (criticalZones > 0) {
    return { level: 3, label: "Nivel 3 · Emergencia", tone: "critical" as const };
  }
  if (activeZones > 0 || criticalSignals >= 2) {
    return { level: 2, label: "Nivel 2 · Situación operativa", tone: "active" as const };
  }
  if (situation.zones.some((zone) => zone.status === "watch")) {
    return { level: 1, label: "Nivel 1 · Preemergencia", tone: "watch" as const };
  }
  return { level: 0, label: "Nivel 0 · Vigilancia", tone: "stable" as const };
}

export default function ChangeBar({ situation, nowMs, planIsFresh }: Props) {
  const alert = alertLevel(situation);
  const planInvalid = situation.plan.valid === false;

  // Lo que ha cambiado: primero los cambios que declaró el plan, y si no llega a
  // tres, se completa con el registro de los últimos cinco minutos.
  const recentAudit = situation.audit.filter(
    (entry) => nowMs - new Date(entry.at).getTime() < WINDOW_MS,
  );
  const fromPlan = (situation.plan.changes ?? []).map((change, index) => ({
    id: `plan-${situation.plan.version}-${index}`,
    tag: planChangeLabels[change.kind],
    text: change.label,
    at: situation.plan.generatedAt,
  }));
  const fromAudit = recentAudit.map((entry) => ({
    id: entry.id,
    tag:
      entry.actor === "operator" ? "Operador" : entry.actor === "scenario" ? "Terreno" : "Sistema",
    text: entry.summary,
    at: entry.at,
  }));
  const changes = [...fromPlan, ...fromAudit].slice(0, 3);

  return (
    <section
      className={`change-bar tone-${alert.tone}`}
      aria-label="Qué ha cambiado"
      aria-live="polite"
    >
      <div className="alert-level">
        <span className="eyebrow">Nivel de alerta</span>
        <strong>{alert.label}</strong>
        <small>
          {situation.zones.filter((zone) => zone.status !== "stable").length} comarcas afectadas ·{" "}
          {situation.zones
            .filter((zone) => zone.status === "active" || zone.status === "critical")
            .reduce((total, zone) => total + zone.populationAtRisk, 0)
            .toLocaleString("es-ES")}{" "}
          personas en riesgo
        </small>
      </div>

      <div className="change-feed">
        <span className="eyebrow">
          <Clock3 size={13} aria-hidden="true" /> Últimos 5 minutos
        </span>
        {changes.length === 0 ? (
          <p className="muted-note">Sin novedades en los últimos cinco minutos.</p>
        ) : (
          <ul>
            {changes.map((change) => (
              <li key={change.id}>
                <span className="pill">{change.tag}</span>
                <span>{change.text}</span>
                <small>{agoLabel(change.at, nowMs)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={`plan-state ${planInvalid ? "invalid" : ""} ${planIsFresh ? "just-changed" : ""}`}
      >
        <span className="eyebrow">Plan</span>
        <strong>
          v{situation.plan.version}{" "}
          {planInvalid ? (
            <AlertTriangle size={18} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={18} aria-hidden="true" />
          )}
        </strong>
        <small>
          {planInvalid
            ? "Un supuesto se ha roto: hay que rehacerlo"
            : `Vigente · ${agoLabel(situation.plan.generatedAt, nowMs)}`}
        </small>
      </div>
    </section>
  );
}
