import type {
  Action,
  AutonomyRule,
  Contact,
  CrisisEvent,
  CrisisZone,
  Resource,
  ScenarioBeat,
  SourceReliability,
  WorldState,
} from "./types";

const now = new Date().toISOString();

export const seedZones: CrisisZone[] = [
  {
    id: "zone-north",
    name: "Sierra Morena",
    status: "watch",
    populationAtRisk: 1200,
    riskScore: 42,
    needs: ["wildfire assessment"],
    coordinates: { x: 39, y: 32, lat: 36.565, lng: -5.215 },
    lastUpdatedAt: now,
  },
  {
    id: "zone-central",
    name: "Sevilla Hub",
    status: "active",
    populationAtRisk: 3100,
    riskScore: 68,
    needs: ["public alert", "medical triage"],
    coordinates: { x: 32, y: 52, lat: 36.544, lng: -5.234 },
    lastUpdatedAt: now,
  },
  {
    id: "zone-east",
    name: "Granada y Almería",
    status: "stable",
    populationAtRisk: 900,
    riskScore: 24,
    needs: ["route surveillance"],
    coordinates: { x: 72, y: 55, lat: 36.512, lng: -5.187 },
    lastUpdatedAt: now,
  },
  {
    id: "zone-south",
    name: "Costa del Sol",
    status: "watch",
    populationAtRisk: 1750,
    riskScore: 35,
    needs: ["shelter capacity"],
    coordinates: { x: 54, y: 76, lat: 36.427, lng: -5.145 },
    lastUpdatedAt: now,
  },
  {
    id: "zone-islands",
    name: "Cádiz y Estrecho",
    status: "stable",
    populationAtRisk: 640,
    riskScore: 18,
    needs: ["logistics link"],
    coordinates: { x: 22, y: 71, lat: 36.444, lng: -5.273 },
    lastUpdatedAt: now,
  },
];

export const seedResources: Resource[] = [
  {
    id: "res-med-1",
    name: "EPES Sevilla Alpha",
    type: "medical",
    capacity: 24,
    status: "available",
    zoneId: "zone-central",
    homeZoneId: "zone-central",
    capabilities: ["triaje", "sanitario", "evacuacion"],
    assignedActionId: null,
    assignedAt: null,
  },
  {
    id: "res-field-1",
    name: "INFOCA Sierra Bravo",
    type: "field",
    capacity: 12,
    status: "available",
    zoneId: "zone-north",
    homeZoneId: "zone-north",
    capabilities: ["extincion", "evaluacion de monte", "campo"],
    assignedActionId: null,
    assignedAt: null,
  },
  {
    id: "res-transport-1",
    name: "Transporte Costa Uno",
    type: "transport",
    capacity: 80,
    status: "available",
    zoneId: "zone-south",
    homeZoneId: "zone-south",
    capabilities: ["evacuacion", "transporte", "refugio"],
    assignedActionId: null,
    assignedAt: null,
  },
  {
    id: "res-comms-1",
    name: "Enlace 112",
    type: "communications",
    capacity: 1,
    status: "available",
    zoneId: null,
    homeZoneId: null,
    capabilities: ["coordinacion", "alerta publica", "comunicaciones"],
    assignedActionId: null,
    assignedAt: null,
  },
  {
    id: "res-med-2",
    name: "EPES Granada Delta",
    type: "medical",
    capacity: 18,
    status: "available",
    zoneId: "zone-east",
    homeZoneId: "zone-east",
    capabilities: ["triaje", "sanitario"],
    assignedActionId: null,
    assignedAt: null,
  },
];

/**
 * Demo contacts. Only those marked demoSafe can receive real actions
 * via HappyRobot; the rest remain in simulated mode.
 * Phone numbers and emails are placeholders, never real data.
 */
