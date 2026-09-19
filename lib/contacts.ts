// PROPIETARIO: agente de integración HappyRobot, contactos y escalado.
// Modelo de a quién se avisa, por qué canal y qué se le cuenta.
//
// El reto pregunta literalmente "quién es avisado, qué se le cuenta y en qué
// orden". Un vecino, un bombero y un responsable político no necesitan lo
// mismo: aquí viven la selección de contacto, la elección de canal y el
// briefing específico de cada rol.

import type { ActionChannel, Contact, ContactRole, LearnedWeights } from "./types";

// ---------------------------------------------------------------------------
// Categorias -> roles
// ---------------------------------------------------------------------------

/** Roles que conviene avisar para cada categoría de necesidad, por orden. */
export const roleByCategory: Record<string, ContactRole[]> = {
  incendio: ["field-coordinator", "operations-lead", "authority"],
  evacuacion: ["field-coordinator", "public-safety", "operations-lead"],
  refugio: ["volunteer", "operations-lead"],
  sanitario: ["medical-lead", "operations-lead"],
  triaje: ["medical-lead", "operations-lead"],
  "route-blocked": ["public-safety", "field-coordinator", "operations-lead"],
  "resource-shortage": ["operations-lead", "authority"],
  coordinacion: ["operations-lead", "authority"],
  "alerta-publica": ["public-safety", "operations-lead", "authority"],
  integracion: ["operations-lead"],
};

/**
 * Sinónimos y variantes (español/inglés, con y sin guiones) que llegan desde
 * las señales de escenario, la demo y los callbacks de HappyRobot.
 */
const categoryAliases: Record<string, keyof typeof roleByCategory> = {
  fire: "incendio",
  wildfire: "incendio",
  "forest-fire": "incendio",
  "fire-front": "incendio",
  "evaluacion-de-monte": "incendio",
  evacuation: "evacuacion",
  "evacuation-support": "evacuacion",
  "evacuacion-asistida": "evacuacion",
  shelter: "refugio",
  "shelter-overflow": "refugio",
  "refugio-saturado": "refugio",
  medical: "sanitario",
  health: "sanitario",
  "medical-support": "sanitario",
  triage: "triaje",
  "triaje-sanitario": "triaje",
  road: "route-blocked",
  "road-blocked": "route-blocked",
  "ruta-bloqueada": "route-blocked",
  "vigilancia-de-rutas": "route-blocked",
  "resource-down": "resource-shortage",
  "falta-de-recursos": "resource-shortage",
  operations: "coordinacion",
  coordination: "coordinacion",
  "enlace-logistico": "coordinacion",
  "public-alert": "alerta-publica",
  "alerta-publica": "alerta-publica",
  "capacidad-de-refugios": "refugio",
  "integration-failure": "integracion",
  "fallo-de-integracion": "integracion",
};

/** Normaliza una categoría: minúsculas, sin acentos y con guiones. */
export function normalizeCategory(category: string): string {
  return category
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
}

/** Roles preferentes para una categoría, del más directo al más institucional. */
export function rolesForCategory(category: string): ContactRole[] {
  const key = normalizeCategory(category);
  const direct = roleByCategory[key];
  if (direct) return direct;
  const alias = categoryAliases[key];
  if (alias && roleByCategory[alias]) return roleByCategory[alias];
  // Coincidencia parcial: "evacuacion-costa" sigue siendo evacuacion.
  for (const known of Object.keys(roleByCategory)) {
    if (key.includes(known) || known.includes(key)) return roleByCategory[known];
  }
  return ["operations-lead", "field-coordinator", "authority"];
}

// ---------------------------------------------------------------------------
// Selección de contacto
// ---------------------------------------------------------------------------

export interface RankedContact {
  contact: Contact;
  score: number;
  reason: string;
}

function successRate(stat: { attempts: number; successes: number } | undefined): number | null {
  if (!stat || stat.attempts === 0) return null;
  return stat.successes / stat.attempts;
}

