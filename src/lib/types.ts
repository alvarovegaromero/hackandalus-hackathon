// Shared crisis command center types.
// This file is the boundary between modules: each agent implements its module
// against these types. Do not edit without notifying all affected modules.

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
// Signals
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
  /** null = unverified, true = confirmed, false = discarded. */
  confirmed: boolean | null;
  dedupeKey: string;
  /** How many equivalent signals have been merged into this one. */
  occurrences: number;
  /** Effect that this signal applied to its zone, to be able to revert it when discarded. */
  appliedRiskDelta: number;
  /** Need that this signal added to the zone, or null if none was added. */
  appliedNeed: string | null;
  /** Zone status before this signal modified it. */
  previousZoneStatus: ZoneStatus | null;
  /** Calibrated triage. Optional: older signals do not have it. */
  assessment?: SignalAssessment;
  /** Open verification action to resolve uncertainty about this signal. */
  verificationActionId?: string;
}

export interface CrisisZone {
  id: string;
  name: string;
  status: ZoneStatus;
  populationAtRisk: number;
  /** Base risk of the zone, without counting active signals. */
  riskScore: number;
  needs: string[];
  /** x/y (0-100) locate the zone in the regional scheme; lat/lng on the tactical map. */
  coordinates: { x: number; y: number; lat: number; lng: number };
  lastUpdatedAt: string;
  /** Vulnerable sites in the zone: nursing homes, schools, campsites. */
  vulnerableSites?: VulnerableSite[];
  /** Estimated minutes until damage reaches the zone. null = unknown. */
  minutesToImpact?: number | null;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface Resource {
  id: string;
  name: string;
  type: string;
  capacity: number;
  status: ResourceStatus;
  zoneId: string | null;
  assignedActionId: string | null;
  /** Needs that this resource can cover, e.g. ["triage", "evacuation"]. */
  capabilities: string[];
  /** Base from which it deploys, to calculate distance to a zone. */
  homeZoneId: string | null;
  assignedAt: string | null;
}

// ---------------------------------------------------------------------------
// Contacts and escalation
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
  /** Channels in order of preference. */
  channels: ActionChannel[];
  phone: string | null;
  email: string | null;
  /** Only contacts marked as safe can receive real actions. */
  demoSafe: boolean;
  lastContactedAt: string | null;
  /** 0..1, observed response rate. Updated with history. */
  responsiveness: number;
}

