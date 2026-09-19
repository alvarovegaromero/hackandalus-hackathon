"use client";

// A quién se avisa, por qué canal y en qué orden. Deja claro qué contactos
// están aprobados para recibir ejecución real y cuáles no.

import type { Contact, CrisisZone, EscalationChain } from "@/lib/types";
import { agoLabel, chainStatusLabels, channelLabels, roleLabels } from "./shared";

interface Props {
  contacts: Contact[];
  chains: EscalationChain[];
  zones: CrisisZone[];
  nowMs: number;
}

export default function ContactsPanel({ contacts, chains, zones, nowMs }: Props) {
  const safeCount = contacts.filter((contact) => contact.demoSafe).length;

  return (
    <div className="contacts-grid">
      <div>
        <h3 className="section-head">
          Contacts ({contacts.length}) · {safeCount} approved for live execution
        </h3>
        <div className="contact-list">
          {contacts.map((contact) => {
            const zone = zones.find((candidate) => candidate.id === contact.zoneId);
            return (
              <article key={contact.id} className={`contact ${contact.demoSafe ? "safe" : "sim"}`}>
                <div>
                  <h4>{contact.name}</h4>
                  <p>
                    {roleLabels[contact.role]} · {zone?.name ?? "entire region"}
                  </p>
                  <p className="action-trace">
                    Preferred channels:{" "}
                    {contact.channels.map((channel) => channelLabels[channel]).join(" › ")} ·
                    responds {Math.round(contact.responsiveness * 100)}% of the time
                    {contact.lastContactedAt
                      ? ` · last contacted ${agoLabel(contact.lastContactedAt, nowMs)}`
                      : ""}
                  </p>
                </div>
                <span className={contact.demoSafe ? "pill live" : "pill mock"}>
                  {contact.demoSafe ? "Approved for live execution" : "Simulation only"}
                </span>
              </article>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="section-head">Escalation chains ({chains.length})</h3>
        {chains.length === 0 ? (
          <p className="muted-note">No active escalation chains right now.</p>
        ) : null}
        <div className="chain-list">
          {chains.map((chain) => {
            const zone = zones.find((candidate) => candidate.id === chain.zoneId);
            return (
              <article key={chain.id} className={`chain ${chain.status}`}>
                <header>
                  <h4>{chain.objective}</h4>
                  <span className={`pill chain-${chain.status}`}>
                    {chainStatusLabels[chain.status]}
                  </span>
                </header>
                <p className="action-trace">
                  {zone?.name ?? chain.zoneId} · step{" "}
                  {Math.min(chain.currentStep + 1, chain.steps.length)} of {chain.steps.length} ·
                  updated {agoLabel(chain.updatedAt, nowMs)}
                </p>
                <ol className="chain-steps">
                  {chain.steps.map((step, index) => {
                    const contact = contacts.find((candidate) => candidate.id === step.contactId);
                    const done = index < chain.currentStep;
                    const current = index === chain.currentStep && chain.status === "active";
                    return (
                      <li
                        key={`${chain.id}-${step.order}`}
                        className={`${done ? "done" : ""} ${current ? "current" : ""}`}
                      >
                        <b>{step.order}</b>
                        <div>
                          <strong>{contact?.name ?? step.contactId}</strong>
                          <small>
                            {channelLabels[step.channel]} · wait {step.waitSeconds}s · {step.reason}
                          </small>
                        </div>
                        <span className={contact?.demoSafe ? "pill live" : "pill mock"}>
                          {contact?.demoSafe ? "Live" : "Simulated"}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
