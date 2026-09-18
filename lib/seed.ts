import type { Action, Contact, CrisisEvent, CrisisZone, Resource, ScenarioBeat } from "./types";

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
    name: "Granada y Almería",
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
    name: "Cádiz y Estrecho",
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
    homeZoneId: "zone-central",
    capabilities: ["triaje", "sanitario", "evacuacion"],
    assignedActionId: null,
    assignedAt: null
  },
  {
    id: "res-field-1",
    name: "INFOCA Sierra Bravo",
    type: "campo",
    capacity: 12,
    status: "available",
    zoneId: "zone-north",
    homeZoneId: "zone-north",
    capabilities: ["extincion", "evaluacion de monte", "campo"],
    assignedActionId: null,
    assignedAt: null
  },
  {
    id: "res-transport-1",
    name: "Transporte Costa Uno",
    type: "transporte",
    capacity: 80,
    status: "available",
    zoneId: "zone-south",
    homeZoneId: "zone-south",
    capabilities: ["evacuacion", "transporte", "refugio"],
    assignedActionId: null,
    assignedAt: null
  },
  {
    id: "res-comms-1",
    name: "Enlace 112",
    type: "comunicaciones",
    capacity: 1,
    status: "available",
    zoneId: null,
    homeZoneId: null,
    capabilities: ["coordinacion", "alerta publica", "comunicaciones"],
    assignedActionId: null,
    assignedAt: null
  },
  {
    id: "res-med-2",
    name: "EPES Granada Delta",
    type: "sanitario",
    capacity: 18,
    status: "available",
    zoneId: "zone-east",
    homeZoneId: "zone-east",
    capabilities: ["triaje", "sanitario"],
    assignedActionId: null,
    assignedAt: null
  }
];

/**
 * Contactos de demo. Solo los marcados con demoSafe pueden recibir acciones
 * reales a traves de HappyRobot; el resto se queda siempre en modo simulado.
 * Los telefonos y correos son marcadores de posicion, nunca datos reales.
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
    responsiveness: 0.8
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
    responsiveness: 0.75
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
    responsiveness: 0.9
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
    responsiveness: 0.6
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
    responsiveness: 0.45
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
    responsiveness: 0.5
  }
];

export const seedEvents: CrisisEvent[] = [
  {
    id: "evt-seed-1",
    source: "operator",
    title: "Sevilla Hub comunica aumento de presión",
    description: "Varias entradas indican mayor necesidad de triaje y orientación pública.",
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
    previousZoneStatus: null
  }
];

export const seedActions: Action[] = [
  {
    id: "act-seed-1",
    channel: "call",
    target: "Coordinador Sevilla Hub",
    objective: "Confirmar capacidad de triaje y pedir próxima ventana de actualización.",
    status: "pending",
    reason: "Sevilla Hub tiene la mayor puntuación de riesgo inicial y demanda confirmada.",
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
    updatedAt: now
  }
];

/**
 * Guion por defecto del escenario que avanza solo: un incendio forestal que
 * cambia de frente, corta una carretera y tumba un recurso mientras el sistema
 * esta ejecutando acciones.
 */
export const seedScenarioBeats: ScenarioBeat[] = [
  {
    id: "beat-1",
    atSeconds: 20,
    label: "Columna de humo confirmada en Sierra Morena",
    event: {
      source: "scenario",
      title: "Columna de humo confirmada en Sierra Morena",
      description: "Vigilancia forestal confirma frente activo avanzando hacia el sur.",
      zoneId: "zone-north",
      category: "incendio",
      severity: "high",
      confidence: "high",
      confirmed: true
    }
  },
  {
    id: "beat-2",
    atSeconds: 55,
    label: "El viento gira y el frente amenaza núcleos habitados",
    event: {
      source: "scenario",
      title: "Cambio de viento hacia núcleos habitados",
      description: "El frente gira al suroeste. La evacuación preventiva pasa a ser urgente.",
      zoneId: "zone-north",
      category: "evacuacion",
      severity: "critical",
      confidence: "high",
      confirmed: true
    }
  },
  {
    id: "beat-3",
    atSeconds: 90,
    label: "Carretera de acceso cortada",
    demoKind: "route-blocked"
  },
  {
    id: "beat-4",
    atSeconds: 125,
    label: "Un recurso asignado queda fuera de servicio",
    demoKind: "resource-down"
  },
  {
    id: "beat-5",
    atSeconds: 160,
    label: "Saturación de refugios en la costa",
    event: {
      source: "scenario",
      title: "Refugios de la Costa del Sol al límite",
      description: "Llegan más desplazados de los previstos y la capacidad de refugio se agota.",
      zoneId: "zone-south",
      category: "refugio",
      severity: "high",
      confidence: "medium",
      confirmed: null
    }
  },
  {
    id: "beat-6",
    atSeconds: 200,
    label: "Caída de la integración de mensajería",
    demoKind: "integration-failure"
  }
];