export interface EscalationStep {
  order: number;
  contactId: string;
  channel: ActionChannel;
  /** Seconds to wait without response before proceeding to the next step. */
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
// Actions
// ---------------------------------------------------------------------------

export interface Action {
  id: string;
  channel: ActionChannel;
  /** Human-readable description of the recipient. */
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
  /** Summary returned by the external executor. */
  result?: string;
  /** Attempt number, starts at 1. Part of the idempotency key. */
  attempt: number;
  idempotencyKey: string;
  /** Time after which an in-progress action is considered stalled. */
  stalledAfter: string | null;
  approvedBy: Actor | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Action type for autonomy purposes, e.g. "verify" or "evacuate". */
  actionKind?: ActionKind;
  /** Autonomy level with which it was dispatched or will be dispatched. */
  autonomy?: AutonomyLevel;
  /** Signal whose uncertainty this verification action aims to resolve. */
  verifiesEventId?: string;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanPriority {
  zoneId: string;
  score: number;
  reason: string;
  /** Score breakdown, to explain the decision in the UI. */
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
  /** Differences compared to the previous version of the plan. */
  changes: PlanChange[];
  /** Reason why it was replanned. */
  trigger: string;
  /** What this plan depends on to remain valid. */
  assumptions?: Assumption[];
  /** false when an assumption is broken and the plan has not yet been remade. */
  valid?: boolean;
  /** Which assumption invalidated it. */
  invalidatedReason?: string | null;
}

// ---------------------------------------------------------------------------
// Audit and history
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
// Scenario
// ---------------------------------------------------------------------------

export type DemoKind = "incident" | "resource-down" | "route-blocked" | "integration-failure";

export interface ScenarioBeat {
  id: string;
  atSeconds: number;
  label: string;
  /** A beat injects a signal or triggers one of the demo breakdowns. */
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
// Cross-run learning
// ---------------------------------------------------------------------------

export interface ChannelStat {
  attempts: number;
  successes: number;
}

export interface LearnedWeights {
  /** Observed success rate by channel, used to select channel. */
  channelStats: Partial<Record<ActionChannel, ChannelStat>>;
  /** Observed response rate by contact. */
  contactStats: Record<string, ChannelStat>;
  /** Learned adjustment to the weight of unconfirmed signals. */
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
// Integration
// ---------------------------------------------------------------------------

export interface IntegrationState {
  mode: ExecutionMode;
  happyRobotConfigured: boolean;
  lastExternalError: string | null;
  /** Real actions executed in this session, so the UI does not lie. */
  liveActionsExecuted: number;
  mockActionsExecuted: number;
}

// ---------------------------------------------------------------------------
// Calibrated triage
//
// The challenge rewards deciding without having all data. Instead of a confidence
// label, each signal emerges from triage with probabilities and a three-way
// decision. The middle band does not wait: it generates a verification action,
// because verifying is also acting.
// ---------------------------------------------------------------------------

export type TriageDecision = "act" | "verify" | "discard";
export type Assessor = "deterministic" | "jev" | "llm" | "operator";

export interface SignalAssessment {
  /** Probability that the signal is relevant to the crisis. */
  pRelevant: number;
  /** Probability that what it reports is true. */
  pTruthful: number;
  /** Estimated urgency, 0 to 1. */
  urgency: number;
  /** Fused confidence, already combining independent sources. */
  confidence: number;
  decision: TriageDecision;
  /** Reason for the decision, in a human-readable line. */
  rationale: string;
  /** Who evaluated. The deterministic engine is the always-available fallback. */
  assessedBy: Assessor;
  /** Source reliability applied during assessment, 0 to 1. */
  sourceReliability: number;
  assessedAt: string;
}

/** Learned reliability by source, basis for confidence fusion. */
export interface SourceReliability {
  source: EventSource;
  reliability: number;
  observations: number;
  confirmed: number;
}

// ---------------------------------------------------------------------------
// Vulnerability
// ---------------------------------------------------------------------------

export type VulnerabilityKind =
  "residencia" | "colegio" | "camping" | "hospital" | "urbanizacion" | "nucleo";

export interface VulnerableSite {
  id: string;
  name: string;
  kind: VulnerabilityKind;
  people: number;
  /** Priority multiplier: a nursing home weighs more than a residential area. */
  multiplier: number;
  evacuated: boolean;
}

// ---------------------------------------------------------------------------
// Live assumptions
//
// Each plan declares what it depends on. When the world changes and breaks an
// assumption, the plan ceases to be valid and must be remade. This is the direct
// answer to the challenge question about when to discard the plan.
// ---------------------------------------------------------------------------

export type AssumptionStatus = "ok" | "broken" | "unknown";

export interface Assumption {
  id: string;
  /** Human-readable text: "The wind continues blowing from the northeast". */
  text: string;
  /** World variable being monitored, e.g. "wind.direction". */
  variable: string;
  /** Condition that must be met for the assumption to hold. */
  condition: string;
  status: AssumptionStatus;
  brokenByEventId: string | null;
  brokenAt: string | null;
  /** Version of the plan that declared it. */
  planVersion: number;
}

/**
 * Simulated world state against which assumptions are verified.
 * This is what the scenario engine moves and what breaks plans.
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
// Digital twin
//
// The scenario maintains a simulated truth, but FARO must not act as if
// it knew it by magic. The digital twin is the snapshot that FARO reconstructs
// from signals and evidence, plus metrics on how closely it matches the demo's
// hidden truth.
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
// Graduated autonomy
//
// A system that asks permission for everything is not agentic, and one that asks
// for nothing is not supervisable. The level depends on whether the action can be
// undone.
// ---------------------------------------------------------------------------

export type AutonomyLevel = "auto" | "auto-notify" | "approval";
export type Reversibility = "reversible" | "partial" | "irreversible";
export type ActionKind =
  "verificar" | "avisar" | "asignar-recurso" | "aviso-masivo" | "evacuar" | "escalar";

export interface AutonomyRule {
  actionKind: ActionKind;
  reversibility: Reversibility;
  level: AutonomyLevel;
  /** Minimum confidence to automate. Below this, requests approval. */
  confidenceThreshold?: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Opportunity cost
//
// Distributing scarce resources leaves someone waiting. Showing who, how long,
// and why is what turns an allocation into a defensible decision.
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
// Cross-run lessons
// ---------------------------------------------------------------------------

export interface Lesson {
  id: string;
  runId: string;
  /** Pattern observed in the previous run. */
  pattern: string;
  /** Proposed behavior change. */
  change: string;
  /** Justifying metric. Without a metric there is no lesson. */
  metric: string;
  /** Lessons are validated by a human before being applied. */
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Complete situation state
// ---------------------------------------------------------------------------

export interface SituationState {
  events: CrisisEvent[];
  zones: CrisisZone[];
  resources: Resource[];
  contacts: Contact[];
  chains: EscalationChain[];
  actions: Action[];
  plan: Plan;
  /** Previous plan versions, from newest to oldest. */
  planHistory: Plan[];
  audit: AuditEntry[];
  scenario: ScenarioState;
  learning: LearnedWeights;
  integration: IntegrationState;
  /** Simulated world state that breaks plan assumptions. */
  world: WorldState;
  /** Digital twin reconstructed from signals and compared against simulated world. */
  digitalTwin: DigitalTwinState;
  /** Active autonomy rules. */
  autonomyRules: AutonomyRule[];
  /** Master switch: a human can pause autonomy live. */
  autonomyPaused: boolean;
  /** Who is left waiting for a resource and why. */
  waiting: WaitingDemand[];
  /** Learned reliability by information source. */
  sourceReliability: SourceReliability[];
  /** Lessons proposed by previous runs, pending validation. */
  lessons: Lesson[];
}

// ---------------------------------------------------------------------------
// Inbound payloads
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
