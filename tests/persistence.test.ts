// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
//
// Cubre las tres cosas que pueden arruinar una demo: un fichero de estado
// corrupto que impide arrancar, un dato personal escrito en disco, y un
// aprendizaje que se dispara con dos muestras.
//
// Todo se escribe en un directorio temporal via CRISIS_DATA_DIR: estos tests
// nunca tocan el `.data` del repositorio.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDigitalTwin } from "@/lib/digitalTwin";
import { diffPlans } from "@/lib/history";
import {
  MIN_RUNS_TO_LEARN,
  MAX_UNCONFIRMED_PENALTY,
  buildRunRecord,
  emptyWeights,
  explainWeights,
  recordActionOutcome,
  weightsFromRuns
} from "@/lib/learning";
import {
  SCHEMA_VERSION,
  STATE_FILE,
  discardPendingState,
  flushState,
  loadRuns,
  loadState,
  loadWeights,
  resolveDataDir,
  saveRun,
  saveState,
  saveWeights,
  validateState
} from "@/lib/persistence";
import { addEvent, getSituation, resetSituation } from "@/lib/store";
import type { Action, IntegrationState, Plan, RunRecord, SituationState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Utillaje
// ---------------------------------------------------------------------------

let tempDir = "";

function statePath() {
  return path.join(resolveDataDir(), STATE_FILE);
}

function writeRawState(content: string) {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
  fs.writeFileSync(statePath(), content, "utf8");
}

function makePlan(version: number, overrides: Partial<Plan> = {}): Plan {
  return {
    id: `plan-${version}`,
    version,
    previousVersion: version > 1 ? version - 1 : null,
    generatedAt: "2026-02-01T10:00:00.000Z",
    summary: "Resumen del plan",
    priorities: [
      { zoneId: "zone-central", score: 120, reason: "Zona con más población en riesgo", factors: [] },
      { zoneId: "zone-north", score: 90, reason: "Frente de incendio activo", factors: [] }
    ],
    proposedActionIds: ["act-1"],
    invalidatedActionIds: [],
    changes: [],
    trigger: "replanificación",
    ...overrides
  };
}

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "act-1",
    channel: "call",
    target: "Coordinación INFOCA",
    objective: "Confirmar la evacuación de la aldea",
    status: "pending",
    reason: "Zona crítica",
    zoneId: "zone-north",
    executionMode: "mock",
    attempt: 1,
    idempotencyKey: "act-1-1",
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: "2026-02-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    ...overrides
  };
}

function makeIntegration(overrides: Partial<IntegrationState> = {}): IntegrationState {
  return {
    mode: "mock",
    happyRobotConfigured: false,
    lastExternalError: null,
    liveActionsExecuted: 0,
    mockActionsExecuted: 0,
    ...overrides
  };
}

