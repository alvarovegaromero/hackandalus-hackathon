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

/** Alert level in operations room. */
function alertLevel(situation: SituationState) {
  const criticalZones = situation.zones.filter((zone) => zone.status === "critical").length;
  const activeZones = situation.zones.filter((zone) => zone.status === "active").length;
  const criticalSignals = situation.events.filter(
    (event) => event.confirmed !== false && severityRank[event.severity] >= severityRank.high,
  ).length;

  if (criticalZones > 0) {
    return { level: 3, label: "Level 3 · Emergency", tone: "critical" as const };
  }
  if (activeZones > 0 || criticalSignals >= 2) {
    return { level: 2, label: "Level 2 · Operational situation", tone: "active" as const };
  }
  if (situation.zones.some((zone) => zone.status === "watch")) {
    return { level: 1, label: "Level 1 · Pre-emergency", tone: "watch" as const };
  }
  return { level: 0, label: "Level 0 · Watch", tone: "stable" as const };
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
    tag: entry.actor === "operator" ? "Operator" : entry.actor === "scenario" ? "Field" : "System",
    text: entry.summary,
    at: entry.at,
  }));
  const changes = [...fromPlan, ...fromAudit].slice(0, 3);

  return (
    <section
      className={`change-bar tone-${alert.tone}`}
      aria-label="What has changed"
      aria-live="polite"
    >
      <div className="alert-level">
        <span className="eyebrow">Alert level</span>
        <strong>{alert.label}</strong>
        <small>
          {situation.zones.filter((zone) => zone.status !== "stable").length} zones affected ·{" "}
          {situation.zones
            .filter((zone) => zone.status === "active" || zone.status === "critical")
            .reduce((total, zone) => total + zone.populationAtRisk, 0)
            .toLocaleString("en-US")}{" "}
          people at risk
        </small>
      </div>

      <div className="change-feed">
        <span className="eyebrow">
          <Clock3 size={13} aria-hidden="true" /> Last 5 minutes
        </span>
        {changes.length === 0 ? (
          <p className="muted-note">No updates in the last 5 minutes.</p>
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
            ? "An assumption failed: replan needed"
            : `Current · ${agoLabel(situation.plan.generatedAt, nowMs)}`}
        </small>
      </div>
    </section>
  );
}
