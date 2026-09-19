// Tipos compartidos del centro de mando de crisis.
// Este fichero es la frontera entre modulos: cada agente implementa su modulo
// contra estos tipos. No lo edites sin avisar al resto de modulos afectados.

export type EventSource = "happyrobot" | "sensor" | "operator" | "public" | "demo" | "scenario";
export type Severity = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type ZoneStatus = "stable" | "watch" | "active" | "critical";
export type ResourceStatus = "available" | "assigned" | "unavailable";
export type ActionStatus =
  "pending" | "approved" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "stalled";
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
  /** Estado de la zona antes de que esta señal la modificase. */
  previousZoneStatus: ZoneStatus | null;
  /** Triaje calibrado. Opcional: las señales antiguas no lo llevan. */
  assessment?: SignalAssessment;
  /** Acción de verificación abierta para resolver la duda sobre esta señal. */
  verificationActionId?: string;
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
  /** Puntos vulnerables de la zona: residencias, colegios, campings. */
  vulnerableSites?: VulnerableSite[];
  /** Minutos estimados hasta que el daño alcance la zona. null = desconocido. */
  minutesToImpact?: number | null;
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
  /** Tipo de acción a efectos de autonomía, p. ej. "verificar" o "evacuar". */
  actionKind?: ActionKind;
  /** Nivel de autonomía con el que se despachó o se despachará. */
  autonomy?: AutonomyLevel;
  /** Señal cuya duda pretende resolver esta acción de verificación. */
  verifiesEventId?: string;
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
  /** Por qué se replanificó. */
  trigger: string;
  /** De qué depende este plan para seguir siendo válido. */
  assumptions?: Assumption[];
  /** false cuando un supuesto se ha roto y el plan aún no se ha rehecho. */
  valid?: boolean;
  /** Qué supuesto lo invalidó. */
  invalidatedReason?: string | null;
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
// Triaje calibrado
//
// El reto premia decidir sin tener todos los datos. En vez de una etiqueta de
// confianza, cada señal sale del triaje con probabilidades y una decisión de
// tres salidas. La banda intermedia no se queda esperando: genera una acción
// de verificación, porque comprobar también es actuar.
// ---------------------------------------------------------------------------

export type TriageDecision = "act" | "verify" | "discard";
export type Assessor = "deterministic" | "jev" | "llm" | "operator";

export interface SignalAssessment {
  /** Probabilidad de que la señal sea relevante para la crisis. */
  pRelevant: number;
  /** Probabilidad de que lo que cuenta sea cierto. */
  pTruthful: number;
  /** Urgencia estimada, 0 a 1. */
  urgency: number;
  /** Confianza fusionada, ya combinando fuentes independientes. */
  confidence: number;
  decision: TriageDecision;
  /** Por qué se decidió así, en una línea legible. */
  rationale: string;
  /** Quién evaluó. El motor determinista es el respaldo siempre disponible. */
  assessedBy: Assessor;
  /** Fiabilidad de la fuente aplicada al evaluar, 0 a 1. */
  sourceReliability: number;
  assessedAt: string;
}

/** Fiabilidad aprendida por fuente, base de la fusión de confianza. */
export interface SourceReliability {
  source: EventSource;
  reliability: number;
  observations: number;
  confirmed: number;
}

// ---------------------------------------------------------------------------
// Vulnerabilidad
// ---------------------------------------------------------------------------

export type VulnerabilityKind =
  "residencia" | "colegio" | "camping" | "hospital" | "urbanizacion" | "nucleo";

export interface VulnerableSite {
  id: string;
  name: string;
  kind: VulnerabilityKind;
  people: number;
  /** Multiplicador de prioridad: una residencia pesa más que una urbanización. */
  multiplier: number;
  evacuated: boolean;
}

// ---------------------------------------------------------------------------
// Supuestos vivos
//
// Cada plan declara de qué depende. Cuando el mundo cambia y rompe un supuesto,
// el plan deja de ser válido y hay que rehacerlo. Esta es la respuesta directa
// a la pregunta del reto sobre cuándo tirar el plan.
// ---------------------------------------------------------------------------

export type AssumptionStatus = "ok" | "broken" | "unknown";

