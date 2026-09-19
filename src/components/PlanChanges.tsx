"use client";

// Diferencias entre versiones del plan: qué cambió y por qué se replanificó.

import { GitCompareArrows } from "lucide-react";
import type { Plan } from "@/lib/types";
import { agoLabel, planChangeLabels, timeLabel } from "./shared";
import { Badge } from "./ui/badge";

interface Props {
  plan: Plan;
  planHistory: Plan[];
  nowMs: number;
  isFresh: boolean;
}

function ChangeRows({ plan }: { plan: Plan }) {
  if (!plan.changes || plan.changes.length === 0) {
    return (
      <p className="muted-note">This version recorded no differences from the previous one.</p>
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
      aria-label="Plan changes"
    >
      <div className="panel-title flex items-center gap-2">
        <GitCompareArrows size={16} aria-hidden="true" />
        <h2 className="text-[14px] font-bold text-blueprint-dark tracking-[-0.15px]">
          Plan v{plan.version}: what changed
        </h2>
        {isFresh ? <Badge variant="warning">New</Badge> : null}
        {invalid ? <Badge variant="critical">Invalid</Badge> : null}
      </div>

      {invalid ? (
        <p className="muted-note warn">
          An assumption failed and the plan has not yet been regenerated
          {plan.invalidatedReason ? `: ${plan.invalidatedReason}` : "."}
        </p>
      ) : null}

      <div className="plan-trigger" aria-live="polite">
        <span>Replanned because</span>
        <strong>{plan.trigger || "no trigger recorded"}</strong>
        <small>
          {timeLabel(plan.generatedAt)} · {agoLabel(plan.generatedAt, nowMs)}
          {plan.previousVersion ? ` · previously v${plan.previousVersion}` : " · initial version"}
        </small>
      </div>

      <ChangeRows plan={plan} />

      {assumptions.length > 0 ? (
        <>
          <h3 className="section-head text-[12px] uppercase tracking-[0.06em] text-blueprint-mid">
            Key assumptions
          </h3>
          <ul className="mini-list">
            {assumptions.map((assumption) => (
              <li key={assumption.id} className={`mini-row assumption ${assumption.status}`}>
                <div>
                  <strong>{assumption.text}</strong>
                  <small>
                    Tracks {assumption.variable} · {assumption.condition}
                  </small>
                </div>
                <Badge
                  variant={
                    assumption.status === "broken"
                      ? "critical"
                      : assumption.status === "ok"
                        ? "success"
                        : "outline"
                  }
                >
                  {assumption.status === "broken"
                    ? "Broken"
                    : assumption.status === "ok"
                      ? "Holding"
                      : "No data"}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {plan.invalidatedActionIds.length > 0 ? (
        <p className="muted-note">
          {plan.invalidatedActionIds.length} action(s) were invalidated by this replan.
        </p>
      ) : null}

      {history.length > 0 ? (
        <>
          <h3 className="section-head">Previous versions</h3>
          <div className="plan-history">
            {history.map((previous) => (
              <details key={previous.id}>
                <summary>
                  <b>v{previous.version}</b>
                  <span>{previous.trigger || "no trigger recorded"}</span>
                  <small>
                    {timeLabel(previous.generatedAt)} · {previous.changes?.length ?? 0} changes
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
