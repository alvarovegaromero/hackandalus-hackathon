// Tipos compartidos del centro de mando de crisis.
// Este fichero es la frontera entre modulos: cada agente implementa su modulo
// contra estos tipos. No lo edites sin avisar al resto de modulos afectados.

export type EventSource = "happyrobot" | "sensor" | "operator" | "public" | "demo" | "scenario";
export type Severity = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type ZoneStatus = "stable" | "watch" | "active" | "critical";
export type ResourceStatus = "available" | "assigned" | "unavailable";
export type ActionStatus =
  | "pending"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "stalled";
export type ActionChannel = "call" | "sms" | "email" | "ticket" | "webhook" | "whatsapp" | "slack";
export type ExecutionMode = "happyrobot" | "mock";
export type Actor = "system" | "operator" | "happyrobot" | "scenario";

// ---------------------------------------------------------------------------
// Senales
// ---------------------------------------------------------------------------

export interface CrisisEvent {
  id: string;
  source: EventSource;
  title: string;
  description: string;
  zoneId: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  createdAt: string;
  /** null = sin verificar, true = confirmada, false = descartada. */
  confirmed: boolean | null;
  dedupeKey: string;
  /** Cuantas senales equivalentes se han fusionado en esta. */
  occurrences: number;
  /** Efecto que esta senal aplico a su zona, para poder revertirlo al descartarla. */
  appliedRiskDelta: number;
  /** Necesidad que esta senal anadio a la zona, o null si no anadio ninguna. */
  appliedNeed: string | null;
  /** Estado de la zona antes de que esta senal la modificase. */
  previousZoneStatus: ZoneStatus | null;
}

export interface CrisisZone {
  id: string;
  name: string;
  status: ZoneStatus;
  populationAtRisk: number;
  /** Riesgo base de la zona, sin contar senales vivas. */
  riskScore: number;
  needs: string[];
  coordinates: { x: number; y: number };
  lastUpdatedAt: string;
}

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

export interface Resource {
  id: string;
  name: string;
  type: string;
  capacity: number;
  status: ResourceStatus;
  zoneId: string | null;
  assignedActionId: string | null;
  /** Necesidades que este recurso sabe cubrir, p. ej. ["triaje", "evacuacion"]. */
  capabilities: string[];
  /** Base desde la que se despliega, para calcular distancia a una zona. */
  homeZoneId: string | null;
  assignedAt: string | null;
}

// ---------------------------------------------------------------------------
// Contactos y escalado
// ---------------------------------------------------------------------------

export type ContactRole =
  | "field-coordinator"
  | "medical-lead"
  | "public-safety"
  | "volunteer"
  | "operations-lead"
  | "authority";

export interface Contact {
  id: string;
  name: string;
  role: ContactRole;
  zoneId: string | null;
  /** Canales por orden de preferencia. */
  channels: ActionChannel[];
  phone: string | null;
  email: string | null;
  /** Solo los contactos marcados como seguros pueden recibir acciones reales. */
  demoSafe: boolean;
  lastContactedAt: string | null;
  /** 0..1, tasa de respuesta observada. Se actualiza con el historial. */
  responsiveness: number;
}

export interface EscalationStep {
  order: number;
  contactId: string;
  channel: ActionChannel;
  /** Segundos a esperar sin respuesta antes de pasar al siguiente escalon. */
  waitSeconds: number;
  reason: string;
  actionId: string | null;
}

