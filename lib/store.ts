// PROPIETARIO: coordinacion (no lo editan los agentes de modulo).
// Orquestador del estado de crisis. Mantiene el estado y delega las decisiones
// en los modulos especializados: priority, resources, contacts, escalation,
// history, learning, persistence y scenario.

import { selectChannel, selectContact } from "./contacts";
import { buildEscalationChain } from "./escalation";
import { executeHappyRobotAction, getExecutionMode, isHappyRobotConfigured } from "./happyrobot";
import { appendAudit, diffPlans, pushPlanHistory } from "./history";
import { emptyWeights, recordActionOutcome } from "./learning";
import { isPersistenceEnabled, loadState, loadWeights, saveState } from "./persistence";
import { buildDedupeKey, buildPlan } from "./priority";
import { assignResource, reassignAffectedActions, releaseResource, selectResourceForAction } from "./resources";
import { createScenarioState, dueBeats, startScenario, stopScenario } from "./scenario";
import { seedActions, seedContacts, seedEvents, seedResources, seedZones } from "./seed";
import type {
  Action,
  ActionStatus,
  Actor,
  CreateActionPayload,
  CrisisEvent,
  CrisisZone,
  DemoKind,
  IncomingEventPayload,
  Resource,
  SituationState
} from "./types";

type MutableState = SituationState & { nextVersion: number };

declare global {
  var crisisState: MutableState | undefined;
}

/** Segundos que una accion puede estar en curso antes de considerarse atascada. */
const STALL_SECONDS = 90;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Ciclo de vida del estado
// ---------------------------------------------------------------------------

function createInitialState(): MutableState {
  const events = clone(seedEvents);
  const zones = clone(seedZones);
  const resources = clone(seedResources);
  const contacts = clone(seedContacts);
  const actions = clone(seedActions);

  return {
    events,
    zones,
    resources,
    contacts,
    chains: [],
    actions,
    plan: buildPlan(1, zones, events, resources, actions),
    planHistory: [],
    audit: [],
    scenario: createScenarioState(),
    learning: loadWeights() ?? emptyWeights(),
    integration: {
      mode: getExecutionMode(),
      happyRobotConfigured: isHappyRobotConfigured(),
      lastExternalError: null,
      liveActionsExecuted: 0,
      mockActionsExecuted: 0
    },
    nextVersion: 2
  };
}

function restoreOrCreate(): MutableState {
  if (!isPersistenceEnabled()) return createInitialState();
  const restored = loadState();
  if (!restored) return createInitialState();
  return { ...restored, nextVersion: restored.plan.version + 1 };
}

function state() {
  globalThis.crisisState ??= restoreOrCreate();
  const current = globalThis.crisisState;
  current.integration.mode = getExecutionMode();
  current.integration.happyRobotConfigured = isHappyRobotConfigured();
  return current;
}

function persist() {
  if (!isPersistenceEnabled()) return;
  try {
    saveState(getSituation());
  } catch {
    // La persistencia nunca puede tumbar la demo.
  }
}

// ---------------------------------------------------------------------------
// Auditoria y replanificacion
// ---------------------------------------------------------------------------

function audit(actor: Actor, kind: string, summary: string, ref?: string) {
  const current = state();
  current.audit = appendAudit(current.audit, {
    id: uid("aud"),
    at: nowIso(),
    actor,
    kind,
    summary,
    planVersion: current.plan.version,
    ref
  });
}

function replan(trigger: string, invalidatedActionIds: string[] = []) {
  const current = state();
  const previous = current.plan;
  const next = buildPlan(
    current.nextVersion++,
    current.zones,
    current.events,
    current.resources,
    current.actions,
    invalidatedActionIds
  );
  next.trigger = trigger;
  next.changes = diffPlans(previous, next);
  current.planHistory = pushPlanHistory(current.planHistory, previous);
  current.plan = next;
  persist();
}

// ---------------------------------------------------------------------------
// Vigilante de acciones atascadas
// ---------------------------------------------------------------------------

