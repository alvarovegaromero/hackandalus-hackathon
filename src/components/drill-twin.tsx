"use client";

import { useState, type CSSProperties } from "react";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { DrillRun, SectorId } from "@/lib/emergency-drills";

interface TwinProps {
  run: DrillRun;
  selected: SectorId;
  onSelect: (id: SectorId) => void;
}

const sites = [
  { id: "residential", x: 28, y: 34, marker: "A" },
  { id: "care", x: 292, y: 35, marker: "B" },
  { id: "central", x: 160, y: 210, marker: "C" },
] as const;

function Building({
  x,
  y,
  height,
  width = 28,
  depth = 26,
  special = false,
}: {
  x: number;
  y: number;
  height: number;
  width?: number;
  depth?: number;
  special?: boolean;
}) {
  const style = {
    "--height": `${height}px`,
    "--width": `${width}px`,
    "--depth": `${depth}px`,
    transform: `translate3d(${x}px, ${y}px, 0)`,
  } as CSSProperties;
  return (
    <div className={`drill-building${special ? " drill-building-special" : ""}`} style={style}>
      <span className="drill-roof" />
      <span className="drill-wall drill-wall-north" />
      <span className="drill-wall drill-wall-south" />
      <span className="drill-wall drill-wall-east" />
      <span className="drill-wall drill-wall-west" />
    </div>
  );
}

export default function DrillTwin({ run, selected, onSelect }: TwinProps) {
  const [rotation, setRotation] = useState(-28);
  const [zoom, setZoom] = useState(1);
  const [table, setTable] = useState(false);
  const coordinateSeed = Math.abs(
    Math.round(run.config.latitude * 100 + run.config.longitude * 100),
  );

  return (
    <section className="drill-twin-panel" aria-labelledby="twin-heading">
      <div className="drill-twin-heading">
        <div>
          <h2 id="twin-heading">3D training twin</h2>
          <p>
            {run.config.locality} <span aria-hidden="true">/</span> {run.config.latitude.toFixed(4)}
            , {run.config.longitude.toFixed(4)}
          </p>
        </div>
        <span className="drill-twin-badge">Schematic geography</span>
      </div>
      <div className="drill-viewport">
        <div className="drill-scene-status">
          <span>{run.config.hazard === "earthquake" ? "Seismic impact" : "Wildfire front"}</span>
          <strong>T+{String(run.phase * 5).padStart(2, "0")} min</strong>
        </div>
        <div className="drill-world-anchor">
          <div
            className="drill-world"
            style={{ transform: `rotateX(55deg) rotateZ(${rotation}deg) scale(${zoom})` }}
          >
            <div className="drill-ground" />
            <div className="drill-road drill-road-main" />
            <div className="drill-road drill-road-cross" />
            {!run.routeOpen ? (
              <div className="drill-road-closure" title="Main access blocked">
                ×
              </div>
            ) : null}
            <div
              className={`drill-hazard drill-hazard-${run.config.hazard}`}
              style={{ opacity: 0.35 + run.phase * 0.12 }}
            />
            {sites.map((site, index) => {
              const sector = run.sectors.find((item) => item.id === site.id)!;
              return (
                <div
                  key={site.id}
                  className="drill-sector-model"
                  style={{ transform: `translate3d(${site.x}px, ${site.y}px, 1px)` }}
                >
                  <button
                    className={`drill-sector-footprint${selected === site.id ? " is-selected" : ""}${sector.protected ? " is-protected" : ""}`}
                    onClick={() => onSelect(site.id)}
                    aria-label={`Select ${sector.name}, exercise risk ${sector.risk} of 100`}
                    aria-pressed={selected === site.id}
                    type="button"
                  >
                    <span>{site.marker}</span>
                  </button>
                  {[0, 1, 2, 3].map((building) => (
                    <Building
                      key={building}
                      x={12 + (building % 2) * 50}
                      y={12 + Math.floor(building / 2) * 48}
                      height={20 + ((coordinateSeed + building * 13 + index * 7) % 33)}
                      width={site.id === "care" ? 34 : 28}
                      special={site.id === "care"}
                    />
                  ))}
                </div>
              );
            })}
            <div className="drill-assembly">
              Assembly
              <br />
              point
            </div>
            {[0, 1, 2, 3, 4, 5].map((tree) => (
              <div
                key={tree}
                className="drill-tree"
                style={{ transform: `translate3d(${26 + tree * 15}px, 266px, 14px)` }}
              />
            ))}
          </div>
        </div>
        <div className="drill-compass" aria-hidden="true">
          N <span>↑</span>
        </div>
        <div className="drill-camera-controls" aria-label="3D view controls">
          <button
            type="button"
            aria-label="Rotate left"
            onClick={() => setRotation((value) => value - 20)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            aria-label="Rotate right"
            onClick={() => setRotation((value) => value + 20)}
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 0.7}
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= 1.3}
            onClick={() => setZoom((value) => Math.min(1.3, value + 0.15))}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setRotation(-28);
              setZoom(1);
            }}
          >
            Reset view
          </button>
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
            <span className="drill-sector-letter">{sites[index].marker}</span>
            <span>
              {sector.name}
              <small>{sector.population - sector.evacuated} awaiting assistance</small>
            </span>
          </button>
        ))}
      </div>
      <div className="drill-twin-footer">
        <p>
          Synthetic buildings and sectors. Coordinates anchor the exercise, not a surveyed city
          model.
        </p>
        <button type="button" aria-expanded={table} onClick={() => setTable(!table)}>
          {table ? "Hide" : "View"} sector table
        </button>
      </div>
      {table ? (
        <div className="drill-table-wrap">
          <table>
            <caption className="sr-only">Training twin sector state</caption>
            <thead>
              <tr>
                <th scope="col">Sector</th>
                <th scope="col">At assembly point</th>
                <th scope="col">Exercise risk / 100</th>
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
