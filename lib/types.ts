export type EventSource = "happyrobot" | "sensor" | "operator" | "public" | "demo";
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
  | "cancelled";
export type ActionChannel = "call" | "sms" | "email" | "ticket" | "webhook";
export type ExecutionMode = "happyrobot" | "mock";

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
  confirmed: boolean | null;
  dedupeKey: string;
}

export interface CrisisZone {
  id: string;
  name: string;
  status: ZoneStatus;
  populationAtRisk: number;
  riskScore: number;
  needs: string[];
  coordinates: { x: number; y: number };
  lastUpdatedAt: string;
}

export interface Resource {
  id: string;
  name: string;
  type: string;
  capacity: number;
  status: ResourceStatus;
  zoneId: string | null;
  assignedActionId: string | null;
}

export interface Action {
  id: string;
  channel: ActionChannel;
  target: string;
  objective: string;
  status: ActionStatus;
  reason: string;
  zoneId: string;
  resourceId?: string;
  externalActionId?: string;
  executionMode: ExecutionMode;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanPriority {
  zoneId: string;
  score: number;
  reason: string;
}

export interface Plan {
  id: string;
  version: number;
  generatedAt: string;
  summary: string;
  priorities: PlanPriority[];
  proposedActionIds: string[];
  invalidatedActionIds: string[];
}

export interface IntegrationState {
  mode: ExecutionMode;
  happyRobotConfigured: boolean;
  lastExternalError: string | null;
}

export interface SituationState {
  events: CrisisEvent[];
  zones: CrisisZone[];
  resources: Resource[];
  actions: Action[];
  plan: Plan;
  integration: IntegrationState;
}

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
}
