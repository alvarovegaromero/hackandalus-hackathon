"use client";

import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Crosshair,
  Loader2,
  PhoneCall,
  Radio,
  RefreshCw,
  RotateCcw,
  Route,
  ShieldAlert,
  Siren,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Action, CrisisEvent, CrisisZone, Resource, SituationState } from "@/lib/types";

const statusLabels: Record<Action["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled"
};

const severityRank: Record<CrisisEvent["severity"], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function priorityFor(zone: CrisisZone, situation: SituationState) {
  return situation.plan.priorities.find((priority) => priority.zoneId === zone.id);
}

function actionIcon(action: Action) {
  if (action.status === "running") return <Loader2 className="spin" size={16} />;
  if (action.status === "failed" || action.status === "blocked") return <CircleAlert size={16} />;
  if (action.status === "succeeded") return <CheckCircle2 size={16} />;
  if (action.channel === "call") return <PhoneCall size={16} />;
  return <Radio size={16} />;
}

export default function Home() {
  const [situation, setSituation] = useState<SituationState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const next = await requestJson<SituationState>("/api/situation");
    setSituation(next);
  }

  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load situation"));
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const topPriority = useMemo(() => {
    if (!situation) return null;
    const priority = situation.plan.priorities[0];
    const zone = situation.zones.find((candidate) => candidate.id === priority?.zoneId);
    return zone && priority ? { zone, priority } : null;
  }, [situation]);

  if (!situation) {
    return (
      <main className="shell center">
        <Loader2 className="spin" size={24} />
        <span>Loading command center</span>
      </main>
    );
  }

  const openActions = situation.actions.filter((action) =>
    ["pending", "approved", "running", "failed", "blocked"].includes(action.status)
  ).length;
  const availableResources = situation.resources.filter((resource) => resource.status === "available").length;
  const criticalEvents = situation.events.filter((event) => severityRank[event.severity] >= severityRank.high).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">HappyRobot Crisis Command</p>
          <h1>Live response plan v{situation.plan.version}</h1>
        </div>
        <div className="top-actions">
          <button
            title="Refresh situation"
            className="icon-button"
            onClick={() => run("refresh", refresh)}
            disabled={busy !== null}
          >
            <RefreshCw size={18} />
          </button>
          <button
            title="Reset demo"
            className="icon-button danger-light"
            onClick={() => run("reset", () => requestJson("/api/demo/reset", { method: "POST", body: "{}" }))}
            disabled={busy !== null}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}
      {situation.integration.lastExternalError ? (
        <div className="banner warning">{situation.integration.lastExternalError}</div>
      ) : null}

      <section className="metrics">
        <article>
          <span>Top priority</span>
          <strong>{topPriority?.zone.name ?? "None"}</strong>
        </article>
        <article>
          <span>Critical signals</span>
          <strong>{criticalEvents}</strong>
        </article>
        <article>
          <span>Open actions</span>
          <strong>{openActions}</strong>
        </article>
        <article>
          <span>Available resources</span>
          <strong>{availableResources}</strong>
        </article>
        <article>
          <span>Execution mode</span>
          <strong>{situation.integration.mode}</strong>
        </article>
      </section>

      <section className="demo-strip" aria-label="Demo event injectors">
        <button onClick={() => run("incident", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "incident" }) }))}>
          <Siren size={16} /> New incident
        </button>
        <button onClick={() => run("resource", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "resource-down" }) }))}>
          <ShieldAlert size={16} /> Resource down
        </button>
        <button onClick={() => run("route", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "route-blocked" }) }))}>
          <Route size={16} /> Route blocked
        </button>
        <button onClick={() => run("failure", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "integration-failure" }) }))}>
          <AlertTriangle size={16} /> Integration failure
        </button>
      </section>

      <div className="grid">
        <section className="panel map-panel">
          <div className="panel-title">
            <Crosshair size={18} />
            <h2>Situation Map</h2>
          </div>
          <div className="map">
            {situation.zones.map((zone) => {
              const priority = priorityFor(zone, situation);
              return (
                <button
                  key={zone.id}
                  className={`zone-marker ${zone.status}`}
                  style={{ left: `${zone.coordinates.x}%`, top: `${zone.coordinates.y}%` }}
                  title={`${zone.name}: ${priority?.score ?? zone.riskScore}`}
                >
                  <span>{zone.name}</span>
                  <b>{priority?.score ?? zone.riskScore}</b>
                </button>
              );
            })}
          </div>
          <p className="plan-summary">{situation.plan.summary}</p>
        </section>

        <section className="panel">
          <div className="panel-title">
            <AlertTriangle size={18} />
            <h2>Priorities</h2>
          </div>
          <div className="priority-list">
            {situation.plan.priorities.map((priority, index) => {
              const zone = situation.zones.find((candidate) => candidate.id === priority.zoneId);
              if (!zone) return null;
              return (
                <article key={priority.zoneId} className="priority-row">
                  <strong>{index + 1}</strong>
                  <div>
                    <h3>{zone.name}</h3>
                    <p>{priority.reason}</p>
                  </div>
                  <span>{priority.score}</span>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel wide">
          <div className="panel-title">
            <Radio size={18} />
            <h2>Action Queue</h2>
          </div>
          <div className="action-list">
            {situation.actions.map((action) => (
              <article key={action.id} className={`action-row ${action.status}`}>
                <div className="action-main">
                  <span className="action-icon">{actionIcon(action)}</span>
                  <div>
                    <h3>{action.objective}</h3>
                    <p>{action.reason}</p>
                    {action.error ? <p className="inline-error">{action.error}</p> : null}
                  </div>
                </div>
                <div className="action-meta">
                  <span>{action.channel}</span>
                  <span>{statusLabels[action.status]}</span>
                  <span>{action.executionMode}</span>
                </div>
                <div className="row-actions">
                  <button
                    title="Approve action"
                    onClick={() => run(action.id, () => requestJson(`/api/actions/${action.id}/approve`, { method: "POST", body: "{}" }))}
                    disabled={busy !== null || !["pending", "failed", "blocked"].includes(action.status)}
                  >
                    <Check size={15} /> Approve
                  </button>
                  <button
                    title="Retry action"
                    onClick={() =>
                      run(`${action.id}-retry`, () =>
                        requestJson(`/api/actions/${action.id}/status`, {
                          method: "POST",
                          body: JSON.stringify({ operation: "retry" })
                        })
                      )
                    }
                    disabled={busy !== null || !["failed", "blocked", "cancelled"].includes(action.status)}
                  >
                    <RefreshCw size={15} /> Retry
                  </button>
                  <button
                    title="Cancel action"
                    className="danger-light"
                    onClick={() =>
                      run(`${action.id}-cancel`, () =>
                        requestJson(`/api/actions/${action.id}/status`, {
                          method: "POST",
                          body: JSON.stringify({ operation: "cancel" })
                        })
                      )
                    }
                    disabled={busy !== null || ["succeeded", "cancelled"].includes(action.status)}
                  >
                    <X size={15} /> Cancel
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Clock3 size={18} />
            <h2>Event Timeline</h2>
          </div>
          <div className="timeline">
            {situation.events.map((event) => (
              <article key={event.id} className={`event ${event.severity}`}>
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.description}</p>
                  <span>{timeLabel(event.createdAt)} · {event.source} · {event.confidence}</span>
                </div>
                <div className="event-actions">
                  <button
                    title="Confirm event"
                    onClick={() =>
                      run(`${event.id}-confirm`, () =>
                        requestJson(`/api/events/${event.id}/mark`, {
                          method: "POST",
                          body: JSON.stringify({ confirmed: true })
                        })
                      )
                    }
                    disabled={busy !== null || event.confirmed === true}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    title="Discard event"
                    className="danger-light"
                    onClick={() =>
                      run(`${event.id}-discard`, () =>
                        requestJson(`/api/events/${event.id}/mark`, {
                          method: "POST",
                          body: JSON.stringify({ confirmed: false })
                        })
                      )
                    }
                    disabled={busy !== null || event.confirmed === false}
                  >
                    <Ban size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <ShieldAlert size={18} />
            <h2>Resources</h2>
          </div>
          <div className="resource-list">
            {situation.resources.map((resource: Resource) => {
              const zone = situation.zones.find((candidate) => candidate.id === resource.zoneId);
              return (
                <article key={resource.id} className={`resource ${resource.status}`}>
                  <div>
                    <h3>{resource.name}</h3>
                    <p>{resource.type} · capacity {resource.capacity}</p>
                  </div>
                  <span>{resource.status}</span>
                  <small>{zone?.name ?? "mobile"}</small>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