export interface Assumption {
  id: string;
  /** Texto legible: "El viento sigue soplando del nordeste". */
  text: string;
  /** Variable del mundo que vigila, p. ej. "wind.direction". */
  variable: string;
  /** Condición que debe cumplirse para que el supuesto se sostenga. */
  condition: string;
  status: AssumptionStatus;
  brokenByEventId: string | null;
  brokenAt: string | null;
  /** Versión del plan que lo declaró. */
  planVersion: number;
}

/**
 * Estado del mundo simulado contra el que se contrastan los supuestos.
 * Es lo que el motor de escenario mueve y lo que rompe los planes.
 */
export interface WorldState {
  windDirection: string;
  windSpeedKmh: number;
  blockedRoads: string[];
  smsOperational: boolean;
  voiceOperational: boolean;
  hospitalBeds: Record<string, number>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Gemelo digital
//
// El escenario mantiene una verdad simulada, pero FARO no debe actuar como si
// la conociera por magia. El gemelo digital es la foto que FARO reconstruye a
// partir de señales y evidencia, más métricas de cuánto se parece a la verdad
// oculta de la demo.
// ---------------------------------------------------------------------------

export type DigitalTwinFactStatus = "confirmed" | "inferred" | "unknown" | "stale" | "mismatch";

export interface DigitalTwinFact {
  id: string;
  label: string;
  variable: string;
  perceived: string;
  truth: string;
  confidence: number;
  status: DigitalTwinFactStatus;
  evidenceEventIds: string[];
  updatedAt: string | null;
  impact: string;
}

export interface DigitalTwinState {
  updatedAt: string;
  perceivedWorld: WorldState;
  facts: DigitalTwinFact[];
  accuracy: number;
  confirmedFacts: number;
  unknownFacts: number;
  staleFacts: number;
  mismatches: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Autonomía graduada
//
// Un sistema que pide permiso para todo no es agéntico, y uno que no lo pide
// para nada no es supervisable. El nivel depende de si la acción se puede
// deshacer.
// ---------------------------------------------------------------------------

export type AutonomyLevel = "auto" | "auto-notify" | "approval";
export type Reversibility = "reversible" | "partial" | "irreversible";
export type ActionKind =
  "verificar" | "avisar" | "asignar-recurso" | "aviso-masivo" | "evacuar" | "escalar";

export interface AutonomyRule {
  actionKind: ActionKind;
  reversibility: Reversibility;
  level: AutonomyLevel;
  /** Confianza mínima para automatizar. Por debajo, pide aprobación. */
  confidenceThreshold?: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Coste de oportunidad
//
// Repartir recursos escasos deja a alguien esperando. Enseñar a quién, cuánto
// y por qué es lo que convierte una asignación en una decisión defendible.
// ---------------------------------------------------------------------------

export interface WaitingDemand {
  actionId: string;
  zoneId: string;
  wantedResourceId: string | null;
  blockedByActionId: string | null;
  estimatedWaitMinutes: number | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Lecciones entre ejecuciones
// ---------------------------------------------------------------------------

export interface Lesson {
  id: string;
  runId: string;
  /** Patrón observado en la ejecución anterior. */
  pattern: string;
  /** Cambio de comportamiento que propone. */
  change: string;
  /** Métrica que lo justifica. Sin métrica no hay lección. */
  metric: string;
  /** Las lecciones las valida una persona antes de aplicarse. */
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
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
  /** Estado del mundo simulado que rompe los supuestos del plan. */
  world: WorldState;
  /** Gemelo digital reconstruido desde señales y comparado con el mundo simulado. */
  digitalTwin: DigitalTwinState;
  /** Reglas de autonomía vigentes. */
  autonomyRules: AutonomyRule[];
  /** Interruptor general: una persona puede parar la autonomía en caliente. */
  autonomyPaused: boolean;
  /** Quién se queda esperando un recurso y por qué. */
  waiting: WaitingDemand[];
  /** Fiabilidad aprendida por fuente de información. */
  sourceReliability: SourceReliability[];
  /** Lecciones propuestas por ejecuciones anteriores, pendientes de validar. */
  lessons: Lesson[];
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
