// OWNER: persistence, history, audit, and learning agent.
//
// Plan history and audit log. Answers the supervision question
// from the challenge: "is it clear what the system is doing?".
//
// `diffPlans` translates two plan versions into a list of changes in
// plain language. Text goes directly to the UI, so it is written
// for an emergency manager to understand without technical context:
// "Sierra Morena overtakes Seville Hub" rather than "zone-north: 2 -> 1".

import { seedZones } from "./seed";
import type {
  Action,
  ActionChannel,
  Actor,
  AuditEntry,
  CrisisZone,
  IntegrationState,
  Plan,
  PlanChange,
  PlanChangeKind,
  Resource,
  ZoneStatus,
} from "./types";

export const MAX_PLAN_HISTORY = 40;
export const MAX_AUDIT_ENTRIES = 200;

/** Maximum changes shown; the rest is excess for quick decision-making. */
export const MAX_PLAN_CHANGES = 12;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const zoneStatusLabel: Record<ZoneStatus, string> = {
  stable: "estable",
  watch: "en vigilancia",
  active: "activa",
  critical: "crítica",
};

/** Relative severity of each status, to know whether the zone worsens or improves. */
const zoneStatusRank: Record<ZoneStatus, number> = {
  stable: 0,
  watch: 1,
  active: 2,
  critical: 3,
};

const channelLabel: Record<ActionChannel, string> = {
  call: "Llamada",
  sms: "SMS",
  email: "Correo",
  ticket: "Ticket",
  webhook: "Webhook",
  whatsapp: "WhatsApp",
  slack: "Slack",
};

/** Importance order used to trim changes displayed on screen. */
const kindRank: Record<PlanChangeKind, number> = {
  integration: 0,
  "zone-status": 1,
  "action-invalidated": 2,
  "priority-up": 3,
  "priority-down": 4,
  "resource-reassigned": 5,
  "action-added": 6,
};

/** Joins names in natural language: "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Optional diff context
// ---------------------------------------------------------------------------

/**
 * A `Plan` only knows zones by ID and actions by ID. With this context,
 * text moves from "zone-north" to "Sierra Morena" and can detect changes
 * that do not live within the plan (zone status, resources, integration).
 *
 * All optional: without context, `diffPlans` continues working and falls back
 * to zone names in `seed.ts`.
 */
export interface PlanDiffContext {
  zoneNames?: Record<string, string>;
  previousZones?: Pick<CrisisZone, "id" | "name" | "status">[];
  nextZones?: Pick<CrisisZone, "id" | "name" | "status">[];
  previousResources?: Pick<Resource, "id" | "name" | "zoneId" | "status">[];
  nextResources?: Pick<Resource, "id" | "name" | "zoneId" | "status">[];
  /** Action catalogue to name actions rather than citing their IDs. */
  actions?: Pick<Action, "id" | "channel" | "target" | "objective" | "status">[];
  previousIntegration?: IntegrationState;
  nextIntegration?: IntegrationState;
}

const seedZoneNames: Record<string, string> = Object.fromEntries(
  seedZones.map((zone) => [zone.id, zone.name]),
);

function zoneNameResolver(context: PlanDiffContext) {
  const names: Record<string, string> = { ...seedZoneNames };
  for (const zone of context.previousZones ?? []) names[zone.id] = zone.name;
  for (const zone of context.nextZones ?? []) names[zone.id] = zone.name;
  Object.assign(names, context.zoneNames ?? {});
  return (zoneId: string) => names[zoneId] ?? zoneId;
}

function describeAction(
  actionId: string,
  context: PlanDiffContext,
): { label: string; detail: string } {
  const action = context.actions?.find((candidate) => candidate.id === actionId);
  if (!action) {
    return { label: `Acción ${actionId}`, detail: `Acción ${actionId}.` };
  }
  return {
    label: `${channelLabel[action.channel]} a ${action.target}`,
    detail: `${action.objective} (${channelLabel[action.channel].toLowerCase()} a ${action.target}).`,
  };
}

function motive(plan: Plan): string {
  const trigger = plan.trigger?.trim();
  return trigger ? ` Motivo: ${trigger}.` : "";
}

// ---------------------------------------------------------------------------
// Differences between two plans
// ---------------------------------------------------------------------------

