// Etiquetas y utilidades compartidas por los paneles del centro de mando.
// Todo el texto visible de la interfaz vive aqui o en el componente que lo usa,
// siempre en espanol correcto y con acentos.

import type {
  Action,
  ActionChannel,
  Actor,
  Confidence,
  Contact,
  ContactRole,
  CrisisEvent,
  EscalationChain,
  PlanChangeKind,
  Resource,
  ScenarioState,
  Severity,
  SituationState,
  ZoneStatus,
} from "@/lib/types";

export const actionStatusLabels: Record<Action["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  running: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
  stalled: "No response",
};

export const channelLabels: Record<ActionChannel, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  ticket: "Ticket",
  webhook: "Webhook",
  whatsapp: "WhatsApp",
  slack: "Slack",
};

export const severityLabels: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const confidenceLabels: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export const zoneStatusLabels: Record<ZoneStatus, string> = {
  stable: "Stable",
  watch: "Watch",
  active: "Active",
  critical: "Critical",
};

export const resourceStatusLabels: Record<Resource["status"], string> = {
  available: "Available",
  assigned: "Assigned",
  unavailable: "Out of service",
};

export const actorLabels: Record<Actor, string> = {
  system: "System",
  operator: "Operator",
  happyrobot: "HappyRobot",
  scenario: "Scenario",
};

export const roleLabels: Record<ContactRole, string> = {
  "field-coordinator": "Field Coordinator",
  "medical-lead": "Medical Lead",
  "public-safety": "Public Safety",
  volunteer: "Volunteer",
  "operations-lead": "Operations Lead",
  authority: "Authority",
};

export const chainStatusLabels: Record<EscalationChain["status"], string> = {
  active: "Escalating",
  satisfied: "Resolved",
  exhausted: "Exhausted",
  cancelled: "Cancelled",
};

export const planChangeLabels: Record<PlanChangeKind, string> = {
  "priority-up": "Priority increased",
  "priority-down": "Priority decreased",
  "action-added": "New action",
  "action-invalidated": "Action invalidated",
  "resource-reassigned": "Resource reassigned",
  "zone-status": "Zone status change",
  integration: "Integration",
};

export const eventSourceLabels: Record<CrisisEvent["source"], string> = {
  happyrobot: "HappyRobot",
  sensor: "Sensor",
  operator: "Operator",
  public: "Citizen report",
  demo: "Demo injector",
  scenario: "Scenario script",
};

export const severityRank: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Estados que mantienen una acción viva en la cola. */
export const openActionStatuses: Action["status"][] = [
  "pending",
  "approved",
  "running",
  "failed",
  "blocked",
  "stalled",
];

/** Estados que exigen que alguien mire la acción ya. */
export const troubledActionStatuses: Action["status"][] = ["failed", "blocked", "stalled"];

export function isOpenAction(action: Action) {
  return openActionStatuses.includes(action.status);
}

export function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

/** "2 min ago" instead of absolute timestamp. */
export function agoLabel(value: string, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function clockLabel(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function contactName(contacts: Contact[], contactId: string | undefined | null) {
  if (!contactId) return null;
  return contacts.find((contact) => contact.id === contactId)?.name ?? contactId;
}

export function resourceName(resources: Resource[], resourceId: string | undefined | null) {
  if (!resourceId) return null;
  return resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;
}

/** Single text for execution mode. */
export function executionLabel(mode: Action["executionMode"]) {
  return mode === "happyrobot" ? "Live execution" : "Simulated";
}

export type RunFn = (label: string, operation: () => Promise<void>) => void;

/**
 * Lector tolerante del estado. Varios campos de SituationState son obligatorios
 * en los tipos pero todavía no los emite el store (otros agentes los están
 * enchufando). La interfaz los muestra cuando llegan y no se rompe mientras no
 * estén.
 */
export function maybe<K extends keyof SituationState>(
  situation: SituationState,
  key: K,
): SituationState[K] | undefined {
  return (situation as Partial<SituationState>)[key];
}

/** Datos de ejecución del guion (velocidad, pausa) si el motor los publica. */
export interface ScenarioRuntimeView {
  scriptId?: string;
  speed?: number;
  paused?: boolean;
}

export function scenarioRuntime(scenario: ScenarioState): ScenarioRuntimeView | undefined {
  return (scenario as ScenarioState & { runtime?: ScenarioRuntimeView }).runtime;
}
