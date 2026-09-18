"use client";

// Intervención humana: un operador crea una acción a mano cuando el sistema
// no ha visto algo o se ha equivocado.

import { useState } from "react";
import { Send, X } from "lucide-react";
import type { ActionChannel, Contact, CreateActionPayload, CrisisZone, Resource } from "@/lib/types";
import { channelLabels, roleLabels } from "./shared";

interface Props {
  zones: CrisisZone[];
  contacts: Contact[];
  resources: Resource[];
  prefillZoneId: string | null;
  busy: boolean;
  onSubmit: (payload: CreateActionPayload) => void;
  onClose: () => void;
}

const channels: ActionChannel[] = ["call", "sms", "whatsapp", "email", "slack", "ticket", "webhook"];

export default function NewActionForm({
  zones,
  contacts,
  resources,
  prefillZoneId,
  busy,
  onSubmit,
  onClose
}: Props) {
  const [zoneId, setZoneId] = useState(prefillZoneId ?? zones[0]?.id ?? "");
  const [channel, setChannel] = useState<ActionChannel>("call");
  const [contactId, setContactId] = useState("");
  const [target, setTarget] = useState("");
  const [objective, setObjective] = useState("");
  const [reason, setReason] = useState("");
  const [resourceId, setResourceId] = useState("");

  const selectedContact = contacts.find((contact) => contact.id === contactId) ?? null;
  const effectiveTarget = target.trim() || selectedContact?.name || "";
  const canSubmit = Boolean(zoneId && objective.trim() && effectiveTarget) && !busy;

  return (
    <form
      className="new-action"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          channel,
          target: effectiveTarget,
          objective: objective.trim(),
          reason: reason.trim() || "Acción creada manualmente por el operador.",
          zoneId,
          resourceId: resourceId || undefined,
          contactId: contactId || undefined
        });
        setObjective("");
        setReason("");
        setTarget("");
      }}
    >
      <div className="new-action-head">
        <h3>Nueva acción manual</h3>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Cerrar el formulario de acción"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="field-grid">
        <label>
          <span>Zona</span>
          <select value={zoneId} onChange={(changeEvent) => setZoneId(changeEvent.target.value)}>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Canal</span>
          <select
            value={channel}
            onChange={(changeEvent) => setChannel(changeEvent.target.value as ActionChannel)}
          >
            {channels.map((option) => (
              <option key={option} value={option}>
                {channelLabels[option]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Contacto</span>
          <select value={contactId} onChange={(changeEvent) => setContactId(changeEvent.target.value)}>
            <option value="">Sin contacto asignado</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} · {roleLabels[contact.role]}
                {contact.demoSafe ? "" : " (solo simulación)"}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Recurso</span>
          <select value={resourceId} onChange={(changeEvent) => setResourceId(changeEvent.target.value)}>
            <option value="">Que lo elija el sistema</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id} disabled={resource.status === "unavailable"}>
                {resource.name}
                {resource.status === "unavailable" ? " (fuera de servicio)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="span-2">
          <span>Objetivo</span>
          <input
            value={objective}
            onChange={(changeEvent) => setObjective(changeEvent.target.value)}
            placeholder="Avisar a los refugios de la saturación prevista"
            required
          />
        </label>

        <label className="span-2">
          <span>Destinatario</span>
          <input
            value={target}
            onChange={(changeEvent) => setTarget(changeEvent.target.value)}
            placeholder={selectedContact ? selectedContact.name : "A quién se dirige la acción"}
          />
        </label>

        <label className="span-2">
          <span>Motivo</span>
          <input
            value={reason}
            onChange={(changeEvent) => setReason(changeEvent.target.value)}
            placeholder="Por qué el operador la crea"
          />
        </label>
      </div>

      {selectedContact && !selectedContact.demoSafe ? (
        <p className="muted-note warn">
          {selectedContact.name} no está aprobado para ejecución real: esta acción se quedará en simulación.
        </p>
      ) : null}

      <div className="new-action-foot">
        <button type="submit" className="primary" disabled={!canSubmit}>
          <Send size={15} aria-hidden="true" /> Crear acción
        </button>
      </div>
    </form>
  );
}
