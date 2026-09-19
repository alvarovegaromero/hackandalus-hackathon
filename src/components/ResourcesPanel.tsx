"use client";

// Recursos: quién está libre, quién está atado a una acción y quién ha caído.

import type { Action, CrisisZone, Resource, WaitingDemand } from "@/lib/types";
import { resolveResourceConflicts } from "@/lib/resources";
import { agoLabel, resourceStatusLabels } from "./shared";

interface Props {
  resources: Resource[];
  zones: CrisisZone[];
  actions: Action[];
  /** Cola de espera calculada por el servidor, si ya la publica. */
  waiting: WaitingDemand[] | undefined;
  nowMs: number;
}

export default function ResourcesPanel({ resources, zones, actions, waiting, nowMs }: Props) {
  // Si el servidor ya publica la cola de espera, manda la suya; si no, se
  // calcula aquí con el mismo motor de asignación.
  const conflicts = resolveResourceConflicts(actions, resources, zones);
  const queue = waiting ?? conflicts.waiting;

  return (
    <div className="resources-tab">
      <section className={queue.length > 0 ? "waiting-box alarm" : "waiting-box"}>
        <h3 className="section-head">Resource distribution across zones</h3>
        <p className="waiting-summary">{conflicts.summary}</p>
        {queue.length > 0 ? (
          <ul className="mini-list">
            {queue.map((entry) => {
              const zone = zones.find((candidate) => candidate.id === entry.zoneId);
              const action = actions.find((candidate) => candidate.id === entry.actionId);
              return (
                <li key={entry.actionId} className="mini-row sev-high">
                  <div>
                    <strong>
                      {zone?.name ?? entry.zoneId} waiting
                      {"estimatedWaitMinutes" in entry && entry.estimatedWaitMinutes !== null
                        ? ` · approx. ${entry.estimatedWaitMinutes} min`
                        : ""}
                    </strong>
                    <small>
                      {action ? `${action.objective}. ` : ""}
                      {entry.reason}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <h3 className="section-head">Deployment ({resources.length} resources)</h3>
      <div className="resource-list">
        {resources.map((resource) => {
          const zone = zones.find((candidate) => candidate.id === resource.zoneId);
          const action = actions.find((candidate) => candidate.id === resource.assignedActionId);
          return (
            <article key={resource.id} className={`resource ${resource.status}`}>
              <div>
                <h3>{resource.name}</h3>
                <p>
                  {resource.type} · capacity {resource.capacity} · capabilities:{" "}
                  {resource.capabilities.join(", ")}
                </p>
                {action ? (
                  <p className="action-trace">
                    Assigned to: {action.objective}
                    {resource.assignedAt ? ` · since ${agoLabel(resource.assignedAt, nowMs)}` : ""}
                  </p>
                ) : null}
              </div>
              <span>{resourceStatusLabels[resource.status]}</span>
              <small>{zone?.name ?? "no fixed zone"}</small>
            </article>
          );
        })}
      </div>
    </div>
  );
}
