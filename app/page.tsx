"use client";

// Pantalla única del centro de mando. Orquesta el sondeo del estado, guarda lo
// que el operador tiene abierto entre refrescos y reparte el estado a los
// paneles. Los textos del servidor se muestran tal cual llegan.

import {
  AlertTriangle,
  Crosshair,
  Flame,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Route,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateActionPayload, SituationState } from "@/lib/types";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import ActionQueue from "./components/ActionQueue";
import AuditPanel from "./components/AuditPanel";
import ContactsPanel from "./components/ContactsPanel";
import DigitalTwinPanel from "./components/DigitalTwinPanel";
import HeroSummary from "./components/HeroSummary";
import OperationsMap from "./components/OperationsMap";
import PlanChanges from "./components/PlanChanges";
import ResourcesPanel from "./components/ResourcesPanel";
import ScenarioBar from "./components/ScenarioBar";
import SignalsPanel from "./components/SignalsPanel";
import ZoneDetail from "./components/ZoneDetail";
import {
  agoLabel,
  isOpenAction,
  maybe,
  severityRank,
  troubledActionStatuses,
  zoneStatusLabels,
} from "./components/shared";

const POLL_MS = 4000;
const FRESH_MS = 25000;

type TabId = "actions" | "signals" | "resources" | "contacts" | "audit";

const tabLabels: Record<TabId, string> = {
  actions: "Actions",
  signals: "Signals",
  resources: "Resources",
  contacts: "Contacts & Escalation",
  audit: "Audit",
};

