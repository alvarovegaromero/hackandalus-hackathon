// PROPIETARIO: agente de integración HappyRobot, contactos y escalado.
// Cadenas de escalado: quién se avisa primero y qué pasa si no contesta.
//
// El reto exige "una cadena de acciones hacia un objetivo, no una acción
// aislada": aquí se construye esa cadena. Primero el canal más directo con
// quien está sobre el terreno, después un rol distinto, y al final la
// autoridad. Cada escalón lleva escrito por qué existe.

import {
  briefingForRole,
  canReceiveLiveAction,
  rolesForCategory,
  selectChannelWithReason,
  selectContact,
  selectContactByRole
} from "./contacts";
import type { Contact, EscalationChain, EscalationStep, LearnedWeights } from "./types";

export interface BuildChainInput {
  id: string;
  objective: string;
  zoneId: string;
  category: string;
  urgent: boolean;
  contacts: Contact[];
  learning?: LearnedWeights;
  at: string;
}

/** Espera por defecto en cada escalón, en segundos. */
const WAIT_URGENT = 90;
const WAIT_NORMAL = 180;
/** Número máximo de escalones: más de cuatro no se ejecuta en una crisis real. */
const MAX_STEPS = 4;

/**
 * Cuánto se espera a un escalón antes de pasar al siguiente. Un contacto poco
 * fiable no merece que la cadena se quede parada tanto tiempo.
 */
function waitFor(contact: Contact, urgent: boolean, order: number): number {
  const base = urgent ? WAIT_URGENT : WAIT_NORMAL;
  const fiabilidad = Math.min(1, Math.max(0, contact.responsiveness));
  // Entre el 60% y el 100% de la espera base, y algo más en cada escalón.
  const ajustado = Math.round(base * (0.6 + fiabilidad * 0.4)) + (order - 1) * 15;
  return Math.max(30, ajustado);
}

/**
 * Construye la cadena de escalado para un objetivo: primer contacto por el
 * canal más directo, y escalones sucesivos si no hay respuesta.
 */
export function buildEscalationChain(input: BuildChainInput): EscalationChain {
  const steps: EscalationStep[] = [];
  const usados: string[] = [];

  const push = (contact: Contact, motivo: string) => {
    if (steps.length >= MAX_STEPS) return;
    if (usados.includes(contact.id)) return;
    const order = steps.length + 1;
    // El primer escalón busca respuesta inmediata; los siguientes ya asumen
    // que el canal directo ha fallado y priorizan dejar constancia escrita.
    const urgenteEnEsteEscalon = input.urgent && order <= 2;
    const canal = selectChannelWithReason(contact, urgenteEnEsteEscalon, input.learning);
    const briefing = briefingForRole(contact.role, {
      objective: input.objective,
      zoneName: input.zoneId,
      reason: motivo,
      urgent: urgenteEnEsteEscalon
    });
    const salvaguarda = canReceiveLiveAction(contact)
      ? "aprobado para ejecución real"
      : "solo simulación: contacto no aprobado para demo";

    usados.push(contact.id);
    steps.push({
      order,
      contactId: contact.id,
      channel: canal.channel,
      waitSeconds: waitFor(contact, urgenteEnEsteEscalon, order),
      reason: `Escalón ${order}: ${motivo} Canal ${canal.channel} porque ${canal.reason}. Se le pide: ${briefing.askFor} (${salvaguarda}).`,
      actionId: null
    });
  };

  // Escalón 1: quien está más cerca del problema, por el canal más directo.
  const primero = selectContact(input.contacts, input.zoneId, input.category, input.learning);
  if (primero) {
    push(
      primero,
      `es el contacto más adecuado para ${input.category} en la zona y puede actuar sobre el terreno.`
    );
  }

  // Escalones intermedios: otros roles útiles para la misma categoría, para
  // no insistir dos veces a la misma persona por el mismo motivo.
  for (const role of rolesForCategory(input.category)) {
    if (steps.length >= MAX_STEPS - 1) break;
    const candidato = selectContactByRole(input.contacts, input.zoneId, role, input.learning, usados);
    if (!candidato) continue;
    push(
      candidato,
      `el escalón anterior no respondió a tiempo y el rol ${role} puede resolverlo por otra vía.`
    );
  }

  // Penúltimo recurso: la sala de coordinación, que puede reasignar medios.
  if (steps.length < MAX_STEPS) {
    const operaciones = selectContactByRole(input.contacts, null, "operations-lead", input.learning, usados);
    if (operaciones) {
      push(operaciones, "nadie sobre el terreno ha confirmado y hace falta reasignar medios.");
    }
  }

  // Último escalón: la autoridad, siempre por escrito y con trazabilidad.
  const autoridad = selectContactByRole(input.contacts, null, "authority", input.learning, usados);
  if (autoridad) {
    if (steps.length >= MAX_STEPS) steps.pop();
    push(
      autoridad,
      "la cadena operativa se ha agotado sin respuesta y el caso requiere respaldo institucional."
    );
  }

  return {
    id: input.id,
    objective: input.objective,
    zoneId: input.zoneId,
    steps,
    currentStep: 0,
    status: "active",
    createdAt: input.at,
    updatedAt: input.at
  };
}

/** Devuelve el siguiente escalón pendiente, o null si la cadena está agotada. */
export function nextStep(chain: EscalationChain): EscalationStep | null {
  return chain.steps[chain.currentStep] ?? null;
}

/** Avanza la cadena tras un intento fallido o sin respuesta. */
export function advanceChain(chain: EscalationChain, at: string): EscalationChain {
  chain.currentStep += 1;
  chain.status = chain.currentStep >= chain.steps.length ? "exhausted" : "active";
  chain.updatedAt = at;
  return chain;
}

/** Cierra la cadena porque alguien respondió. */
export function satisfyChain(chain: EscalationChain, at: string): EscalationChain {
  chain.status = "satisfied";
  chain.updatedAt = at;
  return chain;
}

/**
 * true si el escalón actual ya agotó su espera y toca subir al siguiente.
 * Se calcula sobre updatedAt: cada avance reinicia el reloj del escalón.
 */
export function isStepOverdue(chain: EscalationChain, now: number): boolean {
  const step = nextStep(chain);
  if (!step || chain.status !== "active") return false;
  return now - new Date(chain.updatedAt).getTime() >= step.waitSeconds * 1000;
}

/** Resumen legible de la cadena para la interfaz y la auditoría. */
export function describeChain(chain: EscalationChain, contacts: Contact[]): string {
  if (chain.steps.length === 0) return "Sin cadena de escalado.";
  return chain.steps
    .map((step) => {
      const contacto = contacts.find((candidate) => candidate.id === step.contactId);
      return `${step.order}. ${contacto?.name ?? step.contactId} por ${step.channel} (espera ${step.waitSeconds}s)`;
    })
    .join(" -> ");
}
