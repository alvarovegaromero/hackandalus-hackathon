"use client";

// Banda superior: lo que un jurado tiene que entender en dos segundos.
// Qué es lo más urgente, qué acaba de cambiar y con qué recursos contamos.

import { ArrowRight, Flame, History, Users } from "lucide-react";
import type { SituationState } from "@/lib/types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
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
    <section className="hero" aria-label="Situation summary">
      <article className={`hero-card hero-priority ${topZone?.status ?? "stable"}`}>
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-blueprint-mid">
            <Flame size={14} className="text-danger" aria-hidden="true" />
            <span>Current priority</span>
          </div>
          {topZone ? (
            <Badge
              variant={
                topZone.status === "critical"
                  ? "critical"
                  : topZone.status === "active"
                    ? "warning"
                    : "outline"
              }
            >
              {zoneStatusLabels[topZone.status]}
            </Badge>
          ) : null}
        </header>
        {topZone && priority ? (
          <>
            <h2 className="text-[18px] font-bold text-blueprint-dark tracking-[-0.15px] mt-1">
              {topZone.name}
            </h2>
            <p className="hero-reason text-[13px] text-blueprint-mid tracking-[-0.15px]">
              {priority.reason}
            </p>
            <div className="hero-foot flex flex-wrap items-center gap-2 mt-3">
              <Badge variant="outline">Score {priority.score}</Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                <Users size={12} aria-hidden="true" />{" "}
                {topZone.populationAtRisk.toLocaleString("en-US")} people
              </Badge>
              <Button
                variant="pill"
                size="sm"
                className="h-7 text-[12px]"
                onClick={() => onFocusZone(topZone.id)}
              >
                View zone <ArrowRight size={12} aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : (
          <h2 className="text-[16px] font-bold text-blueprint-dark">No active zones</h2>
        )}
      </article>

      <article
        className={`hero-card hero-change ${planIsFresh ? "just-changed" : ""}`}
        aria-live="polite"
      >
        <header>
          <History size={16} aria-hidden="true" />
          <span>What has changed</span>
          {planIsFresh ? <em className="flash-tag">Just now</em> : null}
        </header>
        <h2>
          Plan v{situation.plan.version}
          {situation.plan.previousVersion ? (
            <small> · replanned from v{situation.plan.previousVersion}</small>
          ) : null}
        </h2>
        <p className="hero-reason">
          Trigger: {situation.plan.trigger || "no trigger recorded"} ·{" "}
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
          <p className="muted-note">This version recorded no differences from the previous one.</p>
        )}
        {lastAudit ? (
          <button className="link-button" onClick={onOpenAudit}>
            Latest entry: {lastAudit.summary} <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </article>

      <div className="kpi-grid" aria-live="polite">
        <article className={criticalSignals.length > 0 ? "kpi alarm" : "kpi"}>
          <span>Critical signals</span>
          <strong>{criticalSignals.length}</strong>
          <small>{unverifiedSignals.length} unverified</small>
        </article>
        <article className={troubled.length > 0 ? "kpi alarm" : "kpi"}>
          <span>Open actions</span>
          <strong>{openActions.length}</strong>
          <small>{troubled.length} need attention</small>
        </article>
        <article className={availableResources.length === 0 ? "kpi alarm" : "kpi"}>
          <span>Available resources</span>
          <strong>
            {availableResources.length}
            <em>/{situation.resources.length}</em>
          </strong>
          <small>{downResources.length} out of service</small>
        </article>
        <article className="kpi">
          <span>People in active zones</span>
          <strong>{peopleAtRisk.toLocaleString("en-US")}</strong>
          <small>
            {situation.zones.filter((zone) => zone.status !== "stable").length} unstable zones
          </small>
        </article>
        <article className="kpi">
          <span>Execution</span>
          <strong className={situation.integration.mode === "happyrobot" ? "live" : "mock"}>
            {situation.integration.mode === "happyrobot" ? "Live" : "Simulated"}
          </strong>
          <small>
            {situation.integration.liveActionsExecuted} live ·{" "}
            {situation.integration.mockActionsExecuted} simulated
          </small>
        </article>
        <article className={situation.scenario.running ? "kpi running" : "kpi"}>
          <span>Scenario</span>
          <strong>{situation.scenario.running ? "Running" : "Stopped"}</strong>
          <small>
            {clockLabel(elapsedSeconds)} · {situation.scenario.firedBeatIds.length}/
            {situation.scenario.beats.length} beats
          </small>
        </article>
      </div>
    </section>
  );
}
