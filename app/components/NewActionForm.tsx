"use client";

// Intervención humana: un operador crea una acción a mano cuando el sistema
// no ha visto algo o se ha equivocado.

import { useState } from "react";
import { Send, X } from "lucide-react";
import type {
  ActionChannel,
  Contact,
  CreateActionPayload,
  CrisisZone,
  Resource,
} from "@/lib/types";
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

const channels: ActionChannel[] = [
  "call",
  "sms",
  "whatsapp",
  "email",
  "slack",
  "ticket",
  "webhook",
];

export default function NewActionForm({
  zones,
  contacts,
  resources,
  prefillZoneId,
  busy,
  onSubmit,
  onClose,
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
          reason: reason.trim() || "Action manually created by operator.",
          zoneId,
          resourceId: resourceId || undefined,
          contactId: contactId || undefined,
        });
        setObjective("");
        setReason("");
        setTarget("");
      }}
    >
      <div className="new-action-head">
        <h3>New manual action</h3>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close action form"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="field-grid">
        <label>
          <span>Zone</span>
          <select value={zoneId} onChange={(changeEvent) => setZoneId(changeEvent.target.value)}>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Channel</span>
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
          <span>Contact</span>
          <select
            value={contactId}
            onChange={(changeEvent) => setContactId(changeEvent.target.value)}
          >
            <option value="">No contact assigned</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} · {roleLabels[contact.role]}
                {contact.demoSafe ? "" : " (simulation only)"}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Resource</span>
          <select
            value={resourceId}
            onChange={(changeEvent) => setResourceId(changeEvent.target.value)}
          >
            <option value="">Let system assign</option>
            {resources.map((resource) => (
              <option
                key={resource.id}
                value={resource.id}
                disabled={resource.status === "unavailable"}
              >
                {resource.name}
                {resource.status === "unavailable" ? " (out of service)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="span-2">
          <span>Objective</span>
          <input
            value={objective}
            onChange={(changeEvent) => setObjective(changeEvent.target.value)}
            placeholder="Notify shelters of expected capacity"
            required
          />
        </label>

        <label className="span-2">
          <span>Recipient</span>
          <input
            value={target}
            onChange={(changeEvent) => setTarget(changeEvent.target.value)}
            placeholder={selectedContact ? selectedContact.name : "Target recipient of the action"}
          />
        </label>

        <label className="span-2">
          <span>Reason</span>
          <input
            value={reason}
            onChange={(changeEvent) => setReason(changeEvent.target.value)}
            placeholder="Reason for manual creation"
          />
        </label>
      </div>

      {selectedContact && !selectedContact.demoSafe ? (
        <p className="muted-note warn">
          {selectedContact.name} is not approved for live execution: this action will remain
          simulated.
        </p>
      ) : null}

      <div className="new-action-foot">
        <button type="submit" className="primary" disabled={!canSubmit}>
          <Send size={15} aria-hidden="true" /> Create action
        </button>
      </div>
    </form>
  );
}
