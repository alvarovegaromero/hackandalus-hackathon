"use client";

// Controles del guion que avanza solo: arrancar, parar, reloj y línea de hitos.

import { CircleDot, Play, Square, Wind, Zap } from "lucide-react";
import type { ScenarioState, WorldState } from "@/lib/types";
import { clockLabel, scenarioRuntime } from "./shared";

interface Props {
  scenario: ScenarioState;
  world: WorldState | undefined;
  elapsedSeconds: number;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onSpeed: (speed: number) => void;
}

const speeds = [1, 2, 4];

export default function ScenarioBar({
  scenario,
  world,
  elapsedSeconds,
  busy,
  onStart,
  onStop,
  onSpeed
}: Props) {
  const runtime = scenarioRuntime(scenario);
  const total = Math.max(1, ...scenario.beats.map((beat) => beat.atSeconds));
  const progress = Math.min(100, (elapsedSeconds / total) * 100);
  const pending = scenario.beats.filter((beat) => !scenario.firedBeatIds.includes(beat.id));
  const nextBeat = pending.slice().sort((a, b) => a.atSeconds - b.atSeconds)[0] ?? null;

  return (
    <section className={`scenario-bar ${scenario.running ? "running" : ""}`} aria-label="Control del escenario">
      <div className="scenario-head">
        <div className="scenario-id">
          <span className="eyebrow">Escenario</span>
          <h2>{scenario.name}</h2>
          <p>{scenario.description}</p>
        </div>
        <div className="scenario-controls">
          <div className="scenario-clock" aria-live="off">
            <span className={scenario.running ? "dot live" : "dot"} aria-hidden="true" />
            <strong>{clockLabel(elapsedSeconds)}</strong>
            <small>{scenario.running ? "en marcha" : "parado"}</small>
          </div>
          <button onClick={onStart} disabled={busy || scenario.running} aria-label="Arrancar el escenario">
            <Play size={15} aria-hidden="true" /> Arrancar
          </button>
          <button
            className="danger-light"
            onClick={onStop}
            disabled={busy || !scenario.running}
            aria-label="Parar el escenario"
          >
            <Square size={15} aria-hidden="true" /> Parar
          </button>
          <div className="speed-row" role="group" aria-label="Velocidad del guion">
            {speeds.map((speed) => (
              <button
                key={speed}
                className={runtime?.speed === speed ? "chip active" : "chip"}
                aria-pressed={runtime?.speed === speed}
                aria-label={`Poner el guion a velocidad ${speed}x`}
                disabled={busy}
                onClick={() => onSpeed(speed)}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="scenario-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label="Avance del guion"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      {world ? (
        <div className="world-strip" aria-label="Estado del mundo simulado">
          <span className="pill">
            <Wind size={13} aria-hidden="true" /> Viento {world.windDirection} · {world.windSpeedKmh} km/h
          </span>
          <span className={world.blockedRoads.length > 0 ? "pill zone-active" : "pill"}>
            {world.blockedRoads.length > 0
              ? `Cortadas: ${world.blockedRoads.join(", ")}`
              : "Ninguna carretera cortada"}
          </span>
          <span className={world.smsOperational ? "pill zone-stable" : "pill zone-critical"}>
            SMS {world.smsOperational ? "operativo" : "caído"}
          </span>
          <span className={world.voiceOperational ? "pill zone-stable" : "pill zone-critical"}>
            Voz {world.voiceOperational ? "operativa" : "caída"}
          </span>
        </div>
      ) : null}

      <ol className="beat-rail">
        {scenario.beats.map((beat) => {
          const fired = scenario.firedBeatIds.includes(beat.id);
          const isNext = !fired && nextBeat?.id === beat.id;
          return (
            <li key={beat.id} className={`beat ${fired ? "fired" : ""} ${isNext ? "next" : ""}`}>
              <span className="beat-time">
                {fired ? <Zap size={13} aria-hidden="true" /> : <CircleDot size={13} aria-hidden="true" />}
                {clockLabel(beat.atSeconds)}
              </span>
              <span className="beat-label">{beat.label}</span>
              <span className="beat-state">
                {fired ? "Disparado" : isNext ? "Siguiente" : "Pendiente"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
