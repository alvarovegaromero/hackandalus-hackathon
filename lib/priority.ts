// PROPIETARIO: agente del motor de prioridad.
import type {
  Action,
  CrisisEvent,
  CrisisZone,
  Plan,
  PriorityFactor,
  Resource,
  Severity,
  Confidence
} from "./types";

const severityWeight: Record<Severity, number> = {
  low: 10,
  medium: 30,
  high: 60,
  critical: 115
};

const confidenceWeight: Record<Confidence, number> = {
  low: -8,
  medium: 6,
  high: 16
};

export function buildDedupeKey(event: Pick<CrisisEvent, "zoneId" | "category" | "severity">) {
  return `${event.zoneId}:${event.category.toLowerCase()}:${event.severity}`;
}

export function scoreZone(zone: CrisisZone, events: CrisisEvent[], resources: Resource[]) {
  const zoneEvents = events.filter((event) => event.zoneId === zone.id && event.confirmed !== false);
  const latestEventScore = zoneEvents.reduce((score, event) => {
    const confirmedBoost = event.confirmed === true ? 12 : 0;
    return score + severityWeight[event.severity] + confidenceWeight[event.confidence] + confirmedBoost;
  }, 0);
  const unavailableResources = resources.filter(
    (resource) => resource.zoneId === zone.id && resource.status === "unavailable"
  ).length;
  const populationScore = Math.min(35, Math.round(zone.populationAtRisk / 120));
  const needScore = zone.needs.length * 8;

  return zone.riskScore + latestEventScore + populationScore + needScore + unavailableResources * 14;
}

export function buildPlan(
  version: number,
  zones: CrisisZone[],
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[],
  invalidatedActionIds: string[] = []
): Plan {
  const priorities = zones
    .map((zone) => {
      const score = scoreZone(zone, events, resources);
      const latestEvent = events
        .filter((event) => event.zoneId === zone.id && event.confirmed !== false)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      const factors: PriorityFactor[] = [
        { label: "Riesgo base", value: zone.riskScore },
        { label: "Poblacion en riesgo", value: Math.min(35, Math.round(zone.populationAtRisk / 120)) },
        { label: "Necesidades abiertas", value: zone.needs.length * 8 }
      ];

      return {
        zoneId: zone.id,
        score,
        factors,
        reason: latestEvent
          ? `Senal ${latestEvent.severity} de ${latestEvent.category}, confianza ${latestEvent.confidence}, ${zone.populationAtRisk} personas en riesgo y ${zone.needs.length} necesidades abiertas.`
          : `${zone.populationAtRisk} personas en riesgo y ${zone.needs.length} necesidades abiertas.`
      };
    })
    .sort((a, b) => b.score - a.score);

  const topPriority = priorities[0];
  const topZone = zones.find((zone) => zone.id === topPriority?.zoneId);
  const openActionIds = actions
    .filter((action) => ["pending", "approved", "running", "blocked", "failed"].includes(action.status))
    .map((action) => action.id);

  return {
    id: `plan-${version}`,
    version,
    previousVersion: version > 1 ? version - 1 : null,
    generatedAt: new Date().toISOString(),
    summary: topZone
      ? `${topZone.name} es la prioridad actual con puntuacion ${topPriority.score}. ${topPriority.reason}`
      : "No hay zonas activas que requieran accion.",
    priorities,
    proposedActionIds: openActionIds,
    invalidatedActionIds,
    changes: [],
    trigger: "replanificacion"
  };
}
