"use client";

// Gemelo digital: lo que FARO cree del mundo, con su confianza y divergencias
// frente a la verdad simulada de la demo.

import { AlertTriangle, BrainCircuit, CheckCircle2, CircleHelp, Clock3 } from "lucide-react";
import type { DigitalTwinFactStatus, DigitalTwinState } from "@/lib/types";
import { agoLabel } from "./shared";

interface Props {
  twin: DigitalTwinState | undefined;
  nowMs: number;
}

const statusLabels: Record<DigitalTwinFactStatus, string> = {
  confirmed: "Confirmado",
  inferred: "Inferido",
  unknown: "Sin evidencia",
  stale: "Obsoleto",
  mismatch: "Diverge"
};

const statusIcons: Record<DigitalTwinFactStatus, typeof CheckCircle2> = {
  confirmed: CheckCircle2,
  inferred: BrainCircuit,
  unknown: CircleHelp,
  stale: Clock3,
  mismatch: AlertTriangle
};

function confidenceLabel(confidence: number) {
  if (confidence <= 0) return "sin confianza";
  return `${Math.round(confidence * 100)}% confianza`;
}

export default function DigitalTwinPanel({ twin, nowMs }: Props) {
  if (!twin) return null;

  return (
    <section className={`panel digital-twin ${twin.mismatches > 0 ? "has-mismatch" : ""}`}>
      <div className="panel-title">
        <BrainCircuit size={18} aria-hidden="true" />
        <h2>Gemelo digital</h2>
        <span className="hint">Percepción reconstruida desde señales</span>
      </div>

      <div className="twin-summary">
        <article>
          <span>Precisión</span>
          <strong>{twin.accuracy}%</strong>
        </article>
        <article className={twin.mismatches > 0 ? "alarm" : ""}>
          <span>Divergencias</span>
          <strong>{twin.mismatches}</strong>
        </article>
        <article>
          <span>Sin evidencia</span>
          <strong>{twin.unknownFacts}</strong>
        </article>
        <article>
          <span>Obsoletos</span>
          <strong>{twin.staleFacts}</strong>
        </article>
      </div>

      <p className="muted-note">{twin.summary}</p>

      <ul className="mini-list twin-facts">
        {twin.facts.map((fact) => {
          const Icon = statusIcons[fact.status];
          return (
            <li key={fact.id} className={`mini-row twin-fact ${fact.status}`}>
              <Icon size={16} aria-hidden="true" />
              <div>
                <strong>{fact.label}</strong>
                <small>
                  FARO cree: {fact.perceived} · verdad simulada: {fact.truth}
                </small>
                <small>
                  {statusLabels[fact.status]} · {confidenceLabel(fact.confidence)}
                  {fact.updatedAt ? ` · actualizado ${agoLabel(fact.updatedAt, nowMs)}` : ""}
                  {fact.evidenceEventIds.length > 0
                    ? ` · ${fact.evidenceEventIds.length} señal(es)`
                    : " · sin señales"}
                </small>
                <small className="twin-impact">{fact.impact}</small>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
