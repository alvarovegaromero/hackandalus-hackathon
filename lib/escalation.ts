// PROPIETARIO: agente de integracion HappyRobot, contactos y escalado.
// Cadenas de escalado: quien se avisa primero y que pasa si no contesta.

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

/**
 * Construye la cadena de escalado para un objetivo: primer contacto por el
 * canal mas directo, y escalones sucesivos si no hay respuesta.
 */
export function buildEscalationChain(input: BuildChainInput): EscalationChain {
  const steps: EscalationStep[] = [];
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

/** Devuelve el siguiente escalon pendiente, o null si la cadena esta agotada. */
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

/** Cierra la cadena porque alguien respondio. */
export function satisfyChain(chain: EscalationChain, at: string): EscalationChain {
  chain.status = "satisfied";
  chain.updatedAt = at;
  return chain;
}
