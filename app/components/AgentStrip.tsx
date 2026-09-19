"use client";

// Tira pequeña de subagentes. Se deriva del registro de auditoría: importa qué
// está haciendo el sistema, no cuántos módulos tiene.

import type { AuditEntry } from "@/lib/types";

interface Props {
  audit: AuditEntry[];
  nowMs: number;
}

const ACTIVE_MS = 90 * 1000;

const agents: { id: string; label: string; kinds: string[] }[] = [
  {
    id: "triage",
    label: "Triage",
    kinds: ["event-ingested", "event-deduplicated", "event-confirmed", "event-discarded"],
  },
  { id: "priority", label: "Priority", kinds: ["replan", "plan", "priority"] },
  { id: "resources", label: "Resources", kinds: ["resource", "assign", "reassign"] },
  { id: "contacts", label: "Alerts", kinds: ["chain", "escalation", "contact"] },
  { id: "executor", label: "Execution", kinds: ["action"] },
];

export default function AgentStrip({ audit, nowMs }: Props) {
  const recent = audit.filter((entry) => nowMs - new Date(entry.at).getTime() < ACTIVE_MS);

  return (
    <div className="agent-strip" aria-label="Active subagents">
      {agents.map((agent) => {
        const hit = recent.find((entry) => agent.kinds.some((kind) => entry.kind.includes(kind)));
        return (
          <span
            key={agent.id}
            className={hit ? "agent on" : "agent"}
            title={hit?.summary ?? "Standby"}
          >
            <i aria-hidden="true" />
            {agent.label}
          </span>
        );
      })}
    </div>
  );
}