function sweepStalledActions() {
  const current = state();
  const now = Date.now();
  let changed = false;

  for (const action of current.actions) {
    if (action.status !== "running" || !action.stalledAfter) continue;
    if (new Date(action.stalledAfter).getTime() > now) continue;
    action.status = "stalled";
    action.error = `Sin respuesta del ejecutor externo tras ${STALL_SECONDS} segundos.`;
    action.updatedAt = nowIso();
    releaseResource(current.resources, action.id);
    audit("system", "action-stalled", `La acción "${action.objective}" dejó de responder.`, action.id);
    changed = true;
  }

  if (changed) replan("una accion externa dejo de responder");
}

// ---------------------------------------------------------------------------
// Senales
// ---------------------------------------------------------------------------

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
    title: payload.title ?? "Nueva señal de crisis",
    description: payload.description ?? "Entrada no estructurada recibida y normalizada.",
    zoneId,
    category,
    severity,
    confidence: payload.confidence ?? "medium",
    createdAt: nowIso(),
    confirmed: payload.confirmed ?? null,
    dedupeKey: buildDedupeKey({ zoneId, category, severity }),
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null
  };
}

const riskDeltaBySeverity: Record<CrisisEvent["severity"], number> = {
  low: 4,
  medium: 4,
  high: 10,
  critical: 18
};

/**
 * Aplica el efecto de una señal sobre su zona y anota en la propia señal qué
 * cambio provocó, de forma que descartarla pueda revertirlo exactamente.
 *
 * INVARIANTE COMPARTIDA CON lib/priority.ts. Esta función sube zone.riskScore
 * y puede añadir una necesidad. El motor de prioridad DESCUENTA esos mismos
 * appliedRiskDelta y appliedNeed para volver a contarlos con credibilidad y
 * decaimiento temporal propios. Si cambias cómo se calcula o se anota el
 * delta, el motor contará la señal dos veces y ninguna señal envejecerá.
 * Cualquier cambio aquí exige revisar liveEventsForZone en lib/priority.ts.
 */
function applyEventToZone(zone: CrisisZone, event: CrisisEvent): CrisisZone {
  const statusBySeverity: Record<CrisisEvent["severity"], CrisisZone["status"]> = {
    low: zone.status === "stable" ? "stable" : zone.status,
    medium: zone.status === "critical" ? "critical" : "watch",
    high: zone.status === "critical" ? "critical" : "active",
    critical: "critical"
  };

  const need = needOfEvent(event);
  const rawDelta = riskDeltaBySeverity[event.severity];
  const appliedDelta = Math.min(rawDelta, 100 - zone.riskScore);
  const addsNeed = !zone.needs.includes(need);

  event.appliedRiskDelta = appliedDelta;
  event.appliedNeed = addsNeed ? need : null;
  event.previousZoneStatus = zone.status;

  return {
    ...zone,
    status: statusBySeverity[event.severity],
    riskScore: zone.riskScore + appliedDelta,
    needs: addsNeed ? [...zone.needs, need] : zone.needs,
    lastUpdatedAt: event.createdAt
  };
}

/** Necesidad que una señal implica para su zona. */
function needOfEvent(event: CrisisEvent) {
  return event.category.replace(/-/g, " ");
}

/** Deshace el efecto de una señal descartada sobre su zona. */
function revertEventFromZone(zone: CrisisZone, event: CrisisEvent): CrisisZone {
  // La necesidad solo la registra la PRIMERA señal que la introduce, así que
  // no basta con mirar appliedNeed de las demás: hay que comprobar si alguna
  // otra señal viva de la zona implica esa misma necesidad. Si no, descartar
  // la primera borraría una necesidad que otra señal sigue pidiendo.
  const stillNeeded = state().events.some(
    (other) =>
      other.id !== event.id &&
      other.zoneId === event.zoneId &&
      other.confirmed !== false &&
      needOfEvent(other) === event.appliedNeed
  );

  return {
    ...zone,
    status: event.previousZoneStatus ?? zone.status,
    riskScore: Math.max(0, zone.riskScore - event.appliedRiskDelta),
    needs:
      event.appliedNeed && !stillNeeded
        ? zone.needs.filter((need) => need !== event.appliedNeed)
        : zone.needs,
    lastUpdatedAt: nowIso()
  };
}