function makeState(overrides: Partial<SituationState> = {}): SituationState {
  return {
    events: [
      {
        id: "evt-1",
        source: "operator",
        title: "Aviso vecinal",
        description: "Llamada al 600 123 456 y correo a vecino@ejemplo.es avisando de humo.",
        zoneId: "zone-north",
        category: "incendio",
        severity: "high",
        confidence: "medium",
        createdAt: "2026-02-01T09:50:00.000Z",
        confirmed: null,
        dedupeKey: "zone-north:incendio:high",
        occurrences: 1,
        appliedRiskDelta: 10,
        appliedNeed: null,
        previousZoneStatus: null
      }
    ],
    zones: [
      {
        id: "zone-north",
        name: "Sierra Morena",
        status: "watch",
        populationAtRisk: 1200,
        riskScore: 40,
        needs: ["evacuacion"],
        coordinates: { x: 10, y: 20 },
        lastUpdatedAt: "2026-02-01T09:55:00.000Z"
      },
      {
        id: "zone-central",
        name: "Sevilla Hub",
        status: "active",
        populationAtRisk: 4000,
        riskScore: 55,
        needs: [],
        coordinates: { x: 30, y: 40 },
        lastUpdatedAt: "2026-02-01T09:55:00.000Z"
      }
    ],
    resources: [
      {
        id: "res-1",
        name: "EPES Sevilla Alpha",
        type: "medico",
        capacity: 4,
        status: "available",
        zoneId: "zone-central",
        assignedActionId: null,
        capabilities: ["triaje"],
        homeZoneId: "zone-central",
        assignedAt: null
      }
    ],
    contacts: [
      {
        id: "con-1",
        name: "Coordinación INFOCA",
        role: "field-coordinator",
        zoneId: "zone-north",
        channels: ["call", "sms"],
        phone: "+34 600 123 456",
        email: "coordinacion@ejemplo.es",
        demoSafe: true,
        lastContactedAt: null,
        responsiveness: 0.8
      }
    ],
    chains: [],
    actions: [makeAction()],
    plan: makePlan(3),
    planHistory: [makePlan(2)],
    audit: [
      {
        id: "aud-1",
        at: "2026-02-01T10:00:00.000Z",
        actor: "operator",
        kind: "nota",
        summary: "Se avisó al +34 600 123 456 desde soporte@ejemplo.es.",
        planVersion: 3
      }
    ],
    scenario: {
      id: "sc-1",
      name: "Incendio en Sierra Morena",
      description: "Guion de demo",
      running: false,
      startedAt: null,
      elapsedSeconds: 0,
      beats: [],
      firedBeatIds: []
    },
    learning: emptyWeights(),
    integration: makeIntegration(),
    world: {
      windDirection: "NE",
      windSpeedKmh: 22,
      blockedRoads: [],
      smsOperational: true,
      voiceOperational: true,
      hospitalBeds: {},
      updatedAt: "2026-02-01T10:00:00.000Z"
    },
    digitalTwin: buildDigitalTwin(
      {
        windDirection: "NE",
        windSpeedKmh: 22,
        blockedRoads: [],
        smsOperational: true,
        voiceOperational: true,
        hospitalBeds: {},
        updatedAt: "2026-02-01T10:00:00.000Z"
      },
      [],
      { now: "2026-02-01T10:00:00.000Z" }
    ),
    autonomyRules: [],
    autonomyPaused: false,
    waiting: [],
    sourceReliability: [],
    lessons: [],
    ...overrides
  };
}

function makeRun(id: string, notes: string[]): RunRecord {
  return {
    id,
    scenarioId: "sc-1",
    startedAt: "2026-02-01T09:00:00.000Z",
    endedAt: "2026-02-01T10:00:00.000Z",
    actionsTotal: 0,
    actionsSucceeded: 0,
    actionsFailed: 0,
    planVersions: 1,
    notes
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crisis-persist-"));
  process.env.CRISIS_DATA_DIR = tempDir;
  process.env.CRISIS_PERSISTENCE = "on";
  process.env.ACTION_EXECUTION_MODE = "mock";
  discardPendingState();
});

