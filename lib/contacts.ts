// PROPIETARIO: agente de integracion HappyRobot, contactos y escalado.
// Modelo de a quien se avisa y por que canal.

import type { ActionChannel, Contact, ContactRole, LearnedWeights } from "./types";

/** Roles que conviene avisar para cada categoria de necesidad, por orden. */
export const roleByCategory: Record<string, ContactRole[]> = {
  incendio: ["field-coordinator", "operations-lead", "authority"],
  evacuacion: ["field-coordinator", "public-safety", "operations-lead"],
  refugio: ["volunteer", "operations-lead"],
  sanitario: ["medical-lead", "operations-lead"],
  triaje: ["medical-lead", "operations-lead"],
  "route-blocked": ["public-safety", "field-coordinator"],
  "resource-shortage": ["operations-lead", "authority"],
  coordinacion: ["operations-lead"]
};

/** Elige el contacto mas adecuado para una zona y categoria. */
export function selectContact(
  contacts: Contact[],
  zoneId: string | null,
  category: string
): Contact | null {
  const roles = roleByCategory[category] ?? ["operations-lead", "field-coordinator"];
  for (const role of roles) {
    const inZone = contacts.find((contact) => contact.role === role && contact.zoneId === zoneId);
    if (inZone) return inZone;
    const anywhere = contacts.find((contact) => contact.role === role);
    if (anywhere) return anywhere;
  }
  return contacts[0] ?? null;
}

/**
 * Canal preferido para un contacto, teniendo en cuenta la urgencia y lo
 * aprendido en ejecuciones anteriores.
 */
export function selectChannel(
  contact: Contact,
  urgent: boolean,
  learning?: LearnedWeights
): ActionChannel {
  void learning;
  if (urgent && contact.channels.includes("call")) return "call";
  return contact.channels[0] ?? "email";
}

/** Un contacto solo puede recibir ejecucion real si esta aprobado para demo. */
export function canReceiveLiveAction(contact: Contact): boolean {
  return contact.demoSafe && Boolean(contact.phone ?? contact.email);
}