function proposeActionForEvent(event: CrisisEvent) {
  const current = state();
  const zone = current.zones.find((candidate) => candidate.id === event.zoneId);
  if (!zone) return;

  const existingOpen = current.actions.some(
    (action) =>
      action.zoneId === event.zoneId &&
      action.objective.toLowerCase().includes(event.category.toLowerCase()) &&
      !["succeeded", "cancelled"].includes(action.status)
  );
  if (existingOpen) return;

  const urgent = event.severity === "critical" || event.severity === "high";
  const contact = selectContact(current.contacts, zone.id, event.category);
  const channel = contact ? selectChannel(contact, urgent, current.learning) : urgent ? "call" : "ticket";
  const at = nowIso();
  const id = uid("act");

  const assignment = selectResourceForAction(
    { zoneId: zone.id, objective: event.category, channel },
    current.resources,
    current.zones
  );

  const chain = buildEscalationChain({
    id: uid("chain"),
    objective: `Coordinar respuesta de ${event.category} en ${zone.name}.`,
    zoneId: zone.id,
    category: event.category,
    urgent,
    contacts: current.contacts,
    learning: current.learning,
    at
  });
  if (chain.steps.length > 0) current.chains.unshift(chain);

  const action: Action = {
    id,
    channel,
    target: contact?.name ?? `Responsable de ${zone.name}`,
    objective: `Coordinar respuesta de ${event.category} en ${zone.name}.`,
    status: "pending",
    reason: `${event.title} elevó la prioridad de ${zone.name} con severidad ${event.severity} y confianza ${event.confidence}.${assignment ? ` ${assignment.reason}` : " Sin recurso compatible libre."}`,
    zoneId: zone.id,
    resourceId: assignment?.resourceId,
    contactId: contact?.id,
    chainId: chain.steps.length > 0 ? chain.id : undefined,
    executionMode: getExecutionMode(),
    attempt: 1,
    idempotencyKey: `${id}:1`,
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at
  };

  current.actions.unshift(action);
  audit("system", "action-proposed", `Propuesta: ${action.objective}`, action.id);
}

// ---------------------------------------------------------------------------
// API publica del store
// ---------------------------------------------------------------------------

export function getSituation(): SituationState {
  const current = state();
  return clone({
    events: current.events,
    zones: current.zones,
    resources: current.resources,
    contacts: current.contacts,
    chains: current.chains,
    actions: current.actions,
    plan: current.plan,
    planHistory: current.planHistory,
    audit: current.audit,
    scenario: current.scenario,
    learning: current.learning,
    integration: current.integration
  });
}

/** Lectura viva: avanza el escenario y barre acciones atascadas antes de leer. */
export function pollSituation(): SituationState {
  tickScenario();
  sweepStalledActions();
  return getSituation();
}

export function resetSituation() {
  globalThis.crisisState = createInitialState();
  audit("operator", "reset", "La demo se reinició al estado inicial.");
  return getSituation();
}

export function addEvent(payload: IncomingEventPayload, actor: Actor = "system") {
  const current = state();
  const event = normalizeIncomingEvent(payload);
  const duplicate = current.events.find(
    (candidate) =>
      candidate.dedupeKey === event.dedupeKey &&
      candidate.confirmed !== false &&
      Date.now() - new Date(candidate.createdAt).getTime() < 5 * 60 * 1000
  );

  if (duplicate) {
    duplicate.occurrences += 1;
    duplicate.description = `${duplicate.description}\nSeñal duplicada: ${event.description}`;
    duplicate.confidence = duplicate.confidence === "high" ? "high" : event.confidence;
    duplicate.createdAt = event.createdAt;
    audit(actor, "event-deduplicated", `Señal repetida fusionada: ${duplicate.title}`, duplicate.id);
  } else {
    current.events.unshift(event);
    current.zones = current.zones.map((zone) =>
      zone.id === event.zoneId ? applyEventToZone(zone, event) : zone
    );
    audit(actor, "event-ingested", `Nueva señal: ${event.title}`, event.id);
    proposeActionForEvent(event);
  }

  replan(duplicate ? "señal repetida" : `nueva señal: ${event.title}`);
  return { event: duplicate ?? event, duplicate: Boolean(duplicate), situation: getSituation() };
}

