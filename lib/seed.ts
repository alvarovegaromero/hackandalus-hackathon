import type { Action, CrisisEvent, CrisisZone, Resource } from "./types";

const now = new Date().toISOString();

export const seedZones: CrisisZone[] = [
  {
    id: "zone-north",
    name: "Sierra Morena",
    status: "watch",
    populationAtRisk: 1200,
    riskScore: 42,
    needs: ["evaluacion de monte"],
    coordinates: { x: 39, y: 32 },
    lastUpdatedAt: now
  },
  {
    id: "zone-central",
    name: "Sevilla Hub",
    status: "active",
    populationAtRisk: 3100,
    riskScore: 68,
    needs: ["alerta publica", "triaje sanitario"],
    coordinates: { x: 32, y: 52 },
    lastUpdatedAt: now
  },
  {
    id: "zone-east",
    name: "Granada y Almeria",
    status: "stable",
    populationAtRisk: 900,
    riskScore: 24,
    needs: ["vigilancia de rutas"],
    coordinates: { x: 72, y: 55 },
    lastUpdatedAt: now
  },
  {
    id: "zone-south",
    name: "Costa del Sol",
    status: "watch",
    populationAtRisk: 1750,
    riskScore: 35,
    needs: ["capacidad de refugios"],
    coordinates: { x: 54, y: 76 },
    lastUpdatedAt: now
  },
  {
    id: "zone-islands",
    name: "Cadiz y Estrecho",
    status: "stable",
    populationAtRisk: 640,
    riskScore: 18,
    needs: ["enlace logistico"],
    coordinates: { x: 22, y: 71 },
    lastUpdatedAt: now
  }
];

export const seedResources: Resource[] = [
  {
    id: "res-med-1",
    name: "EPES Sevilla Alpha",
    type: "sanitario",
    capacity: 24,
    status: "available",
    zoneId: "zone-central",
    assignedActionId: null
  },
  {
    id: "res-field-1",
    name: "INFOCA Sierra Bravo",
    type: "campo",
    capacity: 12,
    status: "available",
    zoneId: "zone-north",
    assignedActionId: null
  },
  {
    id: "res-transport-1",
    name: "Transporte Costa Uno",
    type: "transporte",
    capacity: 80,
    status: "available",
    zoneId: "zone-south",
    assignedActionId: null
  },
  {
    id: "res-comms-1",
    name: "Enlace 112",
    type: "comunicaciones",
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
    title: "Sevilla Hub comunica aumento de presion",
    description: "Varias entradas indican mayor necesidad de triaje y orientacion publica.",
    zoneId: "zone-central",
    category: "coordinacion",
    severity: "high",
    confidence: "high",
    createdAt: now,
    confirmed: true,
    dedupeKey: "zone-central:coordinacion:high"
  }
];

export const seedActions: Action[] = [
  {
    id: "act-seed-1",
    channel: "call",
    target: "Coordinador Sevilla Hub",
    objective: "Confirmar capacidad de triaje y pedir proxima ventana de actualizacion.",
    status: "pending",
    reason: "Sevilla Hub tiene la mayor puntuacion de riesgo inicial y demanda confirmada.",
    zoneId: "zone-central",
    resourceId: "res-comms-1",
    executionMode: "mock",
    createdAt: now,
    updatedAt: now
  }
];