export const seedContacts: Contact[] = [
  {
    id: "con-field-north",
    name: "Coordinación INFOCA Sierra Morena",
    role: "field-coordinator",
    zoneId: "zone-north",
    channels: ["call", "sms", "email"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.8,
  },
  {
    id: "con-med-central",
    name: "Jefatura sanitaria Sevilla Hub",
    role: "medical-lead",
    zoneId: "zone-central",
    channels: ["call", "sms"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.75,
  },
  {
    id: "con-ops-lead",
    name: "Sala de coordinación 112 Andalucía",
    role: "operations-lead",
    zoneId: null,
    channels: ["call", "email", "slack"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.9,
  },
  {
    id: "con-safety-east",
    name: "Tráfico y carreteras Granada",
    role: "public-safety",
    zoneId: "zone-east",
    channels: ["sms", "email"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.6,
  },
  {
    id: "con-volunteer-south",
    name: "Voluntariado Costa del Sol",
    role: "volunteer",
    zoneId: "zone-south",
    channels: ["sms", "whatsapp"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.45,
  },
  {
    id: "con-authority",
    name: "Autoridad regional de emergencias",
    role: "authority",
    zoneId: null,
    channels: ["email", "call"],
    phone: null,
    email: null,
    demoSafe: false,
    lastContactedAt: null,
    responsiveness: 0.5,
  },
];

export const seedEvents: CrisisEvent[] = [
  {
    id: "evt-seed-1",
    source: "operator",
    title: "Sevilla Hub reports increased pressure",
    description: "Multiple reports indicate higher need for triage and public guidance.",
    zoneId: "zone-central",
    category: "coordinacion",
    severity: "high",
    confidence: "high",
    createdAt: now,
    confirmed: true,
    dedupeKey: "zone-central:coordinacion:high",
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
  },
];

export const seedActions: Action[] = [
  {
    id: "act-seed-1",
    channel: "call",
    target: "Sevilla Hub Coordinator",
    objective: "Confirm triage capacity and request next update window.",
    status: "pending",
    reason: "Sevilla Hub has the highest initial risk score and confirmed demand.",
    zoneId: "zone-central",
    resourceId: "res-comms-1",
    contactId: "con-med-central",
    executionMode: "mock",
    attempt: 1,
    idempotencyKey: "act-seed-1:1",
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  },
];

/**
 * Default script for the self-advancing scenario: a wildfire that shifts fronts,
 * cuts off a road, and disables a resource while the system is executing actions.
 */
export const seedScenarioBeats: ScenarioBeat[] = [
  {
    id: "beat-1",
    atSeconds: 20,
    label: "Smoke column confirmed in Sierra Morena",
    event: {
      source: "scenario",
      title: "Smoke column confirmed in Sierra Morena",
      description: "Forest watch confirms active front advancing south.",
      zoneId: "zone-north",
      category: "incendio",
      severity: "high",
      confidence: "high",
      confirmed: true,
    },
  },
  {
    id: "beat-2",
    atSeconds: 55,
    label: "Wind shifts and front threatens inhabited areas",
    event: {
      source: "scenario",
      title: "Wind shift towards inhabited areas",
      description: "Front turns southwest. Preventive evacuation becomes urgent.",
      zoneId: "zone-north",
      category: "evacuacion",
      severity: "critical",
      confidence: "high",
      confirmed: true,
    },
  },
  {
    id: "beat-3",
    atSeconds: 90,
    label: "Access road blocked",
    demoKind: "route-blocked",
  },
  {
    id: "beat-4",
    atSeconds: 125,
    label: "Assigned resource out of service",
    demoKind: "resource-down",
  },
  {
    id: "beat-5",
    atSeconds: 160,
    label: "Shelter saturation on the coast",
    event: {
      source: "scenario",
      title: "Costa del Sol shelters at capacity",
      description: "More displaced people arrive than expected and shelter capacity is exhausted.",
      zoneId: "zone-south",
      category: "refugio",
      severity: "high",
      confidence: "medium",
      confirmed: null,
    },
  },
  {
    id: "beat-6",
    atSeconds: 200,
    label: "Messaging integration failure",
    demoKind: "integration-failure",
  },
];

/**
 * Initial state of the simulated world. What the scenario engine moves and
 * what, upon changing, breaks the assumptions declared by the plan.
 */
export const seedWorld: WorldState = {
  windDirection: "NE",
  windSpeedKmh: 22,
  blockedRoads: [],
  smsOperational: true,
  voiceOperational: true,
  hospitalBeds: {
    "hospital-costa-del-sol": 14,
    "hospital-serrania": 8,
  },
  updatedAt: now,
};

/**
 * Graduated autonomy. The criterion is reversibility: what can be undone
 * the system does autonomously; what cannot always passes through a human.
 * A system that asks permission for everything is not agentic; one that asks
 * for nothing is not supervisable.
 */
export const seedAutonomyRules: AutonomyRule[] = [
  {
    actionKind: "verificar",
    reversibility: "reversible",
    level: "auto",
    rationale: "Calling to verify a data point commits nothing and reduces uncertainty.",
  },
  {
    actionKind: "avisar",
    reversibility: "reversible",
    level: "auto-notify",
    rationale: "Notifying a lead is reversible; logged for subsequent review.",
  },
  {
    actionKind: "asignar-recurso",
    reversibility: "reversible",
    level: "auto-notify",
    rationale:
      "Moving a resource is reversible, and waiting for approval costs unavailable minutes.",
  },
  {
    actionKind: "aviso-masivo",
    reversibility: "partial",
    level: "approval",
    confidenceThreshold: 0.9,
    rationale:
      "A public alert cannot be withdrawn. Automated only with very high confidence; below that, approved by a person.",
  },
  {
    actionKind: "evacuar",
    reversibility: "irreversible",
    level: "approval",
    rationale: "Ordering an evacuation moves vulnerable people. Always decided by a person.",
  },
  {
    actionKind: "escalar",
    reversibility: "irreversible",
    level: "approval",
    rationale:
      "Requesting external reinforcements commits external resources and cannot be undone.",
  },
];

/**
 * Initial reliability per source. Learning adjusts it based on observations
 * across previous executions.
 */
export const seedSourceReliability: SourceReliability[] = [
  { source: "sensor", reliability: 0.9, observations: 0, confirmed: 0 },
  { source: "operator", reliability: 0.95, observations: 0, confirmed: 0 },
  { source: "happyrobot", reliability: 0.85, observations: 0, confirmed: 0 },
  { source: "public", reliability: 0.55, observations: 0, confirmed: 0 },
  { source: "demo", reliability: 0.8, observations: 0, confirmed: 0 },
  { source: "scenario", reliability: 0.9, observations: 0, confirmed: 0 },
];