/**
 * Ordena los contactos para una zona y categoría. La puntuación combina el
 * rol adecuado, la cercanía a la zona, la capacidad de respuesta observada y
 * lo aprendido en ejecuciones anteriores.
 */
export function rankContacts(
  contacts: Contact[],
  zoneId: string | null,
  category: string,
  learning?: LearnedWeights,
): RankedContact[] {
  const roles = rolesForCategory(category);

  return contacts
    .map((contact) => {
      const roleIndex = roles.indexOf(contact.role);
      const motivos: string[] = [];
      let score = 0;

      if (roleIndex >= 0) {
        score += 100 - roleIndex * 22;
        motivos.push(
          `rol ${contact.role} en posición ${roleIndex + 1} para ${normalizeCategory(category)}`,
        );
      } else {
        score += 8;
        motivos.push(`rol ${contact.role} sin encaje directo con la categoría`);
      }

      if (zoneId && contact.zoneId === zoneId) {
        score += 28;
        motivos.push("está desplegado en la zona afectada");
      } else if (contact.zoneId === null) {
        score += 12;
        motivos.push("cobertura regional, no atado a una zona");
      }

      score += contact.responsiveness * 20;
      motivos.push(
        `capacidad de respuesta histórica ${(contact.responsiveness * 100).toFixed(0)}%`,
      );

      const learned = successRate(learning?.contactStats[contact.id]);
      if (learned !== null) {
        score += learned * 18;
        motivos.push(`tasa de éxito aprendida ${(learned * 100).toFixed(0)}%`);
      }

      if (canReceiveLiveAction(contact)) {
        // Desempate suave: si dos contactos valen igual, preferimos al que
        // puede recibir ejecución real y no obliga a degradar a simulación.
        score += 6;
        motivos.push("aprobado para ejecución real de demo");
      }

      return { contact, score, reason: motivos.join("; ") };
    })
    .sort((a, b) => b.score - a.score);
}

/** Elige el contacto más adecuado para una zona y categoría. */
export function selectContact(
  contacts: Contact[],
  zoneId: string | null,
  category: string,
  learning?: LearnedWeights,
): Contact | null {
  if (contacts.length === 0) return null;
  return rankContacts(contacts, zoneId, category, learning)[0]?.contact ?? null;
}

