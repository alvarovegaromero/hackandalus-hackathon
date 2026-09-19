"use client";

// Diferencias entre versiones del plan: qué cambió y por qué se replanificó.

import { GitCompareArrows } from "lucide-react";
import type { Plan } from "@/lib/types";
import { agoLabel, planChangeLabels, timeLabel } from "./shared";

interface Props {
  plan: Plan;
  planHistory: Plan[];
  nowMs: number;
  isFresh: boolean;
}

function ChangeRows({ plan }: { plan: Plan }) {
  if (!plan.changes || plan.changes.length === 0) {
    return (
      <p className="muted-note">Esta versión no registró diferencias respecto a la anterior.</p>
    );
  }
  return (
    <ul className="change-list">
      {plan.changes.map((change, index) => (
        <li key={`${plan.version}-${change.kind}-${index}`}>
          <span className={`change-kind ${change.kind}`}>{planChangeLabels[change.kind]}</span>
          <div>
            <strong>{change.label}</strong>
            <small>{change.detail}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function PlanChanges({ plan, planHistory, nowMs, isFresh }: Props) {
  const history = planHistory.slice(0, 6);
  const assumptions = plan.assumptions ?? [];
  const invalid = plan.valid === false;

  return (
    <section
      className={`panel plan-panel ${isFresh ? "just-changed" : ""}`}
      aria-label="Cambios del plan"
    >
      <div className="panel-title">
        <GitCompareArrows size={18} aria-hidden="true" />
        <h2>Plan v{plan.version}: qué cambió</h2>
        {isFresh ? <em className="flash-tag">Nuevo</em> : null}
        {invalid ? <em className="flash-tag">Ya no vale</em> : null}
      </div>

      {invalid ? (
        <p className="muted-note warn">
          Un supuesto se ha roto y el plan todavía no se ha rehecho
          {plan.invalidatedReason ? `: ${plan.invalidatedReason}` : "."}
        </p>
      ) : null}

      <div className="plan-trigger" aria-live="polite">
        <span>Se replanificó porque</span>
        <strong>{plan.trigger || "no se registró el motivo"}</strong>
        <small>
          {timeLabel(plan.generatedAt)} · {agoLabel(plan.generatedAt, nowMs)}
          {plan.previousVersion ? ` · antes v${plan.previousVersion}` : " · primera versión"}
        </small>
      </div>

      <ChangeRows plan={plan} />

      {assumptions.length > 0 ? (
        <>
          <h3 className="section-head">De qué depende este plan</h3>
          <ul className="mini-list">
            {assumptions.map((assumption) => (
              <li key={assumption.id} className={`mini-row assumption ${assumption.status}`}>
                <div>
                  <strong>{assumption.text}</strong>
                  <small>
                    Vigila {assumption.variable} · {assumption.condition}
                  </small>
                </div>
                <span
                  className={
                    assumption.status === "broken"
                      ? "pill zone-critical"
                      : assumption.status === "ok"
                        ? "pill zone-stable"
                        : "pill"
                  }
                >
                  {assumption.status === "broken"
                    ? "Roto"
                    : assumption.status === "ok"
                      ? "Se sostiene"
                      : "Sin datos"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {plan.invalidatedActionIds.length > 0 ? (
        <p className="muted-note">
          {plan.invalidatedActionIds.length} acción(es) quedaron invalidadas por esta
          replanificación.
        </p>
      ) : null}

      {history.length > 0 ? (
        <>
          <h3 className="section-head">Versiones anteriores</h3>
          <div className="plan-history">
            {history.map((previous) => (
              <details key={previous.id}>
                <summary>
                  <b>v{previous.version}</b>
                  <span>{previous.trigger || "sin motivo registrado"}</span>
                  <small>
                    {timeLabel(previous.generatedAt)} · {previous.changes?.length ?? 0} cambios
                  </small>
                </summary>
                <p className="muted-note">{previous.summary}</p>
                <ChangeRows plan={previous} />
              </details>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