afterEach(() => {
  discardPendingState();
  delete process.env.CRISIS_PERSISTENCE;
  delete process.env.CRISIS_DATA_DIR;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

describe("persistencia del estado", () => {
  it("guarda y recupera el estado completo", () => {
    const state = makeState();
    saveState(state);
    flushState();

    const restored = loadState();
    expect(restored).not.toBeNull();
    expect(restored?.plan.version).toBe(3);
    expect(restored?.zones).toHaveLength(2);
    expect(restored?.events[0].id).toBe("evt-1");
    expect(restored?.planHistory[0].version).toBe(2);
    // store.ts hace exactamente esto al arrancar: no puede reventar.
    expect(restored!.plan.version + 1).toBe(4);
  });

  it("devuelve null si no hay fichero", () => {
    expect(loadState()).toBeNull();
  });

  it("descarta un fichero corrupto en vez de propagar basura", () => {
    writeRawState("{{{ esto no es json");
    expect(loadState()).toBeNull();
  });

  it("descarta un fichero truncado a mitad de escritura", () => {
    saveState(makeState());
    flushState();
    const complete = fs.readFileSync(statePath(), "utf8");
    writeRawState(complete.slice(0, Math.floor(complete.length / 2)));
    expect(loadState()).toBeNull();
  });

  it("descarta un estado de una version anterior del esquema", () => {
    writeRawState(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION - 1,
        savedAt: "2026-01-01T00:00:00.000Z",
        payload: makeState()
      })
    );
    expect(loadState()).toBeNull();
  });

  it("descarta un estado sin plan, que reventaría a store.ts al arrancar", () => {
    const sinPlan = makeState() as unknown as Record<string, unknown>;
    delete sinPlan.plan;
    writeRawState(JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: "x", payload: sinPlan }));
    expect(loadState()).toBeNull();
    expect(validateState(sinPlan)).toBeNull();
  });

  it("descarta un estado con arrays que no son arrays", () => {
    const roto = makeState() as unknown as Record<string, unknown>;
    roto.actions = "ninguna";
    expect(validateState(roto)).toBeNull();
  });

  it("no escribe teléfonos ni correos en disco", () => {
    saveState(makeState());
    flushState();
    const raw = fs.readFileSync(statePath(), "utf8");

    expect(raw).not.toContain("600 123 456");
    expect(raw).not.toContain("600123456");
    expect(raw).not.toContain("coordinacion@ejemplo.es");
    expect(raw).not.toContain("vecino@ejemplo.es");
    expect(raw).not.toContain("soporte@ejemplo.es");
    expect(raw).toContain("[correo omitido]");
    expect(raw).toContain("[telefono omitido]");

    const persisted = JSON.parse(raw).payload as SituationState;
    expect(persisted.contacts[0].phone).toBeNull();
    expect(persisted.contacts[0].email).toBeNull();
    // Lo operativo sí se conserva: sin esto no se podría restaurar el plan.
    expect(persisted.contacts[0].channels).toEqual(["call", "sms"]);
  });

  it("no escribe nada si la persistencia está apagada", () => {
    delete process.env.CRISIS_PERSISTENCE;
    saveState(makeState());
    flushState();
    expect(fs.existsSync(statePath())).toBe(false);
    expect(loadState()).toBeNull();
  });

  it("agrupa las escrituras y conserva el último estado", () => {
    // Una replanificacion detras de otra no debe machacar el disco, pero lo
    // ultimo guardado no se puede perder.
    saveState(makeState({ plan: makePlan(10) }));
    saveState(makeState({ plan: makePlan(11) }));
    saveState(makeState({ plan: makePlan(12) }));
    expect(fs.existsSync(statePath())).toBe(false); // aún no ha tocado el disco

    flushState();
    expect(loadState()?.plan.version).toBe(12);
  });

  it("no lanza nunca, ni con un directorio imposible", () => {
    process.env.CRISIS_DATA_DIR = path.join(tempDir, "fichero-no-directorio", "sub");
    fs.writeFileSync(path.join(tempDir, "fichero-no-directorio"), "soy un fichero", "utf8");

    expect(() => saveState(makeState())).not.toThrow();
    expect(() => flushState()).not.toThrow();
    expect(loadState()).toBeNull();
  });
});

