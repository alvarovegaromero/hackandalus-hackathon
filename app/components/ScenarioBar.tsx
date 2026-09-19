"use client";

// Controles del guion que avanza solo: arrancar, parar, reloj y línea de hitos.

import { CircleDot, Play, Square, Wind, Zap } from "lucide-react";
import type { ScenarioState, WorldState } from "@/lib/types";
import { clockLabel, scenarioRuntime } from "./shared";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

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
  onSpeed,
}: Props) {
  const runtime = scenarioRuntime(scenario);
  const total = Math.max(1, ...scenario.beats.map((beat) => beat.atSeconds));
  const progress = Math.min(100, (elapsedSeconds / total) * 100);
  const pending = scenario.beats.filter((beat) => !scenario.firedBeatIds.includes(beat.id));
  const nextBeat = pending.slice().sort((a, b) => a.atSeconds - b.atSeconds)[0] ?? null;

  return (
    <section
      className={`scenario-bar ${scenario.running ? "running" : ""}`}
      aria-label="Control del escenario"
    >
      <div className="scenario-head">
        <div className="scenario-id">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5d5d5d]">
            Escenario
          </span>
          <h2 className="text-[16px] font-bold text-[#292929] tracking-[-0.15px]">
            {scenario.name}
          </h2>
          <p className="text-[12px] text-[#5d5d5d]">{scenario.description}</p>
        </div>
        <div className="scenario-controls flex items-center gap-2">
          <div className="scenario-clock flex items-center gap-1.5" aria-live="off">
            <span className={scenario.running ? "dot live" : "dot"} aria-hidden="true" />
            <strong className="text-[13px]">{clockLabel(elapsedSeconds)}</strong>
            <small className="text-[11px] text-[#9e9e9e]">
              {scenario.running ? "en marcha" : "parado"}
            </small>
          </div>
          <Button
            size="sm"
            variant="pill"
            onClick={onStart}
            disabled={busy || scenario.running}
            aria-label="Arrancar el escenario"
          >
            <Play size={13} aria-hidden="true" /> Arrancar
          </Button>
          <Button
            size="sm"
            variant="pillDestructive"
            onClick={onStop}
            disabled={busy || !scenario.running}
            aria-label="Parar el escenario"
          >
            <Square size={13} aria-hidden="true" /> Parar
          </Button>
          <div
            className="speed-row flex items-center gap-1"
            role="group"
            aria-label="Velocidad del guion"
          >
            {speeds.map((speed) => (
              <Button
                key={speed}
                size="sm"
                variant={runtime?.speed === speed ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                aria-pressed={runtime?.speed === speed}
                aria-label={`Poner el guion a velocidad ${speed}x`}
                disabled={busy}
                onClick={() => onSpeed(speed)}
              >
                {speed}x
              </Button>
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
        <div
          className="world-strip flex flex-wrap gap-2 items-center"
          aria-label="Estado del mundo simulado"
        >
          <Badge variant="outline" className="flex items-center gap-1">
            <Wind size={12} aria-hidden="true" /> Viento {world.windDirection} ·{" "}
            {world.windSpeedKmh} km/h
          </Badge>
          <Badge
            variant={world.blockedRoads.length > 0 ? "warning" : "outline"}
            className="flex items-center gap-1"
          >
            <Zap size={12} aria-hidden="true" />{" "}
            {world.blockedRoads.length === 0
              ? "Carreteras despejadas"
              : `Cortada ${world.blockedRoads.join(", ")}`}
          </Badge>
          <Badge
            variant={!world.smsOperational ? "critical" : "outline"}
            className="flex items-center gap-1"
          >
            <CircleDot size={12} aria-hidden="true" /> SMS{" "}
            {world.smsOperational ? "operativo" : "caído"}
          </Badge>
          <Badge
            variant={!world.voiceOperational ? "critical" : "outline"}
            className="flex items-center gap-1"
          >
            <CircleDot size={12} aria-hidden="true" /> Voz{" "}
            {world.voiceOperational ? "operativa" : "caída"}
          </Badge>
          {nextBeat ? (
            <span className="next-beat text-[12px] text-[#5d5d5d]">
              Siguiente cambio a los {clockLabel(nextBeat.atSeconds)}: {nextBeat.label}
            </span>
          ) : (
            <span className="next-beat text-[12px] text-[#5d5d5d]">Guion completado</span>
          )}
        </div>
      ) : null}

      <ol className="beat-rail">
        {scenario.beats.map((beat) => {
          const fired = scenario.firedBeatIds.includes(beat.id);
          const isNext = !fired && nextBeat?.id === beat.id;
          return (
            <li key={beat.id} className={`beat ${fired ? "fired" : ""} ${isNext ? "next" : ""}`}>
              <span className="beat-time">
                {fired ? (
                  <Zap size={13} aria-hidden="true" />
                ) : (
                  <CircleDot size={13} aria-hidden="true" />
                )}
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
