// OWNER: HappyRobot integration, contacts, and escalation agent.
// Escalation chains: who is notified first and what happens if they don't answer.
//
// The challenge requires "a chain of actions toward an objective, not an
// isolated action": this module constructs that chain. First the most direct
// channel with someone on the ground, then a different role, and finally the
// authority. Each step explicitly states why it exists.

import {
  briefingForRole,
  canReceiveLiveAction,
  rolesForCategory,
  selectChannelWithReason,
  selectContact,
  selectContactByRole,
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

/** Default wait time at each step, in seconds. */
const WAIT_URGENT = 90;
const WAIT_NORMAL = 180;
/** Maximum number of steps: more than four is unworkable in a real crisis. */
const MAX_STEPS = 4;

/**
 * How long to wait on a step before moving to the next. An unreliable
 * contact should not stall the chain for too long.
 */
function waitFor(contact: Contact, urgent: boolean, order: number): number {
  const base = urgent ? WAIT_URGENT : WAIT_NORMAL;
  const fiabilidad = Math.min(1, Math.max(0, contact.responsiveness));
  // Between 60% and 100% of base wait, plus incremental time per step.
  const ajustado = Math.round(base * (0.6 + fiabilidad * 0.4)) + (order - 1) * 15;
  return Math.max(30, ajustado);
}

/**
 * Builds the escalation chain for an objective: first contact via most
 * direct channel, and successive steps if there is no response.
 */
export function buildEscalationChain(input: BuildChainInput): EscalationChain {
  const steps: EscalationStep[] = [];
  const usados: string[] = [];

  const push = (contact: Contact, motivo: string) => {
    if (steps.length >= MAX_STEPS) return;
    if (usados.includes(contact.id)) return;
    const order = steps.length + 1;
    // First step seeks immediate response; subsequent steps assume direct
    // channel failed and prioritize written record.
    const urgenteEnEsteEscalon = input.urgent && order <= 2;
    const canal = selectChannelWithReason(contact, urgenteEnEsteEscalon, input.learning);
    const briefing = briefingForRole(contact.role, {
      objective: input.objective,
      zoneName: input.zoneId,
      reason: motivo,
      urgent: urgenteEnEsteEscalon,
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
      actionId: null,
    });
  };

  // Step 1: closest to the problem, via most direct channel.
  const primero = selectContact(input.contacts, input.zoneId, input.category, input.learning);
  if (primero) {
    push(
      primero,
      `es el contacto más adecuado para ${input.category} en la zona y puede actuar sobre el terreno.`,
    );
  }

  // Intermediate steps: other relevant roles for the same category, to avoid
  // pinging the same person twice for the same reason.
  for (const role of rolesForCategory(input.category)) {
    if (steps.length >= MAX_STEPS - 1) break;
    const candidato = selectContactByRole(
      input.contacts,
      input.zoneId,
      role,
      input.learning,
      usados,
    );
    if (!candidato) continue;
    push(
      candidato,
      `el escalón anterior no respondió a tiempo y el rol ${role} puede resolverlo por otra vía.`,
    );
  }

  // Penultimate resource: operations room, which can reallocate resources.
  if (steps.length < MAX_STEPS) {
    const operaciones = selectContactByRole(
      input.contacts,
      null,
      "operations-lead",
      input.learning,
      usados,
    );
    if (operaciones) {
      push(operaciones, "nadie sobre el terreno ha confirmado y hace falta reasignar medios.");
    }
  }

  // Final step: authority, always in writing with audit traceability.
  const autoridad = selectContactByRole(input.contacts, null, "authority", input.learning, usados);
  if (autoridad) {
    if (steps.length >= MAX_STEPS) steps.pop();
    push(
      autoridad,
      "la cadena operativa se ha agotado sin respuesta y el caso requiere respaldo institucional.",
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
    updatedAt: input.at,
  };
}

/** Returns the next pending step, or null if chain is exhausted. */
export function nextStep(chain: EscalationChain): EscalationStep | null {
  return chain.steps[chain.currentStep] ?? null;
}

/** Advances chain after a failed or timed-out attempt. */
export function advanceChain(chain: EscalationChain, at: string): EscalationChain {
  chain.currentStep += 1;
  chain.status = chain.currentStep >= chain.steps.length ? "exhausted" : "active";
  chain.updatedAt = at;
  return chain;
}

/** Closes chain because someone responded. */
export function satisfyChain(chain: EscalationChain, at: string): EscalationChain {
  chain.status = "satisfied";
  chain.updatedAt = at;
  return chain;
}

/**
 * true if current step has exceeded wait time and it is time to escalate.
 * Calculated against updatedAt: each advance resets step clock.
 */
export function isStepOverdue(chain: EscalationChain, now: number): boolean {
  const step = nextStep(chain);
  if (!step || chain.status !== "active") return false;
  return now - new Date(chain.updatedAt).getTime() >= step.waitSeconds * 1000;
}

/** Readable summary of chain for UI and audit logs. */
export function describeChain(chain: EscalationChain, contacts: Contact[]): string {
  if (chain.steps.length === 0) return "Sin cadena de escalado.";
  return chain.steps
    .map((step) => {
      const contacto = contacts.find((candidate) => candidate.id === step.contactId);
      return `${step.order}. ${contacto?.name ?? step.contactId} por ${step.channel} (espera ${step.waitSeconds}s)`;
    })
    .join(" -> ");
}
