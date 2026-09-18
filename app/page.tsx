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
  pending: "Pendiente",
  approved: "Aprobada",
  running: "En curso",
  succeeded: "Completada",
  failed: "Fallida",
  blocked: "Bloqueada",
  cancelled: "Cancelada"
};

const severityRank: Record<CrisisEvent["severity"], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
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
        <span>Cargando centro de mando</span>
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
          <p className="eyebrow">HappyRobot Crisis Command · Andalucia</p>
          <h1>Plan vivo de respuesta v{situation.plan.version}</h1>
        </div>
        <div className="top-actions">
          <button
            title="Actualizar situacion"
            className="icon-button"
            onClick={() => run("refresh", refresh)}
            disabled={busy !== null}
          >
            <RefreshCw size={18} />
          </button>
          <button
            title="Reiniciar demo"
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
          <span>Prioridad actual</span>
          <strong>{topPriority?.zone.name ?? "Ninguna"}</strong>
        </article>
        <article>
          <span>Senales criticas</span>
          <strong>{criticalEvents}</strong>
        </article>
        <article>
          <span>Acciones abiertas</span>
          <strong>{openActions}</strong>
        </article>
        <article>
          <span>Recursos libres</span>
          <strong>{availableResources}</strong>
        </article>
        <article>
          <span>Modo ejecucion</span>
          <strong>{situation.integration.mode}</strong>
        </article>
      </section>

      <section className="demo-strip" aria-label="Inyectores de eventos demo">
        <button onClick={() => run("incident", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "incident" }) }))}>
          <Siren size={16} /> Nuevo incidente
        </button>
        <button onClick={() => run("resource", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "resource-down" }) }))}>
          <ShieldAlert size={16} /> Recurso caido
        </button>
        <button onClick={() => run("route", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "route-blocked" }) }))}>
          <Route size={16} /> Ruta bloqueada
        </button>
        <button onClick={() => run("failure", () => requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind: "integration-failure" }) }))}>
          <AlertTriangle size={16} /> Fallo integracion
        </button>
      </section>

      <div className="grid">
        <section className="panel map-panel">
          <div className="panel-title">
            <Crosshair size={18} />
            <h2>Mapa operativo de Andalucia</h2>
          </div>
          <div className="map">
            <div className="map-label">Andalucia · cobertura demo regional</div>
            <svg className="region-shape" viewBox="0 0 760 520" role="img" aria-label="Mapa esquematico de Andalucia">
              <path
                className="map-land andalucia"
                d="M94 285 L126 226 L185 206 L238 165 L314 152 L371 178 L431 143 L510 157 L574 188 L647 197 L694 235 L676 291 L628 328 L590 383 L506 389 L437 365 L374 386 L301 369 L248 397 L174 374 L121 335 Z"
              />
              <path className="map-land border-context" d="M86 214 L126 226 L94 285 L121 335 L83 354 L55 296 Z" />
              <path className="map-land sea-context" d="M148 408 L249 421 L354 406 L451 421 L571 411 L650 374 L691 395 L632 461 L423 479 L238 459 Z" />
              <path className="map-line" d="M185 206 L174 374 M314 152 L301 369 M431 143 L437 365 M574 188 L590 383 M121 335 L676 291 M126 226 L628 328" />
            </svg>
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
            <h2>Prioridades</h2>
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
            <h2>Cola de acciones</h2>
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
                    title="Aprobar accion"
                    onClick={() => run(action.id, () => requestJson(`/api/actions/${action.id}/approve`, { method: "POST", body: "{}" }))}
                    disabled={busy !== null || !["pending", "failed", "blocked"].includes(action.status)}
                  >
                    <Check size={15} /> Aprobar
                  </button>
                  <button
                    title="Reintentar accion"
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
                    <RefreshCw size={15} /> Reintentar
                  </button>
                  <button
                    title="Cancelar accion"
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
                    <X size={15} /> Cancelar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Clock3 size={18} />
            <h2>Linea temporal</h2>
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
                    title="Confirmar evento"
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
                    title="Descartar evento"
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
            <h2>Recursos</h2>
          </div>
          <div className="resource-list">
            {situation.resources.map((resource: Resource) => {
              const zone = situation.zones.find((candidate) => candidate.id === resource.zoneId);
              return (
                <article key={resource.id} className={`resource ${resource.status}`}>
                  <div>
                    <h3>{resource.name}</h3>
                    <p>{resource.type} · capacidad {resource.capacity}</p>
                  </div>
                  <span>{resource.status}</span>
                  <small>{zone?.name ?? "movil"}</small>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
