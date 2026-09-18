import type { Action, CrisisEvent, CrisisZone, Plan, Resource } from "./types";

const now = new Date().toISOString();

export const seedZones: CrisisZone[] = [
  {
    id: "zone-north",
    name: "North Sector",
    status: "watch",
    populationAtRisk: 1200,
    riskScore: 42,
    needs: ["situation assessment"],
    coordinates: { x: 28, y: 26 },
    lastUpdatedAt: now
  },
  {
    id: "zone-central",
    name: "Central Hub",
    status: "active",
    populationAtRisk: 3100,
    riskScore: 68,
    needs: ["public alert", "medical triage"],
    coordinates: { x: 52, y: 48 },
    lastUpdatedAt: now
  },
  {
    id: "zone-east",
    name: "East Corridor",
    status: "stable",
    populationAtRisk: 900,
    riskScore: 24,
    needs: ["route monitoring"],
    coordinates: { x: 75, y: 38 },
    lastUpdatedAt: now
  },
  {
    id: "zone-south",
    name: "South Shelter Area",
    status: "watch",
    populationAtRisk: 1750,
    riskScore: 35,
    needs: ["shelter capacity check"],
    coordinates: { x: 42, y: 74 },
    lastUpdatedAt: now
  }
];

export const seedResources: Resource[] = [
  {
    id: "res-med-1",
    name: "Medical Team Alpha",
    type: "medical",
    capacity: 24,
    status: "available",
    zoneId: "zone-central",
    assignedActionId: null
  },
  {
    id: "res-field-1",
    name: "Field Unit Bravo",
    type: "field",
    capacity: 12,
    status: "available",
    zoneId: "zone-north",
    assignedActionId: null
  },
  {
    id: "res-transport-1",
    name: "Transport Group One",
    type: "transport",
    capacity: 80,
    status: "available",
    zoneId: "zone-south",
    assignedActionId: null
  },
  {
    id: "res-comms-1",
    name: "Comms Liaison",
    type: "communications",
    capacity: 1,
    status: "available",
    zoneId: null,
    assignedActionId: null
  }
];

export const seedEvents: CrisisEvent[] = [
  {
    id: "evt-seed-1",
    source: "operator",
    title: "Central Hub reports rising pressure",
    description: "Multiple inbound reports indicate increased need for triage and public guidance.",
    zoneId: "zone-central",
    category: "coordination",
    severity: "high",
    confidence: "high",
    createdAt: now,
    confirmed: true,
    dedupeKey: "zone-central:coordination:high"
  }
];

export const seedActions: Action[] = [
  {
    id: "act-seed-1",
    channel: "call",
    target: "Central Hub coordinator",
    objective: "Confirm triage capacity and request next update window.",
    status: "pending",
    reason: "Central Hub has the highest current risk score and confirmed demand.",
    zoneId: "zone-central",
    resourceId: "res-comms-1",
    executionMode: "mock",
    createdAt: now,
    updatedAt: now
  }
];

export const seedPlan: Plan = {
  id: "plan-seed",
  version: 1,
  generatedAt: now,
  summary: "Central Hub is the current priority because confirmed demand is rising and medical needs are open.",
  priorities: [
    {
      zoneId: "zone-central",
      score: 104,
      reason: "High severity event, high confidence, 3100 people at risk, and 2 open needs."
    }
  ],
  proposedActionIds: ["act-seed-1"],
  invalidatedActionIds: []
};