/** Formats an API error response for the operator. */
async function describeFailure(response: Response, path: string) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string; mensaje?: string };
    const message = parsed.error ?? parsed.mensaje;
    if (message) return `${message} (${response.status} on ${path})`;
  } catch {
    // Response was not JSON: show as is, truncated.
  }
  return `${response.status} on ${path}: ${body.slice(0, 160)}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await describeFailure(response, path));
  return response.json() as Promise<T>;
}

export default function Home() {
  const [situation, setSituation] = useState<SituationState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("actions");
  const [formOpen, setFormOpen] = useState(false);
  const [prefillZoneId, setPrefillZoneId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [seenTimes, setSeenTimes] = useState<Map<string, number>>(() => new Map());
  const [planSeen, setPlanSeen] = useState<{ version: number; at: number }>(() => ({
    version: -1,
    at: 0,
  }));

  // Control del refresco: la huella evita repintar cuando nada ha cambiado, y
  // los mapas de "primera vez que lo vi" permiten resaltar lo recién llegado.
  const fingerprintRef = useRef<string>("");
  const seenRef = useRef<Map<string, number>>(new Map());
  const bootstrappedRef = useRef(false);
  const planSeenRef = useRef<{ version: number; at: number }>({ version: -1, at: 0 });

  const registerSeen = useCallback((next: SituationState) => {
    const stamp = bootstrappedRef.current ? Date.now() : 0;
    for (const item of [...next.events, ...next.actions]) {
      if (!seenRef.current.has(item.id)) seenRef.current.set(item.id, stamp);
    }
    if (planSeenRef.current.version !== next.plan.version) {
      planSeenRef.current = { version: next.plan.version, at: stamp };
    }
    bootstrappedRef.current = true;
    setSeenTimes(new Map(seenRef.current));
    setPlanSeen(planSeenRef.current);
  }, []);

  const refresh = useCallback(async () => {
    const next = await requestJson<SituationState>("/api/situation");
    registerSeen(next);
    const fingerprint = JSON.stringify(next);
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    setSituation(next);
  }, [registerSeen]);

  const run = useCallback(
    async (label: string, operation: () => Promise<void>) => {
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
    },
    [refresh],
  );

  // Sondeo del estado. GET /api/situation ya hace avanzar el guion y barrer las
  // acciones atascadas en el servidor, así que no hace falta empujar nada más.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await refresh();
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load situation");
      }
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  // Reloj local a un segundo: mueve el cronómetro del escenario y caduca los
  // resaltados de "esto acaba de cambiar" sin pedir nada al servidor.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const freshIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, at] of seenTimes) {
      if (at > 0 && nowMs - at < FRESH_MS) ids.add(id);
    }
    return ids;
  }, [seenTimes, nowMs]);

  const planIsFresh = planSeen.at > 0 && nowMs - planSeen.at < FRESH_MS;

  const selectedZone = situation?.zones.find((zone) => zone.id === selectedZoneId) ?? null;

  const elapsedSeconds = useMemo(() => {
    if (!situation) return 0;
    const { scenario } = situation;
    if (scenario.running && scenario.startedAt) {
      return (nowMs - new Date(scenario.startedAt).getTime()) / 1000;
    }
    return scenario.elapsedSeconds;
  }, [situation, nowMs]);

  const scenarioCall = useCallback(
    (operation: "start" | "stop", body: Record<string, unknown> = {}) =>
      run(`scenario-${operation}`, async () => {
        setNotice(null);
        const response = await fetch(`/api/scenario/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.status === 404 || response.status === 405) {
          setNotice(
            `The POST /api/scenario/${operation} endpoint does not exist on this server yet. The control is ready in the interface and will work once the route is published.`,
          );
          return;
        }
        if (!response.ok)
          throw new Error(await describeFailure(response, `/api/scenario/${operation}`));
      }),
    [run],
  );

  // Interruptor general de autonomía: es el mando más importante para poder
  // intervenir, así que la interfaz lo ofrece aunque la ruta aún no exista.
  const toggleAutonomy = useCallback(
    (paused: boolean) =>
      run("autonomy", async () => {
        setNotice(null);
        const response = await fetch("/api/autonomy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paused }),
        });
        if (response.status === 404 || response.status === 405) {
          setNotice(
            "Pausing or resuming autonomy requires POST /api/autonomy with { paused }. The route is not responding yet, so the system remains unchanged.",
          );
          return;
        }
        if (!response.ok) throw new Error(await describeFailure(response, "/api/autonomy"));
      }),
    [run],
  );

  const reassignResource = useCallback(
    (actionId: string, resourceId: string) =>
      run(`${actionId}-assign`, async () => {
        setNotice(null);
        const primary = await fetch(`/api/actions/${actionId}/assign`, {
          method: "POST",
          body: JSON.stringify({ resourceId }),
        });
        if (primary.ok) return;
        if (primary.status !== 404 && primary.status !== 405) {
          throw new Error(`${primary.status} /api/actions/${actionId}/assign`);
        }
        // Segunda convención posible: la ruta de estado con una operación.
        const fallback = await fetch(`/api/actions/${actionId}/status`, {
          method: "POST",
          body: JSON.stringify({ operation: "assign", resourceId }),
        });
        if (fallback.ok) return;
        setNotice(
          "Resource reassignment requires POST /api/actions/:id/assign with { resourceId }. The route is not responding yet, so the resource was not changed.",
        );
      }),
    [run],
  );

  const createAction = useCallback(
    (payload: CreateActionPayload) =>
      run("create-action", async () => {
        await requestJson("/api/actions", { method: "POST", body: JSON.stringify(payload) });
        setFormOpen(false);
      }),
    [run],
  );

  const injectDemo = useCallback(
    (kind: string) =>
      run(`inject-${kind}`, () =>
        requestJson("/api/demo/inject", { method: "POST", body: JSON.stringify({ kind }) }).then(
          () => undefined,
        ),
      ),
    [run],
  );

  if (!situation) {
    return (
      <main className="shell center">
        <Loader2 className="spin" size={24} aria-hidden="true" />
        <span>{error ?? "Loading command center…"}</span>
      </main>
    );
  }

  const autonomyPaused = maybe(situation, "autonomyPaused") === true;
  const openActions = situation.actions.filter(isOpenAction);
  const troubled = situation.actions.filter((action) =>
    troubledActionStatuses.includes(action.status),
  );
  const unverified = situation.events.filter((event) => event.confirmed === null);
  const criticalSignals = situation.events.filter(
    (event) => event.confirmed !== false && severityRank[event.severity] >= severityRank.high,
  );

  const tabBadges: Record<TabId, number> = {
    actions: openActions.length,
    signals: unverified.length,
    resources: situation.resources.filter((resource) => resource.status === "unavailable").length,
    contacts: situation.chains.filter((chain) => chain.status === "active").length,
    audit: situation.audit.length,
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-blueprint-mid">
            FARO · Command Center 112 Andalucía
          </p>
          <div className="flex items-center gap-2.5 mt-0.5">
            <h1 className="text-[24px] font-bold text-blueprint-dark tracking-[-0.15px] leading-tight flex items-center gap-2">
              Live Response Plan v{situation.plan.version}
            </h1>
            <Badge variant={situation.integration.mode === "happyrobot" ? "info" : "outline"}>
              {situation.integration.mode === "happyrobot"
                ? "Live execution"
                : "Simulated execution"}
            </Badge>
          </div>
          <p className="text-[13px] text-blueprint-mid tracking-[-0.15px] mt-1">
            {situation.plan.summary} · updated {agoLabel(situation.plan.generatedAt, nowMs)}
          </p>
        </div>
        <div className="top-actions flex items-center gap-2">
          {busy ? (
            <Loader2 className="spin text-blueprint-mid" size={16} aria-hidden="true" />
          ) : null}
          <Button
            variant={autonomyPaused ? "pill" : "outline"}
            size="sm"
            onClick={() => toggleAutonomy(!autonomyPaused)}
            disabled={busy !== null}
            aria-pressed={autonomyPaused}
            aria-label={
              autonomyPaused
                ? "Resume system autonomy"
                : "Pause autonomy: nothing will execute without human approval"
            }
          >
            {autonomyPaused ? (
              <>
                <Play size={14} aria-hidden="true" /> Resume autonomy
              </>
            ) : (
              <>
                <PauseCircle size={14} aria-hidden="true" /> Pause autonomy
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh situation now"
            onClick={() => run("refresh", refresh)}
            disabled={busy !== null}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="pillDestructive"
            size="icon"
            aria-label="Reset demo to initial state"
            onClick={() =>
              run("reset", () => requestJson("/api/demo/reset", { method: "POST", body: "{}" }))
            }
            disabled={busy !== null}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="banner-stack" aria-live="assertive">
        {error ? <div className="banner error">{error}</div> : null}
        {notice ? <div className="banner warning">{notice}</div> : null}
        {autonomyPaused ? (
          <div className="banner warning">
            Autonomy paused by operator: the system continues analyzing and proposing, but will not
            execute anything on its own until resumed.
          </div>
        ) : null}
        {situation.plan.valid === false ? (
          <div className="banner error">
            Plan v{situation.plan.version} is no longer valid
            {situation.plan.invalidatedReason ? `: ${situation.plan.invalidatedReason}` : "."}{" "}
            Replan needed.
          </div>
        ) : null}
        {situation.integration.lastExternalError ? (
          <div className="banner warning">
            Integration: {situation.integration.lastExternalError}
          </div>
        ) : null}
        <div
          className={situation.integration.mode === "happyrobot" ? "banner live" : "banner mock"}
        >
          {situation.integration.mode === "happyrobot"
            ? "Live execution mode: approved actions are dispatched to HappyRobot."
            : "Simulation mode: no actions are sent externally, everything shown here is simulated."}{" "}
          Live actions executed: {situation.integration.liveActionsExecuted} · simulated:{" "}
          {situation.integration.mockActionsExecuted}.
          {situation.integration.mode === "happyrobot" &&
          !situation.integration.happyRobotConfigured
            ? " Missing HappyRobot credentials, actions will fail."
            : ""}
        </div>
      </div>

      <HeroSummary
        situation={situation}
        nowMs={nowMs}
        planIsFresh={planIsFresh}
        onFocusZone={(zoneId) => setSelectedZoneId(zoneId)}
        onOpenAudit={() => setActiveTab("audit")}
      />

      <ScenarioBar
        scenario={situation.scenario}
        world={maybe(situation, "world")}
        elapsedSeconds={elapsedSeconds}
        busy={busy !== null}
        onStart={() => scenarioCall("start")}
        onStop={() => scenarioCall("stop")}
        onSpeed={(speed) => scenarioCall("start", { speed })}
      />

      <DigitalTwinPanel twin={maybe(situation, "digitalTwin")} nowMs={nowMs} />

      <section className="demo-strip" aria-label="Inject changes manually">
        <span className="strip-label">Inject a change</span>
        <button onClick={() => injectDemo("incident")} disabled={busy !== null}>
          <Siren size={16} aria-hidden="true" /> New incident
        </button>
        <button onClick={() => injectDemo("resource-down")} disabled={busy !== null}>
          <ShieldAlert size={16} aria-hidden="true" /> Resource down
        </button>
        <button onClick={() => injectDemo("route-blocked")} disabled={busy !== null}>
          <Route size={16} aria-hidden="true" /> Route blocked
        </button>
        <button onClick={() => injectDemo("integration-failure")} disabled={busy !== null}>
          <AlertTriangle size={16} aria-hidden="true" /> Integration failure
        </button>
      </section>

      <div className="grid">
        <section className="panel map-panel">
          <div className="panel-title">
            <Crosshair size={18} aria-hidden="true" />
            <h2>Operational map</h2>
            <span className="hint">Click a zone to view score breakdown</span>
          </div>
          <OperationsMap
            zones={situation.zones}
            plan={situation.plan}
            world={maybe(situation, "world")}
            selectedZoneId={selectedZoneId}
            onSelect={(zoneId) => setSelectedZoneId(zoneId === selectedZoneId ? null : zoneId)}
          />
          <p className="plan-summary">{situation.plan.summary}</p>
        </section>

        {selectedZone ? (
          <ZoneDetail
            zone={selectedZone}
            situation={situation}
            nowMs={nowMs}
            onClose={() => setSelectedZoneId(null)}
            onCreateAction={(zoneId) => {
              setPrefillZoneId(zoneId);
              setFormOpen(true);
              setActiveTab("actions");
            }}
          />
        ) : (
          <section className="panel" aria-label="Plan priorities">
            <div className="panel-title">
              <Flame size={18} aria-hidden="true" />
              <h2>Priority ranking</h2>
            </div>
            <div className="priority-list">
              {situation.plan.priorities.map((priority, index) => {
                const zone = situation.zones.find((candidate) => candidate.id === priority.zoneId);
                if (!zone) return null;
                return (
                  <button
                    key={priority.zoneId}
                    className={`priority-row ${index === 0 ? "top" : ""}`}
                    onClick={() => setSelectedZoneId(zone.id)}
                    aria-label={`View details for ${zone.name}, priority number ${index + 1}`}
                  >
                    <strong>{index + 1}</strong>
                    <div>
                      <h3>
                        {zone.name}{" "}
                        <span className={`pill zone-${zone.status}`}>
                          {zoneStatusLabels[zone.status]}
                        </span>
                      </h3>
                      <p>{priority.reason}</p>
                    </div>
                    <span className="score">{priority.score}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <PlanChanges
          plan={situation.plan}
          planHistory={situation.planHistory}
          nowMs={nowMs}
          isFresh={planIsFresh}
        />

        <section className="panel wide">
          <div className="tab-bar" role="tablist" aria-label="Response details">
            {(Object.keys(tabLabels) as TabId[]).map((tabId) => (
              <button
                key={tabId}
                role="tab"
                id={`tab-${tabId}`}
                aria-selected={activeTab === tabId}
                aria-controls={`panel-${tabId}`}
                className={activeTab === tabId ? "tab active" : "tab"}
                onClick={() => setActiveTab(tabId)}
              >
                {tabLabels[tabId]}
                {tabBadges[tabId] > 0 ? <em>{tabBadges[tabId]}</em> : null}
              </button>
            ))}
            <span className="tab-hint">
              {troubled.length > 0
                ? `${troubled.length} action(s) need attention`
                : `${criticalSignals.length} critical signal(s) active`}
            </span>
          </div>

          <div
            className="tab-panel"
            role="tabpanel"
            id={`panel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            {activeTab === "actions" ? (
              <ActionQueue
                actions={situation.actions}
                zones={situation.zones}
                contacts={situation.contacts}
                resources={situation.resources}
                busy={busy}
                nowMs={nowMs}
                freshIds={freshIds}
                formOpen={formOpen}
                prefillZoneId={prefillZoneId}
                onToggleForm={setFormOpen}
                onApprove={(actionId) =>
                  run(actionId, () =>
                    requestJson(`/api/actions/${actionId}/approve`, {
                      method: "POST",
                      body: "{}",
                    }).then(() => undefined),
                  )
                }
                onRetry={(actionId) =>
                  run(`${actionId}-retry`, () =>
                    requestJson(`/api/actions/${actionId}/status`, {
                      method: "POST",
                      body: JSON.stringify({ operation: "retry" }),
                    }).then(() => undefined),
                  )
                }
                onCancel={(actionId) =>
                  run(`${actionId}-cancel`, () =>
                    requestJson(`/api/actions/${actionId}/status`, {
                      method: "POST",
                      body: JSON.stringify({ operation: "cancel" }),
                    }).then(() => undefined),
                  )
                }
                onReassign={reassignResource}
                onCreate={createAction}
              />
            ) : null}

            {activeTab === "signals" ? (
              <SignalsPanel
                events={situation.events}
                zones={situation.zones}
                busy={busy}
                nowMs={nowMs}
                freshIds={freshIds}
                onMark={(eventId, confirmed) =>
                  run(`${eventId}-mark`, () =>
                    requestJson(`/api/events/${eventId}/mark`, {
                      method: "POST",
                      body: JSON.stringify({ confirmed }),
                    }).then(() => undefined),
                  )
                }
              />
            ) : null}

            {activeTab === "resources" ? (
              <ResourcesPanel
                resources={situation.resources}
                zones={situation.zones}
                actions={situation.actions}
                waiting={maybe(situation, "waiting")}
                nowMs={nowMs}
              />
            ) : null}

            {activeTab === "contacts" ? (
              <ContactsPanel
                contacts={situation.contacts}
                chains={situation.chains}
                zones={situation.zones}
                nowMs={nowMs}
              />
            ) : null}

            {activeTab === "audit" ? (
              <AuditPanel audit={situation.audit} lessons={maybe(situation, "lessons")} />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