export function markEvent(eventId: string, confirmed: boolean, actor: Actor = "operator") {
  const current = state();
  const event = current.events.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error("Event not found");
  if (event.confirmed === confirmed) return event;

  const wasDiscarded = event.confirmed === false;
  event.confirmed = confirmed;

  if (!confirmed) {
    // Descartar una senal deshace su efecto sobre la zona y cancela las
    // acciones que solo existian por ella.
    current.zones = current.zones.map((zone) =>
      zone.id === event.zoneId ? revertEventFromZone(zone, event) : zone
    );
    for (const action of current.actions) {
      const bornFromEvent =
        action.zoneId === event.zoneId &&
        action.objective.toLowerCase().includes(event.category.toLowerCase()) &&
        ["pending", "blocked"].includes(action.status);
      if (!bornFromEvent) continue;
      action.status = "cancelled";
      action.error = `Se descartó la señal "${event.title}" que la motivó.`;
      action.updatedAt = nowIso();
      releaseResource(current.resources, action.id);
    }
    audit(actor, "event-discarded", `Señal descartada y efecto revertido: ${event.title}`, event.id);
  } else {
    if (wasDiscarded) {
      current.zones = current.zones.map((zone) =>
        zone.id === event.zoneId ? applyEventToZone(zone, event) : zone
      );
    }
    audit(actor, "event-confirmed", `Señal confirmada: ${event.title}`, event.id);
  }

  replan(confirmed ? "una señal fue confirmada" : "una señal fue descartada");
  return event;
}

export function createAction(payload: CreateActionPayload, actor: Actor = "operator") {
  const current = state();
  const at = nowIso();
  const id = uid("act");
  const assignment =
    payload.resourceId
      ? { resourceId: payload.resourceId, reason: "Recurso elegido manualmente." }
      : selectResourceForAction(
          { zoneId: payload.zoneId, objective: payload.objective, channel: payload.channel },
          current.resources,
          current.zones
        );

  const action: Action = {
    id,
    ...payload,
    resourceId: assignment?.resourceId,
    status: "pending",
    executionMode: getExecutionMode(),
    attempt: 1,
    idempotencyKey: `${id}:1`,
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at
  };
  current.actions.unshift(action);
  audit(actor, "action-created", `Acción creada a mano: ${action.objective}`, action.id);
  replan("un operador creó una acción");
  return action;
}

export async function approveAction(actionId: string, actor: Actor = "operator") {
  const current = state();
  const action = current.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error("Action not found");
  if (["succeeded", "cancelled", "running"].includes(action.status)) return action;

  action.status = "running";
  action.approvedBy = actor;
  action.approvedAt = nowIso();
  action.updatedAt = action.approvedAt;
  action.stalledAfter = new Date(Date.now() + STALL_SECONDS * 1000).toISOString();
  action.idempotencyKey = `${action.id}:${action.attempt}`;

  // Si el recurso ya no está disponible hay que parar AQUÍ, antes de lanzar la
  // llamada externa: de lo contrario se avisaría a alguien de que va en camino
  // un recurso que no existe, y la acción acabaría marcada como completada.
  if (action.resourceId) {
    const asignado = assignResource(current.resources, action.resourceId, action.id, action.approvedAt);
    if (!asignado) {
      const recurso = current.resources.find((candidate) => candidate.id === action.resourceId);
      action.status = "blocked";
      action.error = `${recurso?.name ?? action.resourceId} no está disponible: la acción no se ejecuta.`;
      action.updatedAt = nowIso();
      action.stalledAfter = null;
      audit(actor, "action-blocked", `Acción bloqueada por falta de recurso: ${action.objective}`, action.id);
      replan("se intentó aprobar una acción sin recurso disponible");
      return action;
    }
  }

  audit(actor, "action-approved", `Acción aprobada: ${action.objective}`, action.id);

  const attemptAtDispatch = action.attempt;

  try {
    const result = await executeHappyRobotAction(action);

    // El operador puede haber cancelado o reintentado mientras la llamada
    // estaba en vuelo: en ese caso la respuesta tardia no puede pisar el estado.
    const settled = current.actions.find((candidate) => candidate.id === actionId);
    if (!settled || settled.attempt !== attemptAtDispatch || settled.status !== "running") {
      return settled ?? action;
    }

    settled.status = result.mode === "mock" ? "succeeded" : "running";
    settled.executionMode = result.mode;
    settled.externalActionId = result.externalActionId;
    settled.error = undefined;
    settled.updatedAt = nowIso();
    if (settled.status === "succeeded") {
      settled.completedAt = settled.updatedAt;
      settled.stalledAfter = null;
      releaseResource(current.resources, settled.id);
      current.learning = recordActionOutcome(current.learning, settled);
    }
    if (result.mode === "mock") current.integration.mockActionsExecuted += 1;
    else current.integration.liveActionsExecuted += 1;
    current.integration.lastExternalError = null;
    replan("se ejecutó una acción");
    return settled;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown HappyRobot error";
    const settled = current.actions.find((candidate) => candidate.id === actionId);
    if (!settled || settled.attempt !== attemptAtDispatch || settled.status !== "running") {
      return settled ?? action;
    }
    settled.status = "failed";
    settled.error = message;
    settled.stalledAfter = null;
    settled.updatedAt = nowIso();
    releaseResource(current.resources, settled.id);
    current.integration.lastExternalError = message;
    current.learning = recordActionOutcome(current.learning, settled);
    audit("happyrobot", "action-failed", `Falló la ejecución: ${message}`, settled.id);
    replan("falló la ejecución de una acción");
    return settled;
  }
}

