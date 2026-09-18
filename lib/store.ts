import { executeHappyRobotAction, getExecutionMode, isHappyRobotConfigured } from "./happyrobot";
import { buildDedupeKey, buildPlan } from "./priority";
import { seedActions, seedEvents, seedResources, seedZones } from "./seed";
import type {
  Action,
  ActionStatus,
  CreateActionPayload,
  CrisisEvent,
  CrisisZone,
  IncomingEventPayload,
  Resource,
  SituationState
} from "./types";

type MutableState = SituationState & { nextVersion: number };

declare global {
  var crisisState: MutableState | undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createInitialState(): MutableState {
  const events = clone(seedEvents);
  const zones = clone(seedZones);
  const resources = clone(seedResources);
  const actions = clone(seedActions);

  return {
    events,
    zones,
    resources,
    actions,
    plan: buildPlan(1, zones, events, resources, actions),
    integration: {
      mode: getExecutionMode(),
      happyRobotConfigured: isHappyRobotConfigured(),
      lastExternalError: null
    },
    nextVersion: 2
  };
}

function state() {
  globalThis.crisisState ??= createInitialState();
  globalThis.crisisState.integration.mode = getExecutionMode();
  globalThis.crisisState.integration.happyRobotConfigured = isHappyRobotConfigured();
  return globalThis.crisisState;
}

function replan(invalidatedActionIds: string[] = []) {
  const current = state();
  current.plan = buildPlan(
    current.nextVersion++,
    current.zones,
    current.events,
    current.resources,
    current.actions,
    invalidatedActionIds
  );
}

function defaultZoneId() {
  return state().zones[0]?.id ?? "zone-central";
}

function normalizeIncomingEvent(payload: IncomingEventPayload): CrisisEvent {
  const zoneId = payload.zoneId ?? defaultZoneId();
  const category = payload.category ?? "operations";
  const severity = payload.severity ?? "medium";

  return {
    id: uid("evt"),
    source: payload.source ?? "happyrobot",
    title: payload.title ?? "Nueva senal de crisis",
    description: payload.description ?? "Entrada no estructurada recibida y normalizada.",
    zoneId,
    category,
    severity,
    confidence: payload.confidence ?? "medium",
    createdAt: new Date().toISOString(),
    confirmed: payload.confirmed ?? null,
    dedupeKey: buildDedupeKey({ zoneId, category, severity })
  };
}

function updateZoneFromEvent(zone: CrisisZone, event: CrisisEvent): CrisisZone {
  const statusBySeverity: Record<CrisisEvent["severity"], CrisisZone["status"]> = {
    low: zone.status === "stable" ? "stable" : zone.status,
    medium: zone.status === "critical" ? "critical" : "watch",
    high: zone.status === "critical" ? "critical" : "active",
    critical: "critical"
  };

  const need = event.category.replace(/-/g, " ");
  return {
    ...zone,
    status: statusBySeverity[event.severity],
    riskScore: Math.min(100, zone.riskScore + (event.severity === "critical" ? 18 : event.severity === "high" ? 10 : 4)),
    needs: zone.needs.includes(need) ? zone.needs : [...zone.needs, need],
    lastUpdatedAt: event.createdAt
  };
}

function proposeActionForEvent(event: CrisisEvent) {
  const current = state();
  const zone = current.zones.find((candidate) => candidate.id === event.zoneId);
  const existingOpen = current.actions.some(
    (action) =>
      action.zoneId === event.zoneId &&
      action.objective.toLowerCase().includes(event.category.toLowerCase()) &&
      !["succeeded", "cancelled"].includes(action.status)
  );
  if (!zone || existingOpen) return;

  const resource = current.resources.find((candidate) => candidate.status === "available");
  const action: Action = {
    id: uid("act"),
    channel: event.severity === "critical" ? "call" : "ticket",
    target: `Responsable de ${zone.name}`,
    objective: `Coordinar respuesta de ${event.category} en ${zone.name}.`,
    status: "pending",
    reason: `${event.title} elevo la prioridad de ${zone.name} con severidad ${event.severity} y confianza ${event.confidence}.`,
    zoneId: zone.id,
    resourceId: resource?.id,
    executionMode: getExecutionMode(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  current.actions.unshift(action);
}

export function getSituation(): SituationState {
  const current = state();
  return clone({
    events: current.events,
    zones: current.zones,
    resources: current.resources,
    actions: current.actions,
    plan: current.plan,
    integration: current.integration
  });
}

export function resetSituation() {
  globalThis.crisisState = createInitialState();
  return getSituation();
}

export function addEvent(payload: IncomingEventPayload) {
  const current = state();
  const event = normalizeIncomingEvent(payload);
  const duplicate = current.events.find(
    (candidate) => candidate.dedupeKey === event.dedupeKey && Date.now() - new Date(candidate.createdAt).getTime() < 5 * 60 * 1000
  );

  if (duplicate) {
    duplicate.description = `${duplicate.description}\nSenal duplicada: ${event.description}`;
    duplicate.confidence = duplicate.confidence === "high" ? "high" : event.confidence;
    duplicate.createdAt = event.createdAt;
  } else {
    current.events.unshift(event);
    current.zones = current.zones.map((zone) => (zone.id === event.zoneId ? updateZoneFromEvent(zone, event) : zone));
    proposeActionForEvent(event);
  }

  replan();
  return { event: duplicate ?? event, duplicate: Boolean(duplicate), situation: getSituation() };
}

export function createAction(payload: CreateActionPayload) {
  const current = state();
  const action: Action = {
    id: uid("act"),
    ...payload,
    status: "pending",
    executionMode: getExecutionMode(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  current.actions.unshift(action);
  replan();
  return action;
}

export async function approveAction(actionId: string) {
  const current = state();
  const action = current.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error("Action not found");
  if (["succeeded", "cancelled", "running"].includes(action.status)) return action;

  action.status = "running";
  action.updatedAt = new Date().toISOString();

  try {
    const result = await executeHappyRobotAction(action);
    action.status = result.mode === "mock" ? "succeeded" : "running";
    action.executionMode = result.mode;
    action.externalActionId = result.externalActionId;
    action.error = undefined;
    current.integration.lastExternalError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown HappyRobot error";
    action.status = "failed";
    action.error = message;
    current.integration.lastExternalError = message;
  }

  action.updatedAt = new Date().toISOString();
  replan();
  return action;
}

export function setActionStatus(actionId: string, status: ActionStatus, externalActionId?: string, error?: string) {
  const current = state();
  const action = current.actions.find((candidate) => candidate.id === actionId || candidate.externalActionId === actionId);
  if (!action) throw new Error("Action not found");

  action.status = status;
  action.externalActionId = externalActionId ?? action.externalActionId;
  action.error = error;
  action.updatedAt = new Date().toISOString();
  if (status === "failed") current.integration.lastExternalError = error ?? "External action failed";
  replan();
  return action;
}

export function cancelAction(actionId: string) {
  return setActionStatus(actionId, "cancelled");
}

export function retryAction(actionId: string) {
  const current = state();
  const action = current.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error("Action not found");
  action.status = "pending";
  action.error = undefined;
  action.externalActionId = undefined;
  action.updatedAt = new Date().toISOString();
  replan();
  return action;
}

export function markEvent(eventId: string, confirmed: boolean) {
  const current = state();
  const event = current.events.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error("Event not found");
  event.confirmed = confirmed;
  replan();
  return event;
}

export function injectDemo(kind: "incident" | "resource-down" | "route-blocked" | "integration-failure") {
  const current = state();

  if (kind === "resource-down") {
    const resource = current.resources.find((candidate) => candidate.status !== "unavailable");
    if (resource) {
      resource.status = "unavailable";
      const invalidated = current.actions
        .filter((action) => action.resourceId === resource.id && ["pending", "approved", "running"].includes(action.status))
        .map((action) => {
          action.status = "blocked";
          action.error = `${resource.name} queda no disponible.`;
          action.updatedAt = new Date().toISOString();
          return action.id;
        });
      addEvent({
        source: "demo",
        title: `${resource.name} queda no disponible`,
        description: "La disponibilidad de recursos cambio durante la ejecucion regional; el plan debe rehacerse.",
        zoneId: resource.zoneId ?? defaultZoneId(),
        category: "resource-shortage",
        severity: "high",
        confidence: "high",
        confirmed: true
      });
      replan(invalidated);
    }
    return getSituation();
  }

  if (kind === "route-blocked") {
    addEvent({
      source: "demo",
      title: "Ruta de acceso bloqueada",
      description: "La ruta principal entre Granada y Almeria queda bloqueada y los recursos asignados pueden necesitar desvio.",
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "critical",
      confidence: "high",
      confirmed: true
    });
    return getSituation();
  }

  if (kind === "integration-failure") {
    const action = current.actions.find((candidate) => candidate.status !== "cancelled");
    if (action) setActionStatus(action.id, "failed", action.externalActionId, "Fallo simulado de callback HappyRobot.");
    return getSituation();
  }

  addEvent({
    source: "demo",
    title: "Nuevo incidente de alta prioridad",
    description: "Una nueva senal desde Sierra Morena indica una necesidad operativa que cambia rapido.",
    zoneId: "zone-north",
    category: "evacuation-support",
    severity: "critical",
    confidence: "medium",
    confirmed: null
  });
  return getSituation();
}

export function updateResource(resourceId: string, status: Resource["status"]) {
  const current = state();
  const resource = current.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) throw new Error("Resource not found");
  resource.status = status;
  replan();
  return resource;
}
