"use client";

// Banda superior: lo que un jurado tiene que entender en dos segundos.
// Qué es lo más urgente, qué acaba de cambiar y con qué recursos contamos.

import { ArrowRight, Flame, History, Users } from "lucide-react";
import type { SituationState } from "@/lib/types";
import {
  agoLabel,
  clockLabel,
  isOpenAction,
  planChangeLabels,
  severityRank,
  troubledActionStatuses,
  zoneStatusLabels,
} from "./shared";

interface Props {
  situation: SituationState;
  nowMs: number;
  planIsFresh: boolean;
  onFocusZone: (zoneId: string) => void;
  onOpenAudit: () => void;
}

export default function HeroSummary({
  situation,
  nowMs,
  planIsFresh,
  onFocusZone,
  onOpenAudit,
}: Props) {
  const priority = situation.plan.priorities[0] ?? null;
  const topZone = situation.zones.find((zone) => zone.id === priority?.zoneId) ?? null;

  const openActions = situation.actions.filter(isOpenAction);
  const troubled = openActions.filter((action) => troubledActionStatuses.includes(action.status));
  const criticalSignals = situation.events.filter(
    (event) => event.confirmed !== false && severityRank[event.severity] >= severityRank.high,
  );
  const unverifiedSignals = situation.events.filter((event) => event.confirmed === null);
  const availableResources = situation.resources.filter(
    (resource) => resource.status === "available",
  );
  const downResources = situation.resources.filter((resource) => resource.status === "unavailable");
  const peopleAtRisk = situation.zones
    .filter((zone) => zone.status === "active" || zone.status === "critical")
    .reduce((total, zone) => total + zone.populationAtRisk, 0);

  const elapsedSeconds =
    situation.scenario.running && situation.scenario.startedAt
      ? (nowMs - new Date(situation.scenario.startedAt).getTime()) / 1000
      : situation.scenario.elapsedSeconds;

  const changes = situation.plan.changes ?? [];
  const lastAudit = situation.audit[0] ?? null;

  return (
    <section className="hero" aria-label="Resumen de la situación">
      <article className={`hero-card hero-priority ${topZone?.status ?? "stable"}`}>
        <header>
          <Flame size={16} aria-hidden="true" />
          <span>Prioridad ahora</span>
        </header>
        {topZone && priority ? (
          <>
            <h2>{topZone.name}</h2>
            <p className="hero-reason">{priority.reason}</p>
            <div className="hero-foot">
              <span className={`pill zone-${topZone.status}`}>
                {zoneStatusLabels[topZone.status]}
              </span>
              <span className="pill">Puntuación {priority.score}</span>
              <span className="pill">
                <Users size={13} aria-hidden="true" />{" "}
                {topZone.populationAtRisk.toLocaleString("es-ES")} personas
              </span>
              <button className="link-button" onClick={() => onFocusZone(topZone.id)}>
                Ver zona <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <h2>Sin zonas activas</h2>
        )}
      </article>

      <article
        className={`hero-card hero-change ${planIsFresh ? "just-changed" : ""}`}
        aria-live="polite"
      >
        <header>
          <History size={16} aria-hidden="true" />
          <span>Qué ha cambiado</span>
          {planIsFresh ? <em className="flash-tag">Ahora mismo</em> : null}
        </header>
        <h2>
          Plan v{situation.plan.version}
          {situation.plan.previousVersion ? (
            <small> · replanificado desde v{situation.plan.previousVersion}</small>
          ) : null}
        </h2>
        <p className="hero-reason">
          Motivo: {situation.plan.trigger || "sin motivo registrado"} ·{" "}
          {agoLabel(situation.plan.generatedAt, nowMs)}
        </p>
        {changes.length > 0 ? (
          <ul className="change-list compact">
            {changes.slice(0, 3).map((change, index) => (
              <li key={`${change.kind}-${index}`}>
                <span className={`change-kind ${change.kind}`}>
                  {planChangeLabels[change.kind]}
                </span>
                <span className="change-label">{change.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-note">Esta versión no registró diferencias respecto a la anterior.</p>
        )}
        {lastAudit ? (
          <button className="link-button" onClick={onOpenAudit}>
            Último registro: {lastAudit.summary} <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </article>

      <div className="kpi-grid" aria-live="polite">
        <article className={criticalSignals.length > 0 ? "kpi alarm" : "kpi"}>
          <span>Señales críticas</span>
          <strong>{criticalSignals.length}</strong>
          <small>{unverifiedSignals.length} sin verificar</small>
        </article>
        <article className={troubled.length > 0 ? "kpi alarm" : "kpi"}>
          <span>Acciones abiertas</span>
          <strong>{openActions.length}</strong>
          <small>{troubled.length} necesitan a alguien</small>
        </article>
        <article className={availableResources.length === 0 ? "kpi alarm" : "kpi"}>
          <span>Recursos libres</span>
          <strong>
            {availableResources.length}
            <em>/{situation.resources.length}</em>
          </strong>
          <small>{downResources.length} fuera de servicio</small>
        </article>
        <article className="kpi">
          <span>Personas en zonas activas</span>
          <strong>{peopleAtRisk.toLocaleString("es-ES")}</strong>
          <small>
            {situation.zones.filter((zone) => zone.status !== "stable").length} zonas no estables
          </small>
        </article>
        <article className="kpi">
          <span>Ejecución</span>
          <strong className={situation.integration.mode === "happyrobot" ? "live" : "mock"}>
            {situation.integration.mode === "happyrobot" ? "Real" : "Simulada"}
          </strong>
          <small>
            {situation.integration.liveActionsExecuted} reales ·{" "}
            {situation.integration.mockActionsExecuted} simuladas
          </small>
        </article>
        <article className={situation.scenario.running ? "kpi running" : "kpi"}>
          <span>Escenario</span>
          <strong>{situation.scenario.running ? "En marcha" : "Parado"}</strong>
          <small>
            {clockLabel(elapsedSeconds)} · {situation.scenario.firedBeatIds.length}/
            {situation.scenario.beats.length} hitos
          </small>
        </article>
      </div>
    </section>
  );
}