describe("persistencia de ejecuciones y pesos", () => {
  it("guarda y recupera ejecuciones, y actualiza por id sin duplicar", () => {
    saveRun(makeRun("run-1", ["stat:channel:call:3/4"]));
    saveRun(makeRun("run-2", ["stat:channel:sms:1/2"]));
    saveRun(makeRun("run-1", ["stat:channel:call:4/4"]));

    const runs = loadRuns();
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.id === "run-1")?.notes).toEqual(["stat:channel:call:4/4"]);
  });

  it("descarta ejecuciones rotas sin perder el resto del historial", () => {
    saveRun(makeRun("run-1", ["stat:channel:call:3/4"]));
    const file = path.join(resolveDataDir(), "runs.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    envelope.payload.push({ id: "run-roto" });
    fs.writeFileSync(file, JSON.stringify(envelope), "utf8");

    const runs = loadRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("run-1");
  });

  it("guarda y recupera los pesos aprendidos", () => {
    const weights = emptyWeights();
    weights.channelStats.call = { attempts: 10, successes: 8 };
    weights.runsAnalyzed = 4;
    saveWeights(weights);

    const restored = loadWeights();
    expect(restored?.channelStats.call).toEqual({ attempts: 10, successes: 8 });
    expect(restored?.runsAnalyzed).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Reinicio real, a traves del store
// ---------------------------------------------------------------------------

describe("reinicio del proceso con CRISIS_PERSISTENCE=on", () => {
  it("recupera el estado y el plan tras simular un reinicio", () => {
    resetSituation();
    addEvent({
      source: "operator",
      title: "Salto de chispa en la A-66",
      description: "Testigo presencial informa de un nuevo foco.",
      zoneId: "zone-north",
      category: "incendio",
      severity: "critical",
      confidence: "high",
      confirmed: true
    });

    const antes = getSituation();
    flushState(); // el volcado diferido se fuerza, como haría el cierre del proceso

    // Simulamos el reinicio: se pierde toda la memoria del proceso.
    (globalThis as { crisisState?: unknown }).crisisState = undefined;

    const despues = getSituation();
    expect(despues.events.map((event) => event.title)).toContain("Salto de chispa en la A-66");
    expect(despues.plan.version).toBe(antes.plan.version);
    expect(despues.zones).toHaveLength(antes.zones.length);
    expect(despues.audit.length).toBeGreaterThan(0);

    // Y la siguiente replanificacion continua la numeracion, no la reinicia.
    addEvent({ zoneId: "zone-central", category: "refugio", severity: "medium" });
    expect(getSituation().plan.version).toBeGreaterThan(antes.plan.version);
  });

  it("arranca limpio si el fichero está corrupto, sin tumbar la aplicación", () => {
    resetSituation();
    flushState();
    writeRawState("no soy json");
    (globalThis as { crisisState?: unknown }).crisisState = undefined;

    expect(() => getSituation()).not.toThrow();
    expect(getSituation().plan.version).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Diferencias entre planes
// ---------------------------------------------------------------------------

describe("diffPlans", () => {
  const zones = [
    { id: "zone-north", name: "Sierra Morena", status: "watch" as const },
    { id: "zone-central", name: "Sevilla Hub", status: "active" as const }
  ];

  it("no inventa cambios cuando no hay plan anterior", () => {
    expect(diffPlans(null, makePlan(1))).toEqual([]);
  });

  it("detecta un adelantamiento en el ranking y lo cuenta con nombres", () => {
    const previous = makePlan(1);
    const next = makePlan(2, {
      priorities: [
        { zoneId: "zone-north", score: 200, reason: "Giro del viento", factors: [] },
        { zoneId: "zone-central", score: 120, reason: "Estable", factors: [] }
      ],
      trigger: "el giro del viento"
    });

    const changes = diffPlans(previous, next);
    const subida = changes.find((change) => change.kind === "priority-up");
    const bajada = changes.find((change) => change.kind === "priority-down");

    expect(subida?.label).toBe("Sierra Morena adelanta a Sevilla Hub");
    expect(subida?.detail).toContain("del puesto 2 al 1");
    expect(subida?.detail).toContain("el giro del viento");
    expect(bajada?.label).toContain("Sevilla Hub");
    // Nada de identificadores técnicos en pantalla.
    expect(subida?.label).not.toContain("zone-");
  });

  it("detecta acciones nuevas y acciones invalidadas", () => {
    const previous = makePlan(1, { proposedActionIds: ["act-1"] });
    const next = makePlan(2, {
      proposedActionIds: ["act-1", "act-2"],
      invalidatedActionIds: ["act-3"]
    });

    const changes = diffPlans(previous, next, {
      actions: [
        makeAction({ id: "act-2", channel: "sms", target: "Voluntariado Costa", objective: "Abrir refugio" }),
        makeAction({ id: "act-3", channel: "call", target: "Jefatura sanitaria", objective: "Enviar triaje" })
      ]
    });

    const nueva = changes.find((change) => change.kind === "action-added");
    const anulada = changes.find((change) => change.kind === "action-invalidated");

    expect(nueva?.label).toBe("Nueva acción: SMS a Voluntariado Costa");
    expect(nueva?.detail).toContain("Abrir refugio");
    expect(anulada?.label).toBe("Acción anulada: Llamada a Jefatura sanitaria");
  });

  it("detecta una acción que sale del plan porque la cancelaron", () => {
    const previous = makePlan(1, { proposedActionIds: ["act-1", "act-9"] });
    const next = makePlan(2, { proposedActionIds: ["act-1"] });

    const changes = diffPlans(previous, next, {
      actions: [makeAction({ id: "act-9", status: "cancelled", target: "Sala 112" })]
    });

    expect(
      changes.some((change) => change.kind === "action-invalidated" && change.detail.includes("canceló"))
    ).toBe(true);
  });

  it("no reporta como invalidada una acción que terminó bien", () => {
    const previous = makePlan(1, { proposedActionIds: ["act-1", "act-9"] });
    const next = makePlan(2, { proposedActionIds: ["act-1"] });

    const changes = diffPlans(previous, next, {
      actions: [makeAction({ id: "act-9", status: "succeeded" })]
    });

    expect(changes.some((change) => change.kind === "action-invalidated")).toBe(false);
  });

  it("detecta un cambio de estado de zona y dice si agrava o mejora", () => {
    const changes = diffPlans(makePlan(1), makePlan(2), {
      previousZones: zones,
      nextZones: [{ ...zones[0], status: "critical" }, zones[1]]
    });

    const cambio = changes.find((change) => change.kind === "zone-status");
    expect(cambio?.label).toBe("Sierra Morena pasa a crítica");
    expect(cambio?.detail).toContain("Se agrava");
    expect(cambio?.detail).toContain("en vigilancia");
  });

  it("detecta caídas y recuperaciones de la integración", () => {
    const caida = diffPlans(makePlan(1), makePlan(2), {
      previousIntegration: makeIntegration(),
      nextIntegration: makeIntegration({ lastExternalError: "502 desde la plataforma" })
    });
    expect(caida[0].kind).toBe("integration");
    expect(caida[0].label).toContain("fallando");
    expect(caida[0].detail).toContain("502 desde la plataforma");

    const vuelta = diffPlans(makePlan(1), makePlan(2), {
      previousIntegration: makeIntegration({ lastExternalError: "502" }),
      nextIntegration: makeIntegration({ mode: "happyrobot" })
    });
    expect(vuelta.some((change) => change.label.includes("modo real"))).toBe(true);
    expect(vuelta.some((change) => change.label.includes("vuelve a responder"))).toBe(true);
  });

  it("detecta la reasignación de un recurso", () => {
    const changes = diffPlans(makePlan(1), makePlan(2), {
      previousResources: [
        { id: "res-1", name: "EPES Sevilla Alpha", zoneId: "zone-central", status: "available" }
      ],
      nextResources: [{ id: "res-1", name: "EPES Sevilla Alpha", zoneId: "zone-north", status: "assigned" }]
    });

    const cambio = changes.find((change) => change.kind === "resource-reassigned");
    expect(cambio?.label).toBe("EPES Sevilla Alpha se mueve a Sierra Morena");
    expect(cambio?.detail).toContain("Sevilla Hub");
  });
});

// ---------------------------------------------------------------------------
// Aprendizaje
// ---------------------------------------------------------------------------

describe("aprendizaje entre ejecuciones", () => {
  it("no mueve ningún peso sin ejecuciones anteriores", () => {
    const weights = weightsFromRuns([]);
    expect(weights.runsAnalyzed).toBe(0);
    expect(weights.unconfirmedPenalty).toBe(0);
    expect(weights.channelStats).toEqual({});
    expect(weights.contactStats).toEqual({});
  });

  it("con dos ejecuciones y pocas muestras no publica ningún peso", () => {
    const runs = [
      makeRun("run-1", ["stat:channel:call:1/2", "stat:contact:con-1:0/1", "stat:unconfirmed:todas:2/3"]),
      makeRun("run-2", ["stat:channel:call:1/2", "stat:contact:con-1:1/2", "stat:unconfirmed:todas:2/3"])
    ];

    const weights = weightsFromRuns(runs);
    expect(weights.runsAnalyzed).toBe(2);
    // 4 intentos por llamada < 5, 3 avisos al contacto < 4: nada se publica.
    expect(weights.channelStats.call).toBeUndefined();
    expect(weights.contactStats["con-1"]).toBeUndefined();
    // Y con 2 ejecuciones (< 3) la penalización no se mueve aunque haya falsos.
    expect(weights.unconfirmedPenalty).toBe(0);
  });

  it("publica la tasa por canal y por contacto al superar el mínimo", () => {
    const runs = [
      makeRun("run-1", ["stat:channel:call:2/3", "stat:contact:con-1:1/2"]),
      makeRun("run-2", ["stat:channel:call:1/3", "stat:contact:con-1:2/3"]),
      makeRun("run-3", ["stat:channel:sms:1/1"])
    ];

    const weights = weightsFromRuns(runs);
    expect(weights.channelStats.call).toEqual({ attempts: 6, successes: 3 });
    expect(weights.contactStats["con-1"]).toEqual({ attempts: 5, successes: 3 });
    // El canal sms sigue por debajo del mínimo y no se expone.
    expect(weights.channelStats.sms).toBeUndefined();
  });

  it("sube la penalización de señales sin confirmar de forma gradual y acotada", () => {
    // Todas las señales verificadas resultaron falsas: el caso extremo.
    const todasFalsas = (id: string) => makeRun(id, ["stat:unconfirmed:todas:5/5"]);

    const tres = weightsFromRuns([todasFalsas("r1"), todasFalsas("r2"), todasFalsas("r3")]);
    const cinco = weightsFromRuns([
      todasFalsas("r1"),
      todasFalsas("r2"),
      todasFalsas("r3"),
      todasFalsas("r4"),
      todasFalsas("r5")
    ]);

    expect(tres.unconfirmedPenalty).toBeGreaterThan(0);
    expect(cinco.unconfirmedPenalty).toBeGreaterThan(tres.unconfirmedPenalty);
    expect(cinco.unconfirmedPenalty).toBeLessThanOrEqual(MAX_UNCONFIRMED_PENALTY);
    // Ni siquiera con el peor historial posible se pasa del tope.
    const muchas = weightsFromRuns(Array.from({ length: 30 }, (_, index) => todasFalsas(`r${index}`)));
    expect(muchas.unconfirmedPenalty).toBe(MAX_UNCONFIRMED_PENALTY);
  });

  it("no penaliza si las señales sin confirmar resultaron ciertas", () => {
    const ciertas = (id: string) => makeRun(id, ["stat:unconfirmed:todas:0/6"]);
    const weights = weightsFromRuns([ciertas("r1"), ciertas("r2"), ciertas("r3"), ciertas("r4")]);
    expect(weights.unconfirmedPenalty).toBe(0);
  });

  it("acumula el desenlace de las acciones durante la ejecución", () => {
    let weights = emptyWeights();
    weights = recordActionOutcome(weights, makeAction({ status: "succeeded", contactId: "con-1" }));
    weights = recordActionOutcome(weights, makeAction({ status: "failed", contactId: "con-1" }));

    expect(weights.channelStats.call).toEqual({ attempts: 2, successes: 1 });
    expect(weights.contactStats["con-1"]).toEqual({ attempts: 2, successes: 1 });
    expect(weights.updatedAt).not.toBeNull();
  });

  it("resume una ejecución en notas reutilizables", () => {
    const state = makeState({
      actions: [
        makeAction({ id: "a1", status: "succeeded", contactId: "con-1" }),
        makeAction({ id: "a2", status: "failed", contactId: "con-1" }),
        makeAction({ id: "a3", status: "pending" })
      ]
    });
    state.events[0].confirmed = false;

    const run = buildRunRecord(state, { id: "run-x" });
    expect(run.actionsTotal).toBe(3);
    expect(run.actionsSucceeded).toBe(1);
    expect(run.actionsFailed).toBe(1);
    expect(run.notes).toContain("stat:channel:call:1/2");
    expect(run.notes).toContain("stat:contact:con-1:1/2");
    expect(run.notes).toContain("stat:unconfirmed:todas:1/1");

    // El ciclo se cierra: las notas vuelven a convertirse en pesos.
    const weights = weightsFromRuns([run, run, run]);
    expect(weights.channelStats.call).toEqual({ attempts: 6, successes: 3 });
    expect(weights.runsAnalyzed).toBe(MIN_RUNS_TO_LEARN);
  });

  it("explica por qué cambió cada peso y por qué otros no", () => {
    const sinHistorial = explainWeights(emptyWeights(), []);
    expect(sinHistorial[0].detail).toContain("sin historial");

    const runs = [
      makeRun("r1", ["stat:channel:call:2/3", "stat:unconfirmed:todas:2/3"]),
      makeRun("r2", ["stat:channel:call:1/3", "stat:unconfirmed:todas:1/3"])
    ];
    const weights = weightsFromRuns(runs);
    const insights = explainWeights(weights, runs);

    const pendiente = insights.find((insight) => insight.key === "unconfirmed");
    expect(pendiente?.applied).toBe(false);
    expect(pendiente?.detail).toContain("sobrerreaccionar");
    expect(pendiente?.samples).toBe(6);

    const conPeso = explainWeights(
      weightsFromRuns([
        makeRun("r1", ["stat:channel:call:2/3", "stat:unconfirmed:todas:3/4"]),
        makeRun("r2", ["stat:channel:call:1/3", "stat:unconfirmed:todas:3/4"]),
        makeRun("r3", ["stat:channel:call:2/2", "stat:unconfirmed:todas:3/4"])
      ]),
      [
        makeRun("r1", ["stat:unconfirmed:todas:3/4"]),
        makeRun("r2", ["stat:unconfirmed:todas:3/4"]),
        makeRun("r3", ["stat:unconfirmed:todas:3/4"])
      ]
    );
    const canal = conPeso.find((insight) => insight.key === "channel:call");
    expect(canal?.applied).toBe(true);
    expect(canal?.samples).toBe(8);
    expect(canal?.label).toContain("%");
  });
});
