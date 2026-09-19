"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Compass, Map, Orbit, ZoomIn, ZoomOut } from "lucide-react";
import {
  drillMetrics,
  drillMinute,
  formatDrillTime,
  type DrillRun,
  type SectorId,
} from "@/lib/emergency-drills";
import type { CameraView, DrillScene } from "./drill-scene";

interface TwinProps {
  run: DrillRun;
  selected: SectorId;
  onSelect: (id: SectorId) => void;
  playing?: boolean;
  replay?: boolean;
}

export default function DrillTwin({
  run,
  selected,
  onSelect,
  playing = false,
  replay = false,
}: TwinProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<DrillScene | null>(null);
  const state = useRef({ run, selected, playing, onSelect, reduced: false });
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [view, setView] = useState<CameraView>("overview");
  const [orbit, setOrbit] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [table, setTable] = useState(false);
  const metrics = drillMetrics(run);

  useEffect(() => {
    state.current = { run, selected, playing, onSelect, reduced };
    scene.current?.update(run, selected, playing, reduced);
  }, [run, selected, playing, onSelect, reduced]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    let cancelled = false;
    let instance: DrillScene | null = null;
    import("./drill-scene")
      .then(({ createDrillScene }) => {
        if (cancelled || !host.current) return;
        instance = createDrillScene(
          host.current,
          state.current.run,
          (sector) => state.current.onSelect(sector),
          () => setStatus("unavailable"),
        );
        scene.current = instance;
        const current = state.current;
        instance.update(current.run, current.selected, current.playing, current.reduced);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      media.removeEventListener("change", change);
      instance?.dispose();
      scene.current = null;
    };
  }, []);

  function camera(mode: CameraView) {
    setView(mode);
    scene.current?.view(mode);
  }

  return (
    <section className="drill-twin-panel drill-twin-webgl" aria-labelledby="twin-heading">
      <div className="drill-twin-heading">
        <div>
          <h2 id="twin-heading">
            {run.config.locality} <span>/ Digital twin</span>
          </h2>
          <p>
            {run.config.latitude.toFixed(4)}, {run.config.longitude.toFixed(4)} · Synthetic training
            city
          </p>
        </div>
        <span className={`drill-twin-badge${playing ? " is-running" : ""}`}>
          <span aria-hidden="true" />{" "}
          {replay ? "Recorded replay" : playing ? "Simulation running" : "Simulation paused"}
        </span>
      </div>
      <div className="drill-cinema">
        <div ref={host} className="drill-webgl-canvas" />
        {status !== "ready" ? (
          <div className="drill-render-message" role="status">
            <Box size={38} />
            <strong>
              {status === "loading"
                ? "Building your training city…"
                : "3D rendering is unavailable"}
            </strong>
            <p>
              {status === "loading"
                ? "Preparing terrain, buildings and response routes."
                : "Enable WebGL and reload for the 3D view. The simulation, controls and sector table remain available below."}
            </p>
          </div>
        ) : null}
        <div className="drill-cinema-hud">
          <span>
            {run.config.hazard === "earthquake" ? "Earthquake response" : "Wildfire response"}
          </span>
          <strong>
            {formatDrillTime(drillMinute(run))}
            <small> / 20:00</small>
          </strong>
          <p>{run.config.severity} intensity</p>
        </div>
        <div className="drill-cinema-status">
          <span className={run.routeOpen ? "" : "is-blocked"}>
            {run.routeOpen ? "Route available" : "Route blocked"}
          </span>
          <span>{metrics.inTransit} people in transit</span>
          <span>{metrics.evacuated} at assembly point</span>
        </div>
        <div className="drill-camera-controls" aria-label="3D camera controls">
          <button
            type="button"
            disabled={status !== "ready"}
            aria-pressed={view === "overview"}
            onClick={() => camera("overview")}
          >
            <Box size={15} /> Overview
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            aria-pressed={view === "street"}
            onClick={() => camera("street")}
          >
            <Compass size={15} /> Street
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            aria-pressed={view === "top"}
            onClick={() => camera("top")}
          >
            <Map size={15} /> Plan
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            aria-label="Zoom in"
            onClick={() => scene.current?.zoom(1)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            aria-label="Zoom out"
            onClick={() => scene.current?.zoom(-1)}
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            disabled={status !== "ready" || reduced}
            aria-label="Orbit camera automatically"
            aria-pressed={orbit}
            onClick={() => {
              setOrbit(!orbit);
              scene.current?.setOrbit(!orbit);
            }}
          >
            <Orbit size={16} />
          </button>
        </div>
        <div className="drill-cinema-legend">
          <span>
            <i className="drill-key-person" /> Residents
          </span>
          <span>
            <i className="drill-key-team" /> Response teams
          </span>
          <span>
            <i className="drill-key-safe" /> Assembly point
          </span>
          <span className="drill-drag-hint">Drag to orbit · Scroll to zoom</span>
        </div>
      </div>
      <div className="drill-sector-tabs" aria-label="Select a training sector">
        {run.sectors.map((sector, index) => (
          <button
            key={sector.id}
            type="button"
            aria-pressed={selected === sector.id}
            onClick={() => onSelect(sector.id)}
          >
            <span className="drill-sector-letter">{String.fromCharCode(65 + index)}</span>
            <span>
              {sector.name}
              <small>
                {sector.population - sector.evacuated} outside assembly · Risk {sector.risk}/100
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="drill-twin-footer">
        <p>
          Procedural geography. People markers represent groups; their paths follow the simulation
          state. No surveyed terrain or physical hazard prediction.
        </p>
        <button
          type="button"
          aria-expanded={table || status === "unavailable"}
          onClick={() => setTable(!table)}
        >
          {table ? "Hide" : "View"} sector table
        </button>
      </div>
      {table || status === "unavailable" ? (
        <div className="drill-table-wrap">
          <table>
            <caption className="sr-only">Training twin sector state</caption>
            <thead>
              <tr>
                <th scope="col">Sector</th>
                <th scope="col">At assembly point</th>
                <th scope="col">Risk / 100</th>
                <th scope="col">Assessment</th>
                <th scope="col">Perimeter</th>
              </tr>
            </thead>
            <tbody>
              {run.sectors.map((sector) => (
                <tr key={sector.id}>
                  <th scope="row">{sector.name}</th>
                  <td>
                    {sector.evacuated} / {sector.population}
                  </td>
                  <td>{sector.risk}</td>
                  <td>{sector.assessed ? "Assessed" : "Unverified"}</td>
                  <td>{sector.protected ? "Secured" : "Not secured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