export function setActionStatus(
  actionId: string,
  status: ActionStatus,
  externalActionId?: string,
  error?: string,
  actor: Actor = "happyrobot"
) {
  const current = state();
  const action = current.actions.find(
    (candidate) => candidate.id === actionId || candidate.externalActionId === actionId
  );
  if (!action) throw new Error("Action not found");

  action.status = status;
  action.externalActionId = externalActionId ?? action.externalActionId;
  action.error = error;
  action.updatedAt = nowIso();

  if (["succeeded", "failed", "cancelled", "blocked", "stalled"].includes(status)) {
    action.stalledAfter = null;
    releaseResource(current.resources, action.id);
  }
  if (status === "succeeded") action.completedAt = action.updatedAt;
  if (["succeeded", "failed"].includes(status)) {
    current.learning = recordActionOutcome(current.learning, action);
  }
  if (status === "failed") current.integration.lastExternalError = error ?? "External action failed";

  audit(actor, `action-${status}`, `La acción "${action.objective}" pasó a ${status}.`, action.id);
  replan(`una acción pasó a ${status}`);
  return action;
}

export function cancelAction(actionId: string, actor: Actor = "operator") {
  return setActionStatus(actionId, "cancelled", undefined, undefined, actor);
}

export function retryAction(actionId: string, actor: Actor = "operator") {
  const current = state();
  const action = current.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error("Action not found");

  // Cada reintento es un intento nuevo con su propia clave de idempotencia,
  // de forma que HappyRobot no deduplique un reintento legitimo contra el
  // intento anterior.
  action.attempt += 1;
  action.idempotencyKey = `${action.id}:${action.attempt}`;
  action.status = "pending";
  action.error = undefined;
  action.externalActionId = undefined;
  action.stalledAfter = null;
  action.updatedAt = nowIso();
  audit(actor, "action-retried", `Reintento ${action.attempt} de "${action.objective}".`, action.id);
  replan("un operador reintentó una acción");
  return action;
}

export function updateResource(resourceId: string, status: Resource["status"], actor: Actor = "operator") {
  const current = state();
  const resource = current.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) throw new Error("Resource not found");
  resource.status = status;
  audit(actor, "resource-updated", `${resource.name} pasó a ${status}.`, resource.id);
  replan("cambió la disponibilidad de un recurso");
  return resource;
}

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

export function startScenarioRun() {
  const current = state();
  startScenario(current.scenario, nowIso());
  audit("operator", "scenario-started", `Escenario en marcha: ${current.scenario.name}.`);
  replan("arrancó el escenario");
  return getSituation();
}

export function stopScenarioRun() {
  const current = state();
  stopScenario(current.scenario);
  audit("operator", "scenario-stopped", "Escenario detenido.");
  return getSituation();
}