function diffPriorities(previous: Plan, next: Plan, context: PlanDiffContext): PlanChange[] {
  const nameOf = zoneNameResolver(context);
  const changes: PlanChange[] = [];

  const previousRank = new Map(
    previous.priorities.map((priority, index) => [priority.zoneId, index]),
  );
  const previousScore = new Map(
    previous.priorities.map((priority) => [priority.zoneId, priority.score]),
  );
  const nextRank = new Map(next.priorities.map((priority, index) => [priority.zoneId, index]));

  next.priorities.forEach((priority, index) => {
    const before = previousRank.get(priority.zoneId);
    const name = nameOf(priority.zoneId);

    if (before === undefined) {
      // Zone that was not in previous ranking and is now present.
      changes.push({
        kind: "priority-up",
        label: `${name} entra en el ranking en el puesto ${index + 1}`,
        detail: `${name} no figuraba en la versión anterior del plan y entra directamente en el puesto ${index + 1} con puntuación ${Math.round(priority.score)}.${motive(next)}`,
      });
      return;
    }

    if (before === index) return;

    const scoreBefore = Math.round(previousScore.get(priority.zoneId) ?? 0);
    const scoreNow = Math.round(priority.score);
    const scoreText =
      scoreBefore === scoreNow
        ? `Su puntuación sigue en ${scoreNow}, pero el resto del mapa se movió.`
        : `Su puntuación pasa de ${scoreBefore} a ${scoreNow}.`;

    if (before > index) {
      // Moved up: describe who it overtook, which is understandable at a glance.
      const overtaken = previous.priorities
        .slice(index, before)
        .filter((candidate) => (nextRank.get(candidate.zoneId) ?? Number.MAX_SAFE_INTEGER) > index)
        .map((candidate) => nameOf(candidate.zoneId));

      changes.push({
        kind: "priority-up",
        label:
          overtaken.length > 0
            ? `${name} adelanta a ${joinNames(overtaken)}`
            : `${name} sube al puesto ${index + 1}`,
        detail: `${name} pasa del puesto ${before + 1} al ${index + 1}. ${scoreText}${motive(next)}`,
      });
      return;
    }

    const aheadNow = next.priorities
      .slice(before, index)
      .map((candidate) => nameOf(candidate.zoneId));

    changes.push({
      kind: "priority-down",
      label:
        aheadNow.length > 0
          ? `${name} queda por detrás de ${joinNames(aheadNow)}`
          : `${name} baja al puesto ${index + 1}`,
      detail: `${name} cede el puesto ${before + 1} y baja al ${index + 1}. ${scoreText}${motive(next)}`,
    });
  });

  return changes;
}

function diffActions(previous: Plan, next: Plan, context: PlanDiffContext): PlanChange[] {
  const changes: PlanChange[] = [];
  const previousOpen = new Set(previous.proposedActionIds);
  const nextOpen = new Set(next.proposedActionIds);
  const previousInvalid = new Set(previous.invalidatedActionIds);
  const nextInvalid = new Set(next.invalidatedActionIds);

  // New actions: open now and were not open before.
  for (const actionId of next.proposedActionIds) {
    if (previousOpen.has(actionId) || nextInvalid.has(actionId)) continue;
    const described = describeAction(actionId, context);
    changes.push({
      kind: "action-added",
      label: `Nueva acción: ${described.label}`,
      detail: `El plan añade una acción que antes no existía: ${described.detail}${motive(next)}`,
    });
  }

  // Actions explicitly invalidated by replanning.
  for (const actionId of next.invalidatedActionIds) {
    if (previousInvalid.has(actionId)) continue;
    const described = describeAction(actionId, context);
    changes.push({
      kind: "action-invalidated",
      label: `Acción anulada: ${described.label}`,
      detail: `Ya no encaja con el plan y se retira antes de ejecutarse: ${described.detail}${motive(next)}`,
    });
  }

  // Actions that dropped from plan without being marked invalidated. Only
  // report those that ended poorly: a successfully completed action is good
  // news, not a plan change.
  for (const actionId of previous.proposedActionIds) {
    if (nextOpen.has(actionId) || nextInvalid.has(actionId)) continue;
    const action = context.actions?.find((candidate) => candidate.id === actionId);
    if (!action) continue;
    if (!["cancelled", "blocked", "stalled"].includes(action.status)) continue;
    const described = describeAction(actionId, context);
    const reason =
      action.status === "cancelled"
        ? "la canceló un operador"
        : action.status === "blocked"
          ? "se quedó bloqueada"
          : "dejó de responder";
    changes.push({
      kind: "action-invalidated",
      label: `Acción retirada: ${described.label}`,
      detail: `Sale del plan porque ${reason}: ${described.detail}`,
    });
  }

  return changes;
}

function diffZoneStatus(context: PlanDiffContext, next: Plan): PlanChange[] {
  if (!context.previousZones || !context.nextZones) return [];
  const before = new Map(context.previousZones.map((zone) => [zone.id, zone]));
  const changes: PlanChange[] = [];

  for (const zone of context.nextZones) {
    const old = before.get(zone.id);
    if (!old || old.status === zone.status) continue;
    const worsens = zoneStatusRank[zone.status] > zoneStatusRank[old.status];
    changes.push({
      kind: "zone-status",
      label: `${zone.name} pasa a ${zoneStatusLabel[zone.status]}`,
      detail: `${worsens ? "Se agrava" : "Mejora"}: la zona estaba ${zoneStatusLabel[old.status]} y ahora está ${zoneStatusLabel[zone.status]}.${motive(next)}`,
    });
  }

  return changes;
}

