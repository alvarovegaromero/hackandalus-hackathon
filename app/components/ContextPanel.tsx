"use client";

// Panel de contexto: lo que está confirmado frente a lo que no se sabe. Enseñar
// lo que el sistema NO sabe es parte de la supervisión, no un defecto.

import { Ban, Check, HelpCircle } from "lucide-react";
import type { Action, CrisisEvent, CrisisZone } from "@/lib/types";
import { agoLabel, eventSourceLabels, severityLabels } from "./shared";

interface Props {
  events: CrisisEvent[];
  zones: CrisisZone[];
  actions: Action[];
  busy: string | null;
  nowMs: number;
  onMark: (eventId: string, confirmed: boolean) => void;
}

/** Acción de verificación abierta para una señal, si la hay. */
function verificationFor(event: CrisisEvent, actions: Action[]) {
  return (
    actions.find((action) => action.id === event.verificationActionId) ??
    actions.find((action) => action.verifiesEventId === event.id) ??
    null
  );
}

export default function ContextPanel({ events, zones, actions, busy, nowMs, onMark }: Props) {
  const confirmed = events.filter((event) => event.confirmed === true);
  const unknown = events.filter((event) => event.confirmed !== true);

  const zoneName = (zoneId: string) => zones.find((zone) => zone.id === zoneId)?.name ?? zoneId;

  return (
    <details className="context-panel">
      <summary>
        <HelpCircle size={16} aria-hidden="true" />
        <strong>Qué sabemos y qué no</strong>
        <span className="pill zone-stable">{confirmed.length} confirmado</span>
        <span className="pill zone-active">{unknown.length} sin confirmar</span>
      </summary>

      <div className="context-columns">
        <section>
          <h3 className="section-head">Confirmado ({confirmed.length})</h3>
          {confirmed.length === 0 ? <p className="muted-note">Nada confirmado todavía.</p> : null}
          <ul className="mini-list">
            {confirmed.map((event) => (
              <li key={event.id} className="mini-row">
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {zoneName(event.zoneId)} · {severityLabels[event.severity]} ·{" "}
                    {eventSourceLabels[event.source]} · {agoLabel(event.createdAt, nowMs)}
                  </small>
                </div>
                <button
                  className="danger-light"
                  aria-label={`Descartar la señal confirmada: ${event.title}`}
                  onClick={() => onMark(event.id, false)}
                  disabled={busy !== null}
                >
                  <Ban size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="section-head">Sin confirmar o desconocido ({unknown.length})</h3>
          {unknown.length === 0 ? <p className="muted-note">No queda nada por verificar.</p> : null}
          <ul className="mini-list">
            {unknown.map((event) => {
              const verification = verificationFor(event, actions);
              return (
                <li key={event.id} className={`mini-row ${event.confirmed === false ? "" : "sev-high"}`}>
                  <div>
                    <strong>{event.title}</strong>
                    <small>
                      {zoneName(event.zoneId)} · {severityLabels[event.severity]} ·{" "}
                      {event.confirmed === false ? "descartada" : "pendiente de verificar"} ·{" "}
                      {agoLabel(event.createdAt, nowMs)}
                    </small>
                    {verification ? (
                      <small className="verifying">
                        Verificación en curso: {verification.objective} ({verification.target})
                      </small>
                    ) : null}
                  </div>
                  <button
                    aria-label={`Confirmar la señal: ${event.title}`}
                    onClick={() => onMark(event.id, true)}
                    disabled={busy !== null}
                  >
                    <Check size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </details>
  );
}
