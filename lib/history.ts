// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
// Historial de planes y registro de auditoria.

import type { AuditEntry, Actor, Plan, PlanChange } from "./types";

export const MAX_PLAN_HISTORY = 40;
export const MAX_AUDIT_ENTRIES = 200;

/** Calcula que cambio entre dos versiones del plan. */
export function diffPlans(previous: Plan | null, next: Plan): PlanChange[] {
  if (!previous) return [];
  const changes: PlanChange[] = [];
  const previousRank = new Map(previous.priorities.map((priority, index) => [priority.zoneId, index]));

  next.priorities.forEach((priority, index) => {
    const before = previousRank.get(priority.zoneId);
    if (before === undefined || before === index) return;
    changes.push({
      kind: before > index ? "priority-up" : "priority-down",
      label: priority.zoneId,
      detail: `Pasa del puesto ${before + 1} al ${index + 1}.`
    });
  });

  return changes;
}

/** Guarda la version anterior del plan, recortando el historial. */
export function pushPlanHistory(history: Plan[], plan: Plan): Plan[] {
  return [plan, ...history].slice(0, MAX_PLAN_HISTORY);
}

export function appendAudit(
  audit: AuditEntry[],
  entry: { id: string; at: string; actor: Actor; kind: string; summary: string; planVersion: number; ref?: string }
): AuditEntry[] {
  return [entry, ...audit].slice(0, MAX_AUDIT_ENTRIES);
}