/** Aplica los beats del guion que ya tocaban. La UI lo dispara al refrescar. */
export function tickScenario() {
  const current = state();
  const due = dueBeats(current.scenario, Date.now());
  for (const beat of due) {
    audit("scenario", "scenario-beat", beat.label, beat.id);
    if (beat.demoKind) injectDemo(beat.demoKind, "scenario");
    else if (beat.event) addEvent(beat.event, "scenario");
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// Inyectores manuales de demo
// ---------------------------------------------------------------------------

export function injectDemo(kind: DemoKind, actor: Actor = "operator") {
  const current = state();

  if (kind === "resource-down") {
    // Tumbar un recurso solo es interesante si algo depende de el: se elige
    // primero uno con acciones vivas, y solo si no hay ninguno se coge otro.
    const busyIds = new Set(
      current.actions
        .filter((action) => ["pending", "approved", "running"].includes(action.status))
        .map((action) => action.resourceId)
        .filter(Boolean) as string[]
    );
    const resource =
      current.resources.find((candidate) => candidate.status !== "unavailable" && busyIds.has(candidate.id)) ??
      current.resources.find((candidate) => candidate.status !== "unavailable");

    if (!resource) return getSituation();

    resource.status = "unavailable";
    resource.assignedActionId = null;
    resource.assignedAt = null;

    const invalidated = current.actions
      .filter(
        (action) =>
          action.resourceId === resource.id && ["pending", "approved", "running"].includes(action.status)
      )
      .map((action) => {
        action.status = "blocked";
        action.error = `${resource.name} queda no disponible.`;
        action.updatedAt = nowIso();
        return action.id;
      });

    const reassignments = reassignAffectedActions(
      current.actions,
      current.resources,
      current.zones,
      resource.id
    );
    for (const move of reassignments) {
      const action = current.actions.find((candidate) => candidate.id === move.actionId);
      if (!action) continue;

      if (!move.toResourceId) {
        // Sin sustituto posible. Se deja visible por qué esa zona espera, en
        // lugar de que la acción se quede bloqueada sin explicación.
        action.error = move.reason;
        action.updatedAt = nowIso();
        continue;
      }

      action.resourceId = move.toResourceId;
      action.status = "pending";
      action.error = undefined;
      // El motivo anterior hablaba del recurso caído, así que se sustituye en
      // lugar de concatenarse: si no, el texto se contradice a sí mismo.
      action.reason = move.reason;
      action.updatedAt = nowIso();
    }

    addEvent(
      {
        source: actor === "scenario" ? "scenario" : "demo",
        title: `${resource.name} queda no disponible`,
        description: "La disponibilidad de recursos cambió durante la ejecución; el plan debe rehacerse.",
        zoneId: resource.zoneId ?? defaultZoneId(),
        category: "resource-shortage",
        severity: "high",
        confidence: "high",
        confirmed: true
      },
      actor
    );
    replan(`${resource.name} quedó fuera de servicio`, invalidated);
    return getSituation();
  }

  if (kind === "route-blocked") {
    addEvent(
      {
        source: actor === "scenario" ? "scenario" : "demo",
        title: "Ruta de acceso bloqueada",
        description:
          "La ruta principal entre Granada y Almería queda bloqueada y los recursos asignados pueden necesitar desvío.",
        zoneId: "zone-east",
        category: "route-blocked",
        severity: "critical",
        confidence: "high",
        confirmed: true
      },
      actor
    );
    return getSituation();
  }

  if (kind === "integration-failure") {
    // Solo tiene sentido tumbar una accion que este realmente en vuelo o a la
    // espera; marcar como fallida una ya completada seria mentir.
    const action =
      current.actions.find((candidate) => candidate.status === "running") ??
      current.actions.find((candidate) => ["approved", "pending"].includes(candidate.status));
    if (action) {
      setActionStatus(
        action.id,
        "failed",
        action.externalActionId,
        "Fallo simulado de callback HappyRobot.",
        "happyrobot"
      );
    }
    return getSituation();
  }

  addEvent(
    {
      source: actor === "scenario" ? "scenario" : "demo",
      title: "Nuevo incidente de alta prioridad",
      description: "Una nueva señal desde Sierra Morena indica una necesidad operativa que cambia rápido.",
      zoneId: "zone-north",
      category: "evacuation-support",
      severity: "critical",
      confidence: "medium",
      confirmed: null
    },
    actor
  );
  return getSituation();
}
