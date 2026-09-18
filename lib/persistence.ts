// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
// Persistencia en fichero JSON, sin dependencias nativas. store.ts llama a
// estas funciones; deben ser seguras si el fichero no existe o esta corrupto.

import type { LearnedWeights, RunRecord, SituationState } from "./types";

export const DATA_DIR = ".data";

/** true si la persistencia esta activada por configuracion. */
export function isPersistenceEnabled(): boolean {
  return process.env.CRISIS_PERSISTENCE === "on";
}

/** Carga el estado guardado, o null si no hay nada utilizable. */
export function loadState(): SituationState | null {
  return null;
}

/** Guarda el estado. Nunca debe lanzar: un fallo de disco no puede tumbar la demo. */
export function saveState(state: SituationState): void {
  void state;
}

/** Historial de ejecuciones anteriores, para el bonus de aprendizaje. */
export function loadRuns(): RunRecord[] {
  return [];
}

export function saveRun(run: RunRecord): void {
  void run;
}

export function loadWeights(): LearnedWeights | null {
  return null;
}

export function saveWeights(weights: LearnedWeights): void {
  void weights;
}
