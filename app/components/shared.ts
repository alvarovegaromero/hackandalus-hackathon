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
  ZoneStatus
} from "@/lib/types";

export const actionStatusLabels: Record<Action["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  running: "En curso",
  succeeded: "Completada",
  failed: "Fallida",
  blocked: "Bloqueada",
  cancelled: "Cancelada",
  stalled: "Sin respuesta"
};

export const channelLabels: Record<ActionChannel, string> = {
  call: "Llamada",
  sms: "SMS",
  email: "Correo",
  ticket: "Ticket",
  webhook: "Webhook",
  whatsapp: "WhatsApp",
  slack: "Slack"
};

export const severityLabels: Record<Severity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica"
};

export const confidenceLabels: Record<Confidence, string> = {
  low: "Confianza baja",
  medium: "Confianza media",
  high: "Confianza alta"
};

export const zoneStatusLabels: Record<ZoneStatus, string> = {
  stable: "Estable",
  watch: "Vigilancia",
  active: "Activa",
  critical: "Crítica"
};

export const resourceStatusLabels: Record<Resource["status"], string> = {
  available: "Disponible",
  assigned: "Asignado",
  unavailable: "Fuera de servicio"
};

export const actorLabels: Record<Actor, string> = {
  system: "Sistema",
  operator: "Operador",
  happyrobot: "HappyRobot",
  scenario: "Escenario"
};

export const roleLabels: Record<ContactRole, string> = {
  "field-coordinator": "Coordinación de campo",
  "medical-lead": "Jefatura sanitaria",
  "public-safety": "Seguridad pública",
  volunteer: "Voluntariado",
  "operations-lead": "Jefatura de operaciones",
  authority: "Autoridad"
};

export const chainStatusLabels: Record<EscalationChain["status"], string> = {
  active: "Escalando",
  satisfied: "Resuelta",
  exhausted: "Agotada",
  cancelled: "Cancelada"
};

export const planChangeLabels: Record<PlanChangeKind, string> = {
  "priority-up": "Sube prioridad",
  "priority-down": "Baja prioridad",
  "action-added": "Nueva acción",
  "action-invalidated": "Acción invalidada",
  "resource-reassigned": "Recurso reasignado",
  "zone-status": "Cambio de zona",
  integration: "Integración"
};

export const eventSourceLabels: Record<CrisisEvent["source"], string> = {
  happyrobot: "HappyRobot",
  sensor: "Sensor",
  operator: "Operador",
  public: "Aviso ciudadano",
  demo: "Inyector de demo",
  scenario: "Guion del escenario"
};

export const severityRank: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

/** Estados que mantienen una acción viva en la cola. */
export const openActionStatuses: Action["status"][] = [
  "pending",
  "approved",
  "running",
  "failed",
  "blocked",
  "stalled"
];

/** Estados que exigen que alguien mire la acción ya. */
export const troubledActionStatuses: Action["status"][] = ["failed", "blocked", "stalled"];

export function isOpenAction(action: Action) {
  return openActionStatuses.includes(action.status);
}

export function timeLabel(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

/** "hace 2 min" en lugar de una marca de tiempo absoluta. */
export function agoLabel(value: string, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
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

/** Texto único para el modo de ejecución: nunca decimos "real" si es simulado. */
export function executionLabel(mode: Action["executionMode"]) {
  return mode === "happyrobot" ? "Ejecución real" : "Simulada";
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
  key: K
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
