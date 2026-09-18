// PROPIETARIO: agente de asignacion de recursos.
// Motor de asignacion. store.ts llama a estas funciones y no toma decisiones
// de recursos por su cuenta.

import type { Action, CrisisZone, Resource } from "./types";

export interface AssignmentDecision {
  resourceId: string;
  reason: string;
}

/**
 * Elige el mejor recurso disponible para una accion, o null si no hay ninguno
 * compatible. Debe tener en cuenta capacidades frente a la necesidad, zona o
 * distancia, capacidad y estado.
 */
export function selectResourceForAction(
  action: Pick<Action, "zoneId" | "objective" | "channel">,
  resources: Resource[],
  zones: CrisisZone[]
): AssignmentDecision | null {
  void zones;
  const candidate = resources.find((resource) => resource.status === "available");
  if (!candidate) return null;
  return {
    resourceId: candidate.id,
    reason: `${candidate.name} esta disponible.`
  };
}

/** Marca el recurso como asignado a la accion. Muta el array recibido. */
export function assignResource(resources: Resource[], resourceId: string, actionId: string, at: string) {
  const resource = resources.find((candidate) => candidate.id === resourceId);
  if (!resource || resource.status === "unavailable") return null;
  resource.status = "assigned";
  resource.assignedActionId = actionId;
  resource.assignedAt = at;
  return resource;
}

/** Libera el recurso ligado a una accion que termina. Muta el array recibido. */
export function releaseResource(resources: Resource[], actionId: string) {
  const resource = resources.find((candidate) => candidate.assignedActionId === actionId);
  if (!resource) return null;
  if (resource.status === "assigned") resource.status = "available";
  resource.assignedActionId = null;
  resource.assignedAt = null;
  return resource;
}

/**
 * Cuando un recurso cae, busca sustituto para las acciones que dependian de el.
 * Devuelve las reasignaciones aplicadas para que el plan pueda explicarlas.
 */
export function reassignAffectedActions(
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
  downResourceId: string
): { actionId: string; fromResourceId: string; toResourceId: string | null; reason: string }[] {
  void actions;
  void resources;
  void zones;
  void downResourceId;
  return [];
}