/** Elige el mejor contacto de un rol concreto, preferiblemente en la zona. */
export function selectContactByRole(
  contacts: Contact[],
  zoneId: string | null,
  role: ContactRole,
  learning?: LearnedWeights,
  excludeIds: string[] = [],
): Contact | null {
  const candidates = contacts.filter(
    (contact) => contact.role === role && !excludeIds.includes(contact.id),
  );
  if (candidates.length === 0) return null;
  const inZone = candidates.filter((contact) => contact.zoneId === zoneId);
  const pool = inZone.length > 0 ? inZone : candidates;
  return (
    pool.slice().sort((a, b) => {
      const learnedA = successRate(learning?.contactStats[a.id]) ?? a.responsiveness;
      const learnedB = successRate(learning?.contactStats[b.id]) ?? b.responsiveness;
      return learnedB - learnedA;
    })[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Selección de canal
// ---------------------------------------------------------------------------

/** Valor de cada canal cuando hay que interrumpir a alguien ya. */
const urgentChannelScore: Record<ActionChannel, number> = {
  call: 100,
  sms: 78,
  whatsapp: 72,
  slack: 55,
  email: 32,
  ticket: 25,
  webhook: 12,
};

/** Valor de cada canal cuando lo importante es dejar constancia escrita. */
const calmChannelScore: Record<ActionChannel, number> = {
  email: 82,
  slack: 72,
  ticket: 62,
  sms: 58,
  whatsapp: 52,
  call: 38,
  webhook: 15,
};

/**
 * Sesgo por rol: a un voluntario o a un vecino se le manda un mensaje corto,
 * a un coordinador de campo se le llama, y a una autoridad se le deja algo
 * escrito que pueda reenviar.
 */
const roleChannelBias: Record<ContactRole, Partial<Record<ActionChannel, number>>> = {
  "field-coordinator": { call: 25, sms: 5 },
  "medical-lead": { call: 20, sms: 8 },
  "public-safety": { sms: 15, call: 12 },
  volunteer: { sms: 25, whatsapp: 22, call: -20 },
  "operations-lead": { slack: 18, call: 10, email: 8 },
  authority: { email: 25, slack: 10, call: -12 },
};

export interface ChannelChoice {
  channel: ActionChannel;
  reason: string;
}

/**
 * Canal preferido para un contacto, teniendo en cuenta la urgencia, el orden
 * de preferencia declarado, el rol y lo aprendido en ejecuciones anteriores.
 */
export function selectChannelWithReason(
  contact: Contact,
  urgent: boolean,
  learning?: LearnedWeights,
): ChannelChoice {
  const available = contact.channels.filter((channel) => Boolean(channel));
  if (available.length === 0) {
    return {
      channel: contact.email ? "email" : "ticket",
      reason: "El contacto no declara canales; se usa el de respaldo.",
    };
  }

  const base = urgent ? urgentChannelScore : calmChannelScore;
  const bias = roleChannelBias[contact.role] ?? {};

  const scored = available.map((channel, index) => {
    const motivos: string[] = [];
    let score = base[channel] ?? 20;
    motivos.push(urgent ? "urgencia alta" : "sin urgencia inmediata");

    const preference = Math.max(0, 20 - index * 6);
    score += preference;
    if (index === 0) motivos.push("es su canal preferido");

    const roleBias = bias[channel] ?? 0;
    score += roleBias;
    if (roleBias !== 0) motivos.push(`ajuste por rol ${contact.role}`);

    const learned = successRate(learning?.channelStats[channel]);
    if (learned !== null) {
      score += learned * 30 - 10;
      motivos.push(`éxito histórico del canal ${(learned * 100).toFixed(0)}%`);
    }

    if (channel === "call" || channel === "sms" || channel === "whatsapp") {
      if (!contact.phone) {
        score -= 40;
        motivos.push("sin teléfono registrado");
      }
    }
    if (channel === "email" && !contact.email) {
      score -= 40;
      motivos.push("sin correo registrado");
    }

    return { channel, score, reason: motivos.join(", ") };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0];
  return { channel: best.channel, reason: best.reason };
}

/** Version compacta usada por el store. */
export function selectChannel(
  contact: Contact,
  urgent: boolean,
  learning?: LearnedWeights,
): ActionChannel {
  return selectChannelWithReason(contact, urgent, learning).channel;
}

// ---------------------------------------------------------------------------
// Salvaguarda de demo
// ---------------------------------------------------------------------------

/**
 * true si el dato de contacto sirve para llamar o escribir de verdad.
 * La persistencia redacta teléfonos y correos antes de tocar disco, así que un
 * estado restaurado puede traer marcadores como "[teléfono omitido]": eso no
 * es un destinatario, y darlo por bueno sería mandar una llamada a la nada.
 */
export function isUsableDestination(value: string | null | undefined): boolean {
  if (!value) return false;
  const limpio = value.trim();
  if (limpio.length < 5) return false;
  if (limpio.includes("[") || /omitid/i.test(limpio)) return false;
  const esCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio);
  const esTelefono = /^\+?[\d\s().-]{7,}$/.test(limpio);
  return esCorreo || esTelefono;
}

/** Un contacto solo puede recibir ejecución real si está aprobado para demo. */
export function canReceiveLiveAction(contact: Contact): boolean {
  return (
    contact.demoSafe && (isUsableDestination(contact.phone) || isUsableDestination(contact.email))
  );
}

/** Explica en castellano por qué un contacto no puede recibir acción real. */
export function liveActionBlockReason(contact: Contact | null): string | null {
  if (!contact) {
    return "la acción no tiene contacto asignado y ningún destinatario está aprobado para la demo";
  }
  if (!contact.demoSafe) {
    return `el contacto "${contact.name}" no está marcado como aprobado para la demo (demoSafe)`;
  }
  if (!isUsableDestination(contact.phone) && !isUsableDestination(contact.email)) {
    return `el contacto "${contact.name}" no tiene un teléfono ni un correo utilizables`;
  }
  return null;
}

/** Destinatario concreto para un canal, o null si ese canal no es utilizable. */
export function contactDestination(contact: Contact, channel: ActionChannel): string | null {
  if (channel === "call" || channel === "sms" || channel === "whatsapp") {
    return isUsableDestination(contact.phone) ? contact.phone : null;
  }
  if (channel === "email") return isUsableDestination(contact.email) ? contact.email : null;
  // slack, ticket y webhook se resuelven en HappyRobot con el id del contacto.
  return contact.id;
}

// ---------------------------------------------------------------------------
// Qué se le cuenta a cada rol
// ---------------------------------------------------------------------------

export interface BriefingInput {
  objective: string;
  zoneName: string;
  reason: string;
  urgent: boolean;
}

export interface Briefing {
  /** Frase de apertura: qué ocurre y por qué le llamamos a él. */
  headline: string;
  /** Detalle útil para ese rol concreto. */
  detail: string;
  /** Qué necesitamos de vuelta: esto alimenta el bucle de nueva información. */
  askFor: string;
}

/**
 * Mensaje adaptado al rol. El objetivo operativo es el mismo, pero el nivel de
 * detalle, el tono y lo que se pide de vuelta cambian por completo.
 */
export function briefingForRole(role: ContactRole, input: BriefingInput): Briefing {
  const urgencia = input.urgent ? "Prioridad inmediata" : "Prioridad alta";

  switch (role) {
    case "field-coordinator":
      return {
        headline: `${urgencia}: coordinación de campo en ${input.zoneName}.`,
        detail: `${input.objective} Motivo del cambio de plan: ${input.reason}`,
        askFor:
          "Confirma si tu equipo puede asumirlo ahora, con qué medios y si hay accesos cortados.",
      };
    case "medical-lead":
      return {
        headline: `${urgencia}: apoyo sanitario en ${input.zoneName}.`,
        detail: `${input.objective} Contexto: ${input.reason}`,
        askFor: "Indica capacidad de triaje disponible, camas libres y tiempo estimado de llegada.",
      };
    case "public-safety":
      return {
        headline: `${urgencia}: seguridad y accesos en ${input.zoneName}.`,
        detail: `${input.objective} Contexto: ${input.reason}`,
        askFor: "Confirma qué viales quedan abiertos y si hace falta corte o desvío.",
      };
    case "volunteer":
      return {
        headline: `Aviso de ${input.zoneName}.`,
        // A un voluntario o vecino se le dan instrucciones, no analisis.
        detail: `${input.objective} Sigue las indicaciones del punto de encuentro y no te desplaces por tu cuenta.`,
        askFor: "Responde OK si puedes acudir, o NO si no estás disponible.",
      };
    case "operations-lead":
      return {
        headline: `${urgencia}: decisión operativa pendiente en ${input.zoneName}.`,
        detail: `${input.objective} El plan ha cambiado porque: ${input.reason}`,
        askFor: "Autoriza el reparto de recursos propuesto o indica qué prioridad prefieres.",
      };
    case "authority":
      return {
        headline: `Escalado institucional por ${input.zoneName}.`,
        detail: `${input.objective} Los escalones previos no han respondido a tiempo. Motivo: ${input.reason}`,
        askFor:
          "Se solicita respaldo para movilizar medios adicionales o declarar el nivel superior.",
      };
    default:
      return {
        headline: `${urgencia}: ${input.zoneName}.`,
        detail: `${input.objective} Motivo: ${input.reason}`,
        askFor: "Confirma recepción y estado actual.",
      };
  }
}