function diffResources(context: PlanDiffContext): PlanChange[] {
  if (!context.previousResources || !context.nextResources) return [];
  const nameOf = zoneNameResolver(context);
  const before = new Map(context.previousResources.map((resource) => [resource.id, resource]));
  const changes: PlanChange[] = [];

  for (const resource of context.nextResources) {
    const old = before.get(resource.id);
    if (!old) continue;

    if (old.zoneId !== resource.zoneId) {
      const origen = old.zoneId ? nameOf(old.zoneId) : "la base";
      const destino = resource.zoneId ? nameOf(resource.zoneId) : "la base";
      changes.push({
        kind: "resource-reassigned",
        label: `${resource.name} se mueve a ${destino}`,
        detail: `${resource.name} deja ${origen} y pasa a ${destino}.`,
      });
      continue;
    }

    if (old.status !== resource.status && resource.status === "unavailable") {
      changes.push({
        kind: "resource-reassigned",
        label: `${resource.name} queda fuera de servicio`,
        detail: `${resource.name} ya no está disponible, así que el plan cuenta con un recurso menos.`,
      });
    }
  }

  return changes;
}

function diffIntegration(context: PlanDiffContext): PlanChange[] {
  const before = context.previousIntegration;
  const now = context.nextIntegration;
  if (!before || !now) return [];
  const changes: PlanChange[] = [];

  if (before.mode !== now.mode) {
    changes.push({
      kind: "integration",
      label:
        now.mode === "mock" ? "La ejecución pasa a modo simulado" : "La ejecución pasa a modo real",
      detail:
        now.mode === "mock"
          ? "Las acciones dejan de salir al exterior y quedan marcadas como simuladas."
          : "Las acciones vuelven a ejecutarse de verdad contra HappyRobot.",
    });
  }

  if (now.lastExternalError && now.lastExternalError !== before.lastExternalError) {
    changes.push({
      kind: "integration",
      label: "La integración con HappyRobot está fallando",
      detail: `Último error devuelto por la plataforma: ${now.lastExternalError}. Las acciones afectadas necesitan reintento o una vía alternativa.`,
    });
  }

  if (before.lastExternalError && !now.lastExternalError) {
    changes.push({
      kind: "integration",
      label: "La integración con HappyRobot vuelve a responder",
      detail: "El error anterior se resolvió y las acciones pueden reintentarse.",
    });
  }

  if (before.happyRobotConfigured !== now.happyRobotConfigured) {
    changes.push({
      kind: "integration",
      label: now.happyRobotConfigured
        ? "Credenciales de HappyRobot disponibles"
        : "Faltan credenciales de HappyRobot",
      detail: now.happyRobotConfigured
        ? "La plataforma queda configurada y se puede ejecutar de verdad."
        : "Sin credenciales, todo lo que se ejecute quedará etiquetado como simulado.",
    });
  }

  return changes;
}

/**
 * Calculates what changed between two plan versions.
 *
 * Context is optional to avoid breaking callers with two arguments;
 * the more context provided, the more change types it can detect.
 */
export function diffPlans(
  previous: Plan | null,
  next: Plan,
  context: PlanDiffContext = {},
): PlanChange[] {
  if (!previous) return [];

  const changes = [
    ...diffIntegration(context),
    ...diffZoneStatus(context, next),
    ...diffActions(previous, next, context),
    ...diffPriorities(previous, next, context),
    ...diffResources(context),
  ];

  // Stable sort by importance: what a human looks at first goes to top.
  return changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => kindRank[a.change.kind] - kindRank[b.change.kind] || a.index - b.index)
    .slice(0, MAX_PLAN_CHANGES)
    .map((entry) => entry.change);
}

// ---------------------------------------------------------------------------
// History and audit
// ---------------------------------------------------------------------------

/** Saves previous plan version, trimming history. */
export function pushPlanHistory(history: Plan[], plan: Plan): Plan[] {
  return [plan, ...history].slice(0, MAX_PLAN_HISTORY);
}

export function appendAudit(
  audit: AuditEntry[],
  entry: {
    id: string;
    at: string;
    actor: Actor;
    kind: string;
    summary: string;
    planVersion: number;
    ref?: string;
  },
): AuditEntry[] {
  return [entry, ...audit].slice(0, MAX_AUDIT_ENTRIES);
}

/** Summary of a batch of changes, for replanning headline. */
export function summarizeChanges(changes: PlanChange[]): string {
  if (changes.length === 0) return "Sin diferencias respecto a la versión anterior.";
  if (changes.length === 1) return changes[0].label;
  return `${changes[0].label} y ${changes.length - 1} cambio${changes.length > 2 ? "s" : ""} más.`;
}
