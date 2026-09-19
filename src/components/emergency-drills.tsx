"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
} from "lucide-react";
import DrillTwin from "./drill-twin";
import DrillScenarioFields from "./drill-scenario-fields";
import DrillLearningExports from "./drill-learning-exports";
import { drillLearningReport } from "@/lib/drill-learning";
import { reviewedDrillBriefing } from "@/lib/drill-agent-context";
import {
  ACTIONS,
  actionIds,
  actionUnavailable,
  advanceDrill,
  applyDrillAction,
  comparableDrills,
  createDrill,
  DEFAULT_WILDFIRE_DRILL,
  drillConfigSchema,
  drillLessons,
  drillMetrics,
  formatDrillTime,
  replayDrill,
  tickDrill,
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
    new Blob([JSON.stringify(drillLearningReport(run), null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `faro-drill-${run.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EmergencyDrills() {
  const [config, setConfig] = useState<DrillConfig>(DEFAULT_WILDFIRE_DRILL);
  const [notebook, setNotebook] = useState<DrillNotebook>(EMPTY_NOTEBOOK);
  const [run, setRun] = useState<DrillRun | null>(null);
  const [selected, setSelected] = useState<SectorId>("care");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [replayMinute, setReplayMinute] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replaceActive, setReplaceActive] = useState(false);
  const replayRunning = replayPlaying && (replayMinute ?? 0) < 20;
  const notebookRef = useRef(notebook);
  const runRef = useRef(run);
  const storageBlockedRef = useRef(false);
  const runHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Storage is loaded after hydration; the server never reads browser data.
    const load = () => {
      try {
        const saved = readDrillNotebook(localStorage.getItem(DRILL_STORAGE_KEY));
        const active = saved.active?.config.hazard === "wildfire" ? saved.active : null;
        notebookRef.current = saved;
        runRef.current = active;
        setNotebook(saved);
        setRun(active);
        if (active) {
          setConfig(active.config);
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
      setReplayPlaying(false);
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
      const next = tickDrill(current, 0.125 * speed, new Date().toISOString());
      persist(next);
      if (next.status === "completed") setPlaying(false);
    }, 500);
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [playing, speed]);

  useEffect(() => {
    if (!replayRunning) return;
    const timer = window.setInterval(() => {
      setReplayMinute((minute) => Math.min(20, (minute ?? 0) + 0.125 * speed));
    }, 500);
    const pauseWhenHidden = () => {
      if (document.hidden) setReplayPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [replayRunning, speed]);

  const preview = useMemo(
    () =>
      createDrill(
        drillConfigSchema.safeParse(config).success ? config : DEFAULT_WILDFIRE_DRILL,
        "00000000-0000-4000-8000-000000000000",
        "2026-01-01T00:00:00.000Z",
      ),
    [config],
  );
  const wildfireHistory = notebook.history.filter((item) => item.config.hazard === "wildfire");
  const replayState = useMemo(
    () =>
      run && replayMinute !== null
        ? replayDrill(run, replayMinute, !showBaseline, replayIndex ?? Infinity)
        : null,
    [run, replayMinute, replayIndex, showBaseline],
  );
  const baseline = useMemo(
    () =>
      run?.status === "completed" && run.modelVersion >= 2 ? replayDrill(run, 20, false) : null,
    [run],
  );
  const displayed = replayState ?? run ?? preview;
  const metrics = drillMetrics(displayed);
  const outcome = drillMetrics(run ?? preview);
  const previous = comparableDrills(
    run?.config ?? config,
    notebook.history,
    run?.modelVersion ?? 3,
  ).find((item) => !run || item.startedAt < run.startedAt);
  const previousMetrics = previous ? drillMetrics(previous) : null;
  const preparation = useMemo(
    () => reviewedDrillBriefing(config, notebook.history),
    [config, notebook.history],
  );
  const briefingConfig = run?.config ?? config;
  const briefingRunId = run?.id;
  const briefingStartedAt = run?.startedAt;
  const briefingModel = run?.modelVersion;
  const priorBriefing = useMemo(
    () =>
      reviewedDrillBriefing(
        briefingConfig,
        notebook.history,
        briefingRunId && briefingStartedAt && briefingModel
          ? { id: briefingRunId, startedAt: briefingStartedAt, modelVersion: briefingModel }
          : undefined,
      ),
    [briefingConfig, briefingRunId, briefingStartedAt, briefingModel, notebook.history],
  );
  const priorLessons = priorBriefing.records;
  const sector = displayed.sectors.find((item) => item.id === selected)!;
  const finished = run?.status === "completed";
  const lessons = useMemo(() => (run?.status === "completed" ? drillLessons(run) : []), [run]);
  const lastEvent = displayed.log.filter((entry) => entry.kind === "event").at(-1);
  const historyEntry = replayIndex === null ? null : run?.log[replayIndex];
  const beforeDecision = useMemo(
    () =>
      run && replayIndex !== null && run.log[replayIndex]?.kind === "decision"
        ? replayDrill(run, run.log[replayIndex].minute, true, replayIndex - 1)
        : null,
    [run, replayIndex],
  );
  const beforeMetrics = beforeDecision ? drillMetrics(beforeDecision) : null;
  const reviewedRisk = beforeDecision?.sectors.find(
    (item) => item.id === historyEntry?.sectorId,
  )?.risk;

  function startDrill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = drillConfigSchema.safeParse({ ...config, hazard: "wildfire" });
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
    setReplayPlaying(false);
    setReplayMinute(null);
    setShowBaseline(false);
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
    setReplayMinute(null);
    setReplayPlaying(false);
    setShowBaseline(false);
  }

  function step() {
    const current = runRef.current;
    if (!current) return;
    setError(null);
    const next = advanceDrill(current, new Date().toISOString());
    persist(next);
    if (next.status === "completed") setPlaying(false);
  }

  function inspectDecision(index: number) {
    if (!run || run.status !== "completed") return;
    setReplayPlaying(false);
    setReplayIndex(index);
    setReplayMinute(run.log[index].minute);
    const sectorId = run.log[index].sectorId;
    if (sectorId) setSelected(sectorId);
    setShowBaseline(false);
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
          <h1>Wildfire drills</h1>
          <p>
            Rehearse the fire response. Review decisions. Bring approved lessons into the next run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowSetup(!showSetup);
            setPlaying(false);
            setReplayPlaying(false);
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
              <p className="drills-help">
                <Flame size={18} aria-hidden="true" /> Wildfire · evacuation, access and radio
                fallback
              </p>
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
              <DrillScenarioFields
                value={config.scenario}
                onChange={(scenario) => setConfig({ ...config, scenario })}
              />
              <p className="drills-help">
                Starts paused so you can plan. 20 simulated minutes in 80 seconds at 1×. Teams
                return after service completion or evacuation arrival. Keep capacity available to
                reopen blocked access.
              </p>
              {notebook.active ? (
                <>
                  <button
                    type="button"
                    onClick={() => notebook.active && exportReport(notebook.active)}
                  >
                    Export unfinished exercise
                  </button>
                  <label className="drills-confirm">
                    <input
                      type="checkbox"
                      checked={replaceActive}
                      onChange={(event) => setReplaceActive(event.target.checked)}
                    />
                    Replace the unfinished exercise. Export it first if needed.
                  </label>
                </>
              ) : null}
              <button type="submit" className="drills-primary" disabled={!ready}>
                <Play size={16} />
                {notebook.active ? "Replace & prepare wildfire" : "Prepare wildfire"}
              </button>
            </form>
            <div className="drills-briefing">
              <h3>Approved lessons for this wildfire</h3>
              <p>
                Same configuration, seed and model. Reviewed reference data; you choose the actions.
              </p>
              {preparation.records.length ? (
                <ul className="drills-checklist">
                  {preparation.records.map((lesson) => (
                    <li key={lesson.lessonId}>
                      <strong>{lesson.proposal}</strong>
                      <span>{lesson.fact}</span>
                      <small>Source exercise: {lesson.sourceRunId}</small>
                      <button
                        type="button"
                        onClick={() => {
                          const source = notebook.history.find(
                            (item) => item.id === lesson.sourceRunId,
                          );
                          if (source) review(source);
                        }}
                      >
                        Review source exercise
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No approved lessons for this configuration yet. Complete a wildfire and review its
                  evidence, then choose “Rehearse this scenario again”. Unreviewed and rejected
                  lessons are excluded.
                </p>
              )}
              {preparation.skippedRunIds.length ? (
                <p role="status">Some saved exercises failed the replay audit and were excluded.</p>
              ) : null}
            </div>
          </aside>
        ) : null}
        <div className="drills-main">
          <section className="drills-run-bar" aria-label="Exercise controls">
            <div>
              <h2 ref={runHeadingRef} tabIndex={-1}>
                {run ? `${run.config.locality} / Wildfire` : "Your rehearsal starts here"}
              </h2>
              <p role="status">
                {run
                  ? `${PHASE_NAMES[displayed.phase]} · ${finished ? (replayMinute === null ? "Completed — explore the debrief" : "Replaying recorded state") : playing ? `Running at ${speed}× speed` : "Paused — decide or resume"}`
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
                {playing ? "Pause" : "Run simulation"}
              </button>
              <label className="drills-speed">
                Speed
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <button type="button" disabled={!run || finished} onClick={step}>
                <StepForward size={16} />
                {run?.phase === 3 ? "Finish & debrief" : "Next phase"}
              </button>
              <button
                type="button"
                disabled={!run}
                onClick={() => {
                  try {
                    if (run) exportReport(run);
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : "Export failed.");
                  }
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
              <span>On evacuation routes</span>
              <strong>
                {run ? metrics.inTransit : "—"}
                <small> / {metrics.remaining} outside assembly</small>
              </strong>
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
          <DrillTwin
            key={(run ?? preview).id}
            run={displayed}
            selected={selected}
            onSelect={setSelected}
            playing={playing || (replayPlaying && (replayMinute ?? 0) < 20)}
            replay={replayMinute !== null}
          />
          {finished ? (
            <section className="drills-playback" aria-label="3D replay">
              <div className="drills-playback-heading">
                <div>
                  <h2>Replay the decisions</h2>
                  <p>The 3D scene, routes and counters follow the recorded simulation.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplayIndex(null);
                    if (replayMinute === null || replayMinute >= 20) setReplayMinute(0);
                    setReplayPlaying(!(replayPlaying && (replayMinute ?? 0) < 20));
                  }}
                >
                  {replayPlaying && (replayMinute ?? 0) < 20 ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  {replayPlaying && (replayMinute ?? 0) < 20 ? "Pause replay" : "Play 3D replay"}
                </button>
              </div>
              <label className="drills-scrubber">
                <span>
                  Simulation time <strong>{formatDrillTime(replayMinute ?? 20)}</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={0.125}
                  value={replayMinute ?? 20}
                  onChange={(event) => {
                    setReplayPlaying(false);
                    setReplayIndex(null);
                    setReplayMinute(Number(event.target.value));
                  }}
                />
              </label>
              <div className="drills-phase-marks">
                <span>00:00 Impact</span>
                <span>05:00 Road closure</span>
                <span>10:00 Network loss</span>
                <span>15:00 Escalation</span>
                <span>20:00 Debrief</span>
              </div>
              <div className="drills-playback-options">
                {baseline ? (
                  <button
                    type="button"
                    aria-pressed={showBaseline}
                    onClick={() => {
                      setShowBaseline(!showBaseline);
                      setReplayIndex(null);
                      setReplayMinute(replayMinute ?? 20);
                    }}
                  >
                    {showBaseline ? "Show my decisions" : "Compare without intervention"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setReplayMinute(null);
                    setReplayPlaying(false);
                    setReplayIndex(null);
                    setShowBaseline(false);
                  }}
                >
                  Return to final result
                </button>
                <span role="status">
                  {showBaseline
                    ? "Counterfactual model: no operator decisions"
                    : historyEntry
                      ? historyEntry.text
                      : "Recorded decisions applied in chronological order"}
                </span>
              </div>
              {beforeDecision && beforeMetrics && historyEntry ? (
                <div className="drills-decision-evidence">
                  <strong>Immediate effect of this decision</strong>
                  <span>
                    Teams available: {beforeDecision.teamsAvailable} → {displayed.teamsAvailable}
                  </span>
                  <span>
                    People traveling: {beforeMetrics.inTransit} → {metrics.inTransit}
                  </span>
                  <span>
                    Access: {beforeDecision.routeOpen ? "open" : "blocked"} →{" "}
                    {displayed.routeOpen ? "open" : "blocked"}
                  </span>
                  <span>
                    Sector risk: {reviewedRisk} →{" "}
                    {displayed.sectors.find((item) => item.id === historyEntry.sectorId)?.risk}
                  </span>
                  <span>
                    Community briefed: {beforeDecision.warned ? "yes" : "no"} →{" "}
                    {displayed.warned ? "yes" : "no"}
                  </span>
                  <p>
                    Play forward to see arrivals and later hazards. Evacuation orders count as
                    completed only when people reach the assembly point.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="drills-response-grid">
            <section className="drills-response">
              <div className="drills-section-title">
                <h2>
                  {finished
                    ? replayMinute === null
                      ? "Exercise outcome"
                      : "State at replay time"
                    : "Response desk"}
                </h2>
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
                  {actionIds
                    .filter((action) => action !== "assess")
                    .map((action) => {
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
                      <span>T+{formatDrillTime(entry.minute)}</span>
                      <p>{entry.text}</p>
                      {entry.kind === "decision" ? (
                        <small>{entry.teams} teams assigned</small>
                      ) : null}
                      {finished ? (
                        <button
                          className="drills-inspect-decision"
                          type="button"
                          onClick={() => inspectDecision(index)}
                          aria-label={`View in 3D: ${entry.text}`}
                        >
                          View in 3D <ArrowRight size={12} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="drills-empty">
                  Every event, decision and simulated result will appear here.
                </p>
              )}
            </section>
          </div>
          {run ? <DrillLearningExports key={`learning-${run.id}`} run={run} /> : null}
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
                {baseline ? (
                  <div className="drills-impact-review">
                    <div>
                      <span>Reached safety</span>
                      <strong>
                        {outcome.evacuated}
                        <small> people</small>
                      </strong>
                      <p>{outcome.inTransit} still on a route at the end</p>
                    </div>
                    <div>
                      <span>Modeled exposure reduced</span>
                      <strong>
                        {Math.max(
                          0,
                          Math.round((1 - run.exposure / Math.max(1, baseline.exposure)) * 100),
                        )}
                        <small>%</small>
                      </strong>
                      <p>Against the same scenario without intervention</p>
                    </div>
                    <div>
                      <span>Decisions to review</span>
                      <strong>{outcome.decisions}</strong>
                      <p>Select a timeline entry to inspect its 3D state</p>
                    </div>
                    <p className="drills-impact-caveat">
                      Exposure sums people waiting in sectors × exercise risk × time. This
                      comparison explains the training rules; it does not predict casualties or
                      prove real-world effectiveness.
                    </p>
                  </div>
                ) : null}
                {previous && previousMetrics ? (
                  <>
                    <p className="drills-comparison">
                      Compared with the preceding drill with the same configuration, seed and model:{" "}
                      <strong>
                        {outcome.coverage - previousMetrics.coverage >= 0 ? "+" : ""}
                        {outcome.coverage - previousMetrics.coverage} percentage points
                      </strong>{" "}
                      in assembly-point coverage. Previous run:{" "}
                      {new Date(previous.startedAt).toLocaleString("en-GB")}.
                    </p>
                    <div className="drill-table-wrap">
                      <table>
                        <caption>Previous exercise versus this rehearsal</caption>
                        <thead>
                          <tr>
                            <th scope="col">Metric</th>
                            <th scope="col">Previous</th>
                            <th scope="col">This run</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th scope="row">People at assembly point</th>
                            <td>{previousMetrics.evacuated}</td>
                            <td>{outcome.evacuated}</td>
                          </tr>
                          <tr>
                            <th scope="row">People still in transit</th>
                            <td>{previousMetrics.inTransit}</td>
                            <td>{outcome.inTransit}</td>
                          </tr>
                          <tr>
                            <th scope="row">Waiting exposure</th>
                            <td>{previousMetrics.exposure}</td>
                            <td>{outcome.exposure}</td>
                          </tr>
                          <tr>
                            <th scope="row">Occupied team-minutes</th>
                            <td>{previous.teamBusyMinutes?.toFixed(2) ?? "Not recorded"}</td>
                            <td>{run.teamBusyMinutes?.toFixed(2) ?? "Not recorded"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="drills-help">
                      Compare all outcomes together. Different decisions and repeated practice can
                      affect the result; this does not isolate the effect of the checklist.
                    </p>
                  </>
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
                      {run.modelVersion === 3 ? (
                        <label>
                          Review for future drills and offline context
                          <select
                            aria-label={`Review: ${lesson.title}`}
                            value={
                              run.learningReview?.find((review) => review.lessonId === lesson.id)
                                ?.verdict ?? "unreviewed"
                            }
                            onChange={(event) => {
                              const verdict = event.target.value;
                              const reviews = (run.learningReview ?? []).filter(
                                (review) => review.lessonId !== lesson.id,
                              );
                              persist({
                                ...run,
                                learningReview:
                                  verdict === "approved" || verdict === "rejected"
                                    ? [
                                        ...reviews,
                                        {
                                          lessonId: lesson.id,
                                          verdict,
                                          reviewedAt: new Date().toISOString(),
                                          reviewer: "local-facilitator",
                                        },
                                      ]
                                    : reviews,
                              });
                            }}
                          >
                            <option value="unreviewed">Unreviewed</option>
                            <option value="approved">Approve this lesson</option>
                            <option value="rejected">Reject this lesson</option>
                          </select>
                        </label>
                      ) : null}
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
                    setReplayPlaying(false);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                >
                  Rehearse this scenario again <ArrowRight size={16} />
                </button>
              </>
            ) : priorLessons.length ? (
              <>
                <p className="drills-help">
                  Approved lessons from earlier matching wildfires. Recommendations do not execute
                  actions.
                </p>
                <ul className="drills-checklist">
                  {priorLessons.map((lesson) => (
                    <li key={lesson.lessonId}>
                      <strong>{lesson.proposal}</strong>
                      <span>{lesson.fact}</span>
                      <small>Source exercise: {lesson.sourceRunId}</small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="drills-empty">
                Complete and review a wildfire to build this checklist. Only approved lessons from
                earlier exercises with the same configuration, seed and model appear here.
              </p>
            )}
            {priorBriefing.skippedRunIds.length ? (
              <p role="status">Some saved exercises failed the replay audit and were excluded.</p>
            ) : null}
          </section>
        </div>
      </div>
      <section className="drills-history">
        <div className="drills-section-title">
          <h2>Wildfire notebook</h2>
          <span>Recent completed wildfires · saved in this browser</span>
        </div>
        {notebook.active?.config.hazard === "wildfire" && run?.id !== notebook.active.id ? (
          <button
            type="button"
            onClick={() => {
              if (notebook.active) review(notebook.active);
            }}
          >
            Resume unfinished drill in {notebook.active.config.locality}
          </button>
        ) : null}
        {wildfireHistory.length ? (
          <div className="drills-history-list">
            {wildfireHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => review(item)}
                aria-pressed={run?.id === item.id}
              >
                <span>
                  <strong>{item.config.locality}</strong>
                  <small>Wildfire / {item.config.severity}</small>
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
        Synthetic training model v{run?.modelVersion ?? 3}. Visual effects illustrate the exercise;
        no surveyed terrain or fire-spread physics. Lessons support facilitated practice and do not
        update the operational coordinator. Export reports to keep them beyond this browser.
      </footer>
    </main>
  );
}
