// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
// Ajustes aprendidos a partir de ejecuciones anteriores.

import type { Action, LearnedWeights, RunRecord } from "./types";

export function emptyWeights(): LearnedWeights {
  return {
    channelStats: {},
    contactStats: {},
    unconfirmedPenalty: 0,
    runsAnalyzed: 0,
    updatedAt: null
  };
}

/** Incorpora el desenlace de una accion a los pesos aprendidos. */
export function recordActionOutcome(weights: LearnedWeights, action: Action): LearnedWeights {
  const succeeded = action.status === "succeeded";
  const channel = weights.channelStats[action.channel] ?? { attempts: 0, successes: 0 };
  channel.attempts += 1;
  if (succeeded) channel.successes += 1;
  weights.channelStats[action.channel] = channel;

  if (action.contactId) {
    const contact = weights.contactStats[action.contactId] ?? { attempts: 0, successes: 0 };
    contact.attempts += 1;
    if (succeeded) contact.successes += 1;
    weights.contactStats[action.contactId] = contact;
  }

  weights.updatedAt = new Date().toISOString();
  return weights;
}

/** Resume ejecuciones pasadas en pesos aplicables a la actual. */
export function weightsFromRuns(runs: RunRecord[]): LearnedWeights {
  const weights = emptyWeights();
  weights.runsAnalyzed = runs.length;
  return weights;
}

export function channelSuccessRate(weights: LearnedWeights, channel: Action["channel"]): number | null {
  const stat = weights.channelStats[channel];
  if (!stat || stat.attempts === 0) return null;
  return stat.successes / stat.attempts;
}
