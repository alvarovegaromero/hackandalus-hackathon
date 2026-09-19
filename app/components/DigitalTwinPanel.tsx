"use client";

// Gemelo digital: lo que FARO cree del mundo, con su confianza y divergencias
// frente a la verdad simulada de la demo.

import { AlertTriangle, BrainCircuit, CheckCircle2, CircleHelp, Clock3 } from "lucide-react";
import type { DigitalTwinFactStatus, DigitalTwinState } from "@/lib/types";
import { agoLabel } from "./shared";
import { Badge } from "./ui/badge";

interface Props {
  twin: DigitalTwinState | undefined;
  nowMs: number;
}

const statusLabels: Record<DigitalTwinFactStatus, string> = {
  confirmed: "Confirmado",
  inferred: "Inferido",
  unknown: "Sin evidencia",
  stale: "Obsoleto",
  mismatch: "Diverge",
};

const statusIcons: Record<DigitalTwinFactStatus, typeof CheckCircle2> = {
  confirmed: CheckCircle2,
  inferred: BrainCircuit,
  unknown: CircleHelp,
  stale: Clock3,
  mismatch: AlertTriangle,
};

function confidenceLabel(confidence: number) {
  if (confidence <= 0) return "sin confianza";
  return `${Math.round(confidence * 100)}% confianza`;
}

export default function DigitalTwinPanel({ twin, nowMs }: Props) {
  if (!twin) return null;

  return (
    <section className={`panel digital-twin ${twin.mismatches > 0 ? "has-mismatch" : ""}`}>
      <div className="panel-title flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrainCircuit size={16} aria-hidden="true" />
          <h2 className="text-[14px] font-bold text-[#292929] tracking-[-0.15px]">
            Gemelo digital
          </h2>
        </div>
        <span className="text-[12px] text-[#5d5d5d]">Percepción reconstruida desde señales</span>
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
          const badgeVariant =
            fact.status === "confirmed"
              ? "success"
              : fact.status === "mismatch"
                ? "critical"
                : fact.status === "stale"
                  ? "warning"
                  : fact.status === "inferred"
                    ? "info"
                    : "outline";
          return (
            <li key={fact.id} className={`mini-row twin-fact ${fact.status}`}>
              <Icon size={16} aria-hidden="true" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <strong>{fact.label}</strong>
                  <Badge variant={badgeVariant} className="text-[11px]">
                    {statusLabels[fact.status]}
                  </Badge>
                </div>
                <small>
                  FARO cree: {fact.perceived} · verdad simulada: {fact.truth}
                </small>
                <small>
                  {confidenceLabel(fact.confidence)}
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
