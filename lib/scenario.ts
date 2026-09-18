// PROPIETARIO: agente del escenario que avanza solo.
// Motor del guion: hace que la situacion cambie sin que nadie pulse botones.

import { seedScenarioBeats } from "./seed";
import type { ScenarioBeat, ScenarioState } from "./types";

export function createScenarioState(): ScenarioState {
  return {
    id: "wildfire-andalucia",
    name: "Incendio forestal en Sierra Morena",
    description:
      "El frente avanza, el viento gira, una carretera se corta y un recurso cae mientras el sistema ejecuta acciones.",
    running: false,
    startedAt: null,
    elapsedSeconds: 0,
    beats: seedScenarioBeats,
    firedBeatIds: []
  };
}

export function startScenario(scenario: ScenarioState, at: string): ScenarioState {
  scenario.running = true;
  scenario.startedAt = at;
  scenario.elapsedSeconds = 0;
  scenario.firedBeatIds = [];
  return scenario;
}

export function stopScenario(scenario: ScenarioState): ScenarioState {
  scenario.running = false;
  return scenario;
}

/**
 * Devuelve los beats que deben dispararse en este instante y los marca como
 * disparados. store.ts se encarga de aplicarlos.
 */
export function dueBeats(scenario: ScenarioState, nowMs: number): ScenarioBeat[] {
  if (!scenario.running || !scenario.startedAt) return [];
  const elapsed = (nowMs - new Date(scenario.startedAt).getTime()) / 1000;
  scenario.elapsedSeconds = Math.max(0, Math.round(elapsed));

  const due = scenario.beats.filter(
    (beat) => beat.atSeconds <= elapsed && !scenario.firedBeatIds.includes(beat.id)
  );
  for (const beat of due) scenario.firedBeatIds.push(beat.id);
  if (scenario.firedBeatIds.length >= scenario.beats.length) scenario.running = false;
  return due;
}
