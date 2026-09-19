"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Download,
  Flame,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  StepForward,
  Waves,
} from "lucide-react";
import DrillTwin from "./drill-twin";
import {
  ACTIONS,
  actionIds,
  actionUnavailable,
  advanceDrill,
  applyDrillAction,
  comparableDrills,
  createDrill,
  DEFAULT_DRILL,
  drillConfigSchema,
  drillLessons,
  drillMetrics,
  drillReport,
  LOCALITIES,
  PHASE_NAMES,
  type DrillConfig,
  type DrillRun,
  type SectorId,
} from "@/lib/emergency-drills";
import {
  DRILL_STORAGE_KEY,
  EMPTY_NOTEBOOK,
  readDrillNotebook,
  storeDrillRun,
  type DrillNotebook,
} from "@/lib/drill-storage";

function exportReport(run: DrillRun) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(drillReport(run), null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `faro-drill-${run.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EmergencyDrills() {
  const [config, setConfig] = useState<DrillConfig>(DEFAULT_DRILL);
  const [notebook, setNotebook] = useState<DrillNotebook>(EMPTY_NOTEBOOK);
  const [run, setRun] = useState<DrillRun | null>(null);
  const [selected, setSelected] = useState<SectorId>("care");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replaceActive, setReplaceActive] = useState(false);
  const notebookRef = useRef(notebook);
  const runRef = useRef(run);
  const storageBlockedRef = useRef(false);
  const runHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Storage is loaded after hydration; the server never reads browser data.
    const load = () => {
      try {
        const saved = readDrillNotebook(localStorage.getItem(DRILL_STORAGE_KEY));
        notebookRef.current = saved;
        runRef.current = saved.active;
        setNotebook(saved);
        setRun(saved.active);
        if (saved.active) {
          setConfig(saved.active.config);
          setShowSetup(false);
        }
      } catch {
        storageBlockedRef.current = true;
        setStorageBlocked(true);
        setStorageWarning(
          "Saved exercises could not be read. They have not been overwritten. You can continue in this tab and export reports.",
        );
      }
      setReady(true);
    };
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DRILL_STORAGE_KEY && event.key !== null) return;
      storageBlockedRef.current = true;
      setStorageBlocked(true);
      setPlaying(false);
      setStorageWarning(
        "Another tab changed the exercise notebook. Saving is paused to prevent overwriting it. Export your current report, then reload to use the latest notebook.",
      );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function persist(nextRun: DrillRun) {
    const next = storeDrillRun(notebookRef.current, nextRun);
    notebookRef.current = next;
    runRef.current = nextRun;
    setNotebook(next);
    setRun(nextRun);
    if (!storageBlockedRef.current) {
      try {
        localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(next));
        setStorageWarning(null);
      } catch {
        setStorageWarning(
          "Browser storage is unavailable or full. This exercise remains in this tab only; export the report before leaving.",
        );
      }
    }
  }

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = runRef.current;
      if (!current || current.status !== "running") {
        setPlaying(false);
        return;
      }
      const next = advanceDrill(current, new Date().toISOString());
      persist(next);
      if (next.status === "completed") setPlaying(false);
    }, 12000);
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [playing]);

  const preview = createDrill(
    DEFAULT_DRILL,
    "00000000-0000-4000-8000-000000000000",
    "2026-01-01T00:00:00.000Z",
  );
  const displayed = run ?? preview;
  const metrics = drillMetrics(displayed);
  const previous = comparableDrills(run?.config ?? config, notebook.history).find(
    (item) => !run || item.startedAt < run.startedAt,
  );
  const priorLessons = previous ? drillLessons(previous) : [];
  const sector = displayed.sectors.find((item) => item.id === selected)!;
  const finished = run?.status === "completed";
  const lessons = finished ? drillLessons(run) : [];
  const lastEvent = displayed.log.filter((entry) => entry.kind === "event").at(-1);
  const historyEntry = replayIndex === null ? null : run?.log[replayIndex];

  function startDrill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = drillConfigSchema.safeParse(config);
    if (!result.success) {
      setError(
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "),
      );
      return;
    }
    if (notebook.active && !replaceActive) {
      setError("Confirm replacement of the unfinished exercise before starting a new one.");
      return;
    }
    setError(null);
    setPlaying(false);
    setReplaceActive(false);
    setReplayIndex(null);
    setSelected("care");
    setShowSetup(false);
    persist(createDrill(result.data, crypto.randomUUID(), new Date().toISOString()));
    requestAnimationFrame(() => runHeadingRef.current?.focus());
  }

  function review(previousRun: DrillRun) {
    setPlaying(false);
    setError(null);
    setRun(previousRun);
    runRef.current = previousRun;
    setShowSetup(false);
    setReplayIndex(null);
  }

  function step() {
    const current = runRef.current;
    if (!current) return;
    setError(null);
    const next = advanceDrill(current, new Date().toISOString());
    persist(next);
    if (next.status === "completed") setPlaying(false);
  }

  return (
    <main className="drills-shell">
      <header className="drills-nav">
        <Link href="/dashboard" prefetch={false}>
          <ArrowLeft size={16} /> Far0 command centre
        </Link>
        <span>
          <Box size={16} /> Training workspace
        </span>
        <span className="drills-simulation">Simulation only · no live dispatch</span>
      </header>
      <div className="drills-heading">
        <div>
          <h1>Emergency drills</h1>
          <p>Rehearse decisions. Understand the outcome. Carry the lesson forward.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowSetup(!showSetup);
            setPlaying(false);
            setError(null);
          }}
        >
          {showSetup ? "Hide configuration" : "Configure new drill"}
        </button>
      </div>
      {storageWarning ? (
        <p className="drills-notice" role="status">
          {storageWarning}
        </p>
      ) : null}
      {storageBlocked ? (
        <p className="drills-help">
          Notebook writes are paused. New actions remain available in memory.
        </p>
      ) : null}
      {error ? (
        <p className="drills-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={`drills-workspace${showSetup ? " with-setup" : ""}`}>
        {showSetup ? (
          <aside className="drills-setup">
            <h2>Build your exercise</h2>
            <p className="drills-help">
              Choose a place and the constraints your team will practice.
            </p>
            <form onSubmit={startDrill}>
              <fieldset className="drills-hazard-options">
                <legend>Emergency</legend>
                <label>
                  <input
                    type="radio"
                    name="hazard"
                    checked={config.hazard === "earthquake"}
                    onChange={() => setConfig({ ...config, hazard: "earthquake" })}
                  />
                  <Waves size={18} /> Earthquake
                </label>
                <label>
                  <input
                    type="radio"
                    name="hazard"
                    checked={config.hazard === "wildfire"}
                    onChange={() => setConfig({ ...config, hazard: "wildfire" })}
                  />
                  <Flame size={18} /> Wildfire
                </label>
              </fieldset>
              <label>
                Locality preset
                <select
                  value={
                    LOCALITIES.find(
                      (item) =>
                        item.name === config.locality &&
                        item.latitude === config.latitude &&
                        item.longitude === config.longitude,
                    )?.name ?? "custom"
                  }
                  onChange={(event) => {
                    const locality = LOCALITIES.find((item) => item.name === event.target.value);
                    setConfig({
                      ...config,
                      ...(locality
                        ? {
                            locality: locality.name,
                            latitude: locality.latitude,
                            longitude: locality.longitude,
                          }
                        : { locality: "" }),
                    });
                  }}
                >
                  <option value="custom">Custom locality</option>
                  {LOCALITIES.map((item) => (
                    <option key={item.name}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Locality name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={config.locality}
                  onChange={(event) => setConfig({ ...config, locality: event.target.value })}
                />
              </label>
              <div className="drills-field-pair">
                <label>
                  Latitude
                  <input
                    required
                    type="number"
                    min={-90}
                    max={90}
                    step="0.0001"
                    value={Number.isNaN(config.latitude) ? "" : config.latitude}
                    onChange={(event) =>
                      setConfig({ ...config, latitude: event.target.valueAsNumber })
                    }
                  />
                </label>
                <label>
                  Longitude
                  <input
                    required
                    type="number"
                    min={-180}
                    max={180}
                    step="0.0001"
                    value={Number.isNaN(config.longitude) ? "" : config.longitude}
                    onChange={(event) =>
                      setConfig({ ...config, longitude: event.target.valueAsNumber })
                    }
                  />
                </label>
              </div>
              <label>
                Exercise severity
                <select
                  value={config.severity}
                  onChange={(event) => {
                    const severity = drillConfigSchema.shape.severity.parse(event.target.value);
                    setConfig({ ...config, severity });
                  }}
                >
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                  <option value="extreme">Extreme</option>
                </select>
              </label>
              <div className="drills-field-pair">
                <label>
                  Simulated people
                  <input
                    required
                    type="number"
                    min={50}
                    max={10000}
                    value={Number.isNaN(config.population) ? "" : config.population}
                    onChange={(event) =>
                      setConfig({ ...config, population: event.target.valueAsNumber })
                    }
                  />
                </label>
                <label>
                  Response teams
                  <input
                    required
                    type="number"
                    min={2}
                    max={20}
                    value={Number.isNaN(config.teams) ? "" : config.teams}
                    onChange={(event) =>
                      setConfig({ ...config, teams: event.target.valueAsNumber })
                    }
                  />
                </label>
              </div>
              <p className="drills-help">
                Four phases, 20 simulated minutes. Teams return at each phase boundary. No real
                calls or alerts.
              </p>
              {notebook.active ? (
                <label className="drills-confirm">
                  <input
                    type="checkbox"
                    checked={replaceActive}
                    onChange={(event) => setReplaceActive(event.target.checked)}
                  />
                  Replace the unfinished exercise. Export it first if needed.
                </label>
              ) : null}
              <button type="submit" className="drills-primary" disabled={!ready}>
                <Play size={16} />
                {notebook.active ? "Start replacement drill" : "Generate drill"}
              </button>
            </form>
            <div className="drills-briefing">
              <h3>Learning from previous drills</h3>
              {comparableDrills(config, notebook.history)[0] ? (
                <p>
                  {comparableDrills(config, notebook.history).length} comparable exercise(s) found.
                  Their evidence-based checklist appears when you start.
                </p>
              ) : (
                <p>No matching exercises yet. Complete this drill to build a reusable checklist.</p>
              )}
            </div>
          </aside>
        ) : null}
        <div className="drills-main">
          <section className="drills-run-bar" aria-label="Exercise controls">
            <div>
              <h2 ref={runHeadingRef} tabIndex={-1}>
                {run
                  ? `${run.config.locality} / ${run.config.hazard === "earthquake" ? "Earthquake" : "Wildfire"}`
                  : "Your rehearsal starts here"}
              </h2>
              <p role="status">
                {run
                  ? `${PHASE_NAMES[run.phase]} · ${finished ? "Completed" : playing ? "Running at 5 simulated minutes / 12 seconds" : "Paused — advance when ready"}`
                  : "Example scene. Generate a drill to begin."}
              </p>
            </div>
            <div className="drills-run-buttons">
              <button
                type="button"
                disabled={!run || finished}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing ? "Pause" : "Auto advance"}
              </button>
              <button type="button" disabled={!run || finished} onClick={step}>
                <StepForward size={16} />
                {run?.phase === 3 ? "Finish & debrief" : "Next phase"}
              </button>
              <button
                type="button"
                disabled={!run}
                onClick={() => {
                  if (run) exportReport(run);
                }}
                aria-label="Export exercise report"
              >
                <Download size={16} />
              </button>
            </div>
          </section>
          <div className="drills-metrics">
            <div>
              <span>At assembly point</span>
              <strong>
                {run ? metrics.evacuated : "—"}
                <small> / {displayed.config.population}</small>
              </strong>
            </div>
            <div>
              <span>Awaiting assistance</span>
              <strong>{run ? metrics.remaining : "—"}</strong>
            </div>
            <div>
              <span>Teams available</span>
              <strong>
                {run ? displayed.teamsAvailable : "—"}
                <small> / {displayed.config.teams}</small>
              </strong>
            </div>
            <div>
              <span>Decisions recorded</span>
              <strong>{run ? metrics.decisions : "—"}</strong>
            </div>
          </div>
          <DrillTwin run={displayed} selected={selected} onSelect={setSelected} />
          <div className="drills-response-grid">
            <section className="drills-response">
              <div className="drills-section-title">
                <h2>{finished ? "Exercise outcome" : "Response desk"}</h2>
                <span>{sector.name}</span>
              </div>
              <p className="drills-event" role="status">
                {run ? lastEvent?.text : "Start an exercise to respond to changing conditions."}
              </p>
              <div className="drills-conditions">
                <span>{displayed.routeOpen ? "Access: open" : "Access: blocked"}</span>
                <span>
                  {displayed.communicationsDown ? "Network: unavailable" : "Network: available"}
                </span>
                <span>Buildings: {sector.assessed ? "assessed" : "unverified"}</span>
                <span>Exercise risk: {sector.risk}/100</span>
              </div>
              {finished ? (
                <div className="drills-outcome">
                  <ShieldCheck size={24} />
                  <p>
                    <strong>{metrics.coverage}% assembly-point coverage</strong>
                    <br />
                    {metrics.remaining} simulated people still awaiting assistance. This is a
                    training outcome, not a real-world forecast.
                  </p>
                </div>
              ) : (
                <div className="drills-actions">
                  {actionIds.map((action) => {
                    const unavailable = run
                      ? actionUnavailable(run, action, selected)
                      : "Generate a drill first.";
                    return (
                      <div key={action}>
                        <button
                          type="button"
                          disabled={!!unavailable}
                          aria-describedby={`action-help-${action}`}
                          onClick={() => {
                            const current = runRef.current;
                            if (!current) return;
                            try {
                              persist(applyDrillAction(current, action, selected));
                              setError(null);
                            } catch (caught) {
                              setError(
                                caught instanceof Error ? caught.message : "Action unavailable.",
                              );
                            }
                          }}
                        >
                          <span>{ACTIONS[action].label}</span>
                          <small>
                            {ACTIONS[action].teams ? `${ACTIONS[action].teams} teams` : "Comms"}
                          </small>
                        </button>
                        <p id={`action-help-${action}`}>
                          {unavailable ?? ACTIONS[action].description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="drills-timeline">
              <div className="drills-section-title">
                <h2>Decision timeline</h2>
                <span>Simulated time</span>
              </div>
              {run ? (
                <ol>
                  {run.log.map((entry, index) => (
                    <li
                      key={entry.id}
                      className={`${entry.kind}${replayIndex === index ? " is-reviewed" : ""}`}
                    >
                      <span>T+{String(entry.minute).padStart(2, "0")}</span>
                      <p>{entry.text}</p>
                      {entry.kind === "decision" ? (
                        <small>{entry.teams} teams assigned</small>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="drills-empty">
                  Every event, decision and simulated result will appear here.
                </p>
              )}
              {finished ? (
                <div className="drills-replay">
                  <label>
                    Review recorded interaction
                    <input
                      type="range"
                      min={0}
                      max={run.log.length - 1}
                      value={replayIndex ?? run.log.length - 1}
                      onChange={(event) => setReplayIndex(Number(event.target.value))}
                    />
                  </label>
                  <p role="status">
                    {historyEntry
                      ? `T+${historyEntry.minute}: ${historyEntry.text}`
                      : "Move the slider to inspect the decision record. The 3D view shows the final state."}
                  </p>
                </div>
              ) : null}
            </section>
          </div>
          <section className="drills-learning">
            <div className="drills-section-title">
              <h2>
                <Radio size={19} />
                {finished ? "Lessons learned" : "Carry experience forward"}
              </h2>
              <span>Rule-based review · training only</span>
            </div>
            {finished ? (
              <>
                {previous ? (
                  <p className="drills-comparison">
                    Compared with the preceding drill with the same location, hazard, severity,
                    population and teams:{" "}
                    <strong>
                      {metrics.coverage - drillMetrics(previous).coverage >= 0 ? "+" : ""}
                      {metrics.coverage - drillMetrics(previous).coverage} percentage points
                    </strong>{" "}
                    in assembly-point coverage. Previous run:{" "}
                    {new Date(previous.startedAt).toLocaleString("en-GB")}.
                  </p>
                ) : (
                  <p className="drills-help">
                    This is the baseline for the next matching exercise. Findings come from the
                    recorded actions below.
                  </p>
                )}
                <div className="drills-lesson-grid">
                  {lessons.map((lesson) => (
                    <article key={lesson.id}>
                      <h3>{lesson.title}</h3>
                      <p>{lesson.evidence}</p>
                      <div>
                        <ArrowRight size={15} />
                        <p>{lesson.recommendation}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <label className="drills-notes">
                  Facilitator lesson or observation
                  <textarea
                    maxLength={2000}
                    rows={3}
                    value={run.notes}
                    onChange={(event) => persist({ ...run, notes: event.target.value })}
                    placeholder="What should your team do differently next time?"
                  />
                </label>
                <button
                  type="button"
                  className="drills-primary"
                  onClick={() => {
                    setConfig(run.config);
                    setShowSetup(true);
                    setPlaying(false);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                >
                  Rehearse this scenario again <ArrowRight size={16} />
                </button>
              </>
            ) : priorLessons.length ? (
              <>
                <p className="drills-help">
                  Checklist from the matching exercise on{" "}
                  {previous ? new Date(previous.startedAt).toLocaleString("en-GB") : ""}.
                  Recommendations do not execute actions.
                </p>
                <ul className="drills-checklist">
                  {priorLessons.map((lesson) => (
                    <li key={lesson.id}>
                      <strong>{lesson.recommendation}</strong>
                      <span>{lesson.evidence}</span>
                    </li>
                  ))}
                </ul>
                {previous?.notes ? (
                  <p className="drills-facilitator">
                    <strong>Facilitator observation:</strong> {previous.notes}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="drills-empty">
                Complete your first exercise to build lessons from decisions, blocked routes,
                communication failures and team capacity. Matching future drills will bring those
                lessons into the response desk.
              </p>
            )}
          </section>
        </div>
      </div>
      <section className="drills-history">
        <div className="drills-section-title">
          <h2>Exercise notebook</h2>
          <span>Last 20 completed drills · saved in this browser</span>
        </div>
        {notebook.active && run?.id !== notebook.active.id ? (
          <button
            type="button"
            onClick={() => {
              if (notebook.active) review(notebook.active);
            }}
          >
            Resume unfinished drill in {notebook.active.config.locality}
          </button>
        ) : null}
        {notebook.history.length ? (
          <div className="drills-history-list">
            {notebook.history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => review(item)}
                aria-pressed={run?.id === item.id}
              >
                <span>
                  <strong>{item.config.locality}</strong>
                  <small>
                    {item.config.hazard === "earthquake" ? "Earthquake" : "Wildfire"} /{" "}
                    {item.config.severity}
                  </small>
                </span>
                <span>
                  {drillMetrics(item).coverage}% coverage
                  <small>{new Date(item.startedAt).toLocaleString("en-GB")}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <p className="drills-empty">
            No completed exercises yet. Finish a drill to save its decisions and debrief here.
          </p>
        )}
      </section>
      <footer className="drills-footer">
        Synthetic training model v1. No terrain, structural engineering or fire-spread model.
        Lessons support facilitated practice and do not update the operational coordinator. Export
        reports to keep them beyond this browser.
      </footer>
    </main>
  );
}