export interface EscalationChain {
  id: string;
  objective: string;
  zoneId: string;
  steps: EscalationStep[];
  currentStep: number;
  status: "active" | "satisfied" | "exhausted" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export interface Action {
  id: string;
  channel: ActionChannel;
  /** Descripcion legible del destinatario. */
  target: string;
  objective: string;
  status: ActionStatus;
  reason: string;
  zoneId: string;
  resourceId?: string;
  contactId?: string;
  chainId?: string;
  externalActionId?: string;
  executionMode: ExecutionMode;
  error?: string;
  /** Resumen devuelto por el ejecutor externo. */
  result?: string;
  /** Numero de intento, empieza en 1. Forma parte de la clave de idempotencia. */
  attempt: number;
  idempotencyKey: string;
  /** Momento a partir del cual una accion en curso se considera atascada. */
  stalledAfter: string | null;
  approvedBy: Actor | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanPriority {
  zoneId: string;
  score: number;
  reason: string;
  /** Desglose de la puntuacion, para poder explicar la decision en la UI. */
  factors: PriorityFactor[];
}

export interface PriorityFactor {
  label: string;
  value: number;
}

export type PlanChangeKind =
  | "priority-up"
  | "priority-down"
  | "action-added"
  | "action-invalidated"
  | "resource-reassigned"
  | "zone-status"
  | "integration";

export interface PlanChange {
  kind: PlanChangeKind;
  label: string;
  detail: string;
}

export interface Plan {
  id: string;
  version: number;
  previousVersion: number | null;
  generatedAt: string;
  summary: string;
  priorities: PlanPriority[];
  proposedActionIds: string[];
  invalidatedActionIds: string[];
  /** Diferencias respecto a la version anterior del plan. */
  changes: PlanChange[];
  /** Por que se replanifico. */
  trigger: string;
}

// ---------------------------------------------------------------------------
// Auditoria e historial
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  kind: string;
  summary: string;
  planVersion: number;
  ref?: string;
}

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

export type DemoKind = "incident" | "resource-down" | "route-blocked" | "integration-failure";

export interface ScenarioBeat {
  id: string;
  atSeconds: number;
  label: string;
  /** Un beat inyecta una senal o dispara una de las averias de demo. */
  event?: IncomingEventPayload;
  demoKind?: DemoKind;
}

export interface ScenarioState {
  id: string;
  name: string;
  description: string;
  running: boolean;
  startedAt: string | null;
  elapsedSeconds: number;
  beats: ScenarioBeat[];
  firedBeatIds: string[];
}

// ---------------------------------------------------------------------------
// Aprendizaje entre ejecuciones
// ---------------------------------------------------------------------------

export interface ChannelStat {
  attempts: number;
  successes: number;
}

export interface LearnedWeights {
  /** Tasa de exito observada por canal, usada para elegir canal. */
  channelStats: Partial<Record<ActionChannel, ChannelStat>>;
  /** Tasa de respuesta observada por contacto. */
  contactStats: Record<string, ChannelStat>;
  /** Ajuste aprendido al peso de las senales sin confirmar. */
  unconfirmedPenalty: number;
  runsAnalyzed: number;
  updatedAt: string | null;
}

export interface RunRecord {
  id: string;
  scenarioId: string;
  startedAt: string;
  endedAt: string | null;
  actionsTotal: number;
  actionsSucceeded: number;
  actionsFailed: number;
  planVersions: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Integracion
// ---------------------------------------------------------------------------

export interface IntegrationState {
  mode: ExecutionMode;
  happyRobotConfigured: boolean;
  lastExternalError: string | null;
  /** Acciones reales ejecutadas en esta sesion, para que la UI no mienta. */
  liveActionsExecuted: number;
  mockActionsExecuted: number;
}

// ---------------------------------------------------------------------------
// Estado completo
// ---------------------------------------------------------------------------

export interface SituationState {
  events: CrisisEvent[];
  zones: CrisisZone[];
  resources: Resource[];
  contacts: Contact[];
  chains: EscalationChain[];
  actions: Action[];
  plan: Plan;
  /** Versiones anteriores del plan, de mas reciente a mas antigua. */
  planHistory: Plan[];
  audit: AuditEntry[];
  scenario: ScenarioState;
  learning: LearnedWeights;
  integration: IntegrationState;
}

// ---------------------------------------------------------------------------
// Payloads de entrada
// ---------------------------------------------------------------------------

export interface IncomingEventPayload {
  source?: EventSource;
  title?: string;
  description?: string;
  zoneId?: string;
  category?: string;
  severity?: Severity;
  confidence?: Confidence;
  confirmed?: boolean | null;
}

export interface CreateActionPayload {
  channel: ActionChannel;
  target: string;
  objective: string;
  reason: string;
  zoneId: string;
  resourceId?: string;
  contactId?: string;
}
