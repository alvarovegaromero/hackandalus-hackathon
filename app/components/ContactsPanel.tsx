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
          Contactos ({contacts.length}) · {safeCount} aprobados para ejecución real
        </h3>
        <div className="contact-list">
          {contacts.map((contact) => {
            const zone = zones.find((candidate) => candidate.id === contact.zoneId);
            return (
              <article key={contact.id} className={`contact ${contact.demoSafe ? "safe" : "sim"}`}>
                <div>
                  <h4>{contact.name}</h4>
                  <p>
                    {roleLabels[contact.role]} · {zone?.name ?? "toda la región"}
                  </p>
                  <p className="action-trace">
                    Canales por preferencia:{" "}
                    {contact.channels.map((channel) => channelLabels[channel]).join(" › ")} · responde el{" "}
                    {Math.round(contact.responsiveness * 100)}% de las veces
                    {contact.lastContactedAt
                      ? ` · último aviso ${agoLabel(contact.lastContactedAt, nowMs)}`
                      : ""}
                  </p>
                </div>
                <span className={contact.demoSafe ? "pill live" : "pill mock"}>
                  {contact.demoSafe ? "Apto para ejecución real" : "Solo simulación"}
                </span>
              </article>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="section-head">Cadenas de escalado ({chains.length})</h3>
        {chains.length === 0 ? (
          <p className="muted-note">Ninguna cadena de escalado abierta ahora mismo.</p>
        ) : null}
        <div className="chain-list">
          {chains.map((chain) => {
            const zone = zones.find((candidate) => candidate.id === chain.zoneId);
            return (
              <article key={chain.id} className={`chain ${chain.status}`}>
                <header>
                  <h4>{chain.objective}</h4>
                  <span className={`pill chain-${chain.status}`}>{chainStatusLabels[chain.status]}</span>
                </header>
                <p className="action-trace">
                  {zone?.name ?? chain.zoneId} · escalón {Math.min(chain.currentStep + 1, chain.steps.length)}{" "}
                  de {chain.steps.length} · actualizada {agoLabel(chain.updatedAt, nowMs)}
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
                            {channelLabels[step.channel]} · espera {step.waitSeconds}s · {step.reason}
                          </small>
                        </div>
                        <span className={contact?.demoSafe ? "pill live" : "pill mock"}>
                          {contact?.demoSafe ? "Real" : "Simulada"}
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
