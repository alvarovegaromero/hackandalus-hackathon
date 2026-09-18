"use client";

// Señales entrantes: lo que llega, lo que se confirma y lo que se descarta.

import { Ban, Check } from "lucide-react";
import type { CrisisEvent, CrisisZone } from "@/lib/types";
import { agoLabel, confidenceLabels, eventSourceLabels, severityLabels } from "./shared";

const decisionLabels: Record<"act" | "verify" | "discard", string> = {
  act: "Actuar ya",
  verify: "Verificar antes",
  discard: "Descartable"
};

interface Props {
  events: CrisisEvent[];
  zones: CrisisZone[];
  busy: string | null;
  nowMs: number;
  freshIds: Set<string>;
  onMark: (eventId: string, confirmed: boolean) => void;
}

export default function SignalsPanel({ events, zones, busy, nowMs, freshIds, onMark }: Props) {
  return (
    <div className="timeline" role="log" aria-live="polite" aria-relevant="additions">
      {events.length === 0 ? <p className="muted-note">Todavía no ha entrado ninguna señal.</p> : null}
      {events.map((event) => {
        const zone = zones.find((candidate) => candidate.id === event.zoneId);
        const fresh = freshIds.has(event.id);
        return (
          <article
            key={event.id}
            className={`event ${event.severity} ${event.confirmed === false ? "discarded" : ""} ${
              fresh ? "just-changed" : ""
            }`}
          >
            <div>
              <h3>
                {event.title}
                {fresh ? <em className="flash-tag">Nueva</em> : null}
                {event.occurrences > 1 ? <em className="count-tag">×{event.occurrences}</em> : null}
              </h3>
              <p>{event.description}</p>
              {event.assessment ? (
                <p className="assessment">
                  <span
                    className={
                      event.assessment.decision === "act"
                        ? "pill zone-critical"
                        : event.assessment.decision === "verify"
                          ? "pill zone-active"
                          : "pill"
                    }
                  >
                    {decisionLabels[event.assessment.decision]}
                  </span>{" "}
                  {event.assessment.rationale} (relevante {Math.round(event.assessment.pRelevant * 100)} %,
                  veraz {Math.round(event.assessment.pTruthful * 100)} %, urgencia{" "}
                  {Math.round(event.assessment.urgency * 100)} %)
                </p>
              ) : null}
              <span>
                {agoLabel(event.createdAt, nowMs)} · {zone?.name ?? event.zoneId} ·{" "}
                {eventSourceLabels[event.source]} · {severityLabels[event.severity]} ·{" "}
                {confidenceLabels[event.confidence]} ·{" "}
                {event.confirmed === true
                  ? "confirmada"
                  : event.confirmed === false
                    ? "descartada"
                    : "sin verificar"}
              </span>
            </div>
            <div className="event-actions">
              <button
                aria-label={`Confirmar la señal: ${event.title}`}
                onClick={() => onMark(event.id, true)}
                disabled={busy !== null || event.confirmed === true}
              >
                <Check size={15} aria-hidden="true" />
              </button>
              <button
                className="danger-light"
                aria-label={`Descartar la señal: ${event.title}`}
                onClick={() => onMark(event.id, false)}
                disabled={busy !== null || event.confirmed === false}
              >
                <Ban size={15} aria-hidden="true" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
