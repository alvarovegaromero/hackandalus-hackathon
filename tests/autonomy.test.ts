// OWNER: graduated autonomy and opportunity cost agent.

import { describe, expect, it } from "vitest";
import {
  autonomyDecisionFor,
  buildWaitingList,
  canAutoDispatch,
  categoriaDeAccion,
  classifyAction,
  decideAutonomy,
  describeAutonomy,
} from "@/lib/autonomy";
import { seedAutonomyRules, seedResources, seedZones } from "@/lib/seed";
import type { Action, ActionChannel, Resource } from "@/lib/types";

const zones = structuredClone(seedZones);
const reglas = structuredClone(seedAutonomyRules);

let contador = 0;

/** Minimal test action; only fields inspected by autonomy engine are populated. */
function accion(overrides: Partial<Action> & Pick<Action, "objective" | "zoneId">): Action {
  contador += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, contador)).toISOString();
  const id = overrides.id ?? `act-aut-${contador}`;
  const channel: ActionChannel = overrides.channel ?? "call";
  return {
    id,
    channel,
    target: "Responsable de zona",
    status: "pending",
    reason: "Prueba.",
    executionMode: "mock",
    attempt: 1,
    idempotencyKey: `${id}:1`,
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function recursos(): Resource[] {
  return structuredClone(seedResources);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("action type classification", () => {
  it("extracts category from objective written by store", () => {
    // store.ts always writes "Coordinar respuesta de <categoría> en <zona>",
    // so the word "coordinar" does not distinguish anything: the signal is the category.
    const objetivo = "Coordinar respuesta de incendio en Sierra Morena.";
    expect(categoriaDeAccion({ objective: objetivo })).toBe("incendio");
    expect(
      classifyAction({ objective: objetivo, channel: "call", target: "Coordinación INFOCA" }),
    ).toBe("asignar-recurso");
  });

  it("does not classify any objective as notification just because it starts with Coordinar", () => {
    const evacuacion = "Coordinar respuesta de evacuacion en Granada y Almería.";
    expect(classifyAction({ objective: evacuacion, channel: "call" })).toBe("evacuar");
  });

  it("classifies identically with and without accents", () => {
    expect(
      classifyAction({
        objective: "Coordinar respuesta de evacuación en Almería.",
        channel: "call",
      }),
    ).toBe("evacuar");
    expect(
      classifyAction({
        objective: "Coordinar respuesta de inundación en Almería.",
        channel: "call",
      }),
    ).toBe("asignar-recurso");
  });

  it("classifies an open verification action on a signal as verify", () => {
    expect(
      classifyAction({
        objective: "Coordinar respuesta de coordinacion en Sevilla Hub.",
        channel: "call",
        verifiesEventId: "evt-1",
      }),
    ).toBe("verificar");
  });

  it("classifies broadcast message to a group as mass notification even if not explicitly stated", () => {
    expect(
      classifyAction({
        objective: "Instrucciones de autoprotección",
        channel: "sms",
        target: "Población de Costa del Sol",
      }),
    ).toBe("aviso-masivo");
  });

  it("returns null when signal is insufficient", () => {
    expect(
      classifyAction({
        objective: "Gestionar el asunto de siempre.",
        channel: "ticket",
        target: "Equipo",
      }),
    ).toBeNull();
    expect(classifyAction({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Autonomy level by action type
// ---------------------------------------------------------------------------

describe("autonomy level by action type", () => {
  const casos = [
    {
      nombre: "verify a data point: executes automatically, is reversible",
      objetivo: "Verificar con el vigilante la columna de humo antes de movilizar.",
      canal: "call" as ActionChannel,
      tipo: "verificar" as const,
      nivel: "auto" as const,
    },
    {
      nombre: "notify a lead: executes automatically and notifies",
      objetivo: "Coordinar respuesta de coordinacion en Sevilla Hub.",
      canal: "call" as ActionChannel,
      tipo: "avisar" as const,
      nivel: "auto-notify" as const,
    },
    {
      nombre: "move a resource: executes automatically and can be undone",
      objetivo: "Coordinar respuesta de incendio en Sierra Morena.",
      canal: "call" as ActionChannel,
      tipo: "asignar-recurso" as const,
      nivel: "auto-notify" as const,
    },
    {
      nombre: "mass notification without known confidence: requires human approval",
      objetivo: "Aviso masivo a la población de Costa del Sol.",
      canal: "sms" as ActionChannel,
      tipo: "aviso-masivo" as const,
      nivel: "approval" as const,
    },
    {
      nombre: "order an evacuation: always requires human approval",
      objetivo: "Coordinar respuesta de evacuacion en Granada y Almería.",
      canal: "call" as ActionChannel,
      tipo: "evacuar" as const,
      nivel: "approval" as const,
    },
    {
      nombre: "request external reinforcements: always requires human approval",
      objetivo: "Coordinar respuesta de resource-shortage en Sevilla Hub.",
      canal: "ticket" as ActionChannel,
      tipo: "escalar" as const,
      nivel: "approval" as const,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      const decision = decideAutonomy({ objective: caso.objetivo, channel: caso.canal }, reglas);
      expect(decision.actionKind).toBe(caso.tipo);
      expect(decision.level).toBe(caso.nivel);
      expect(decision.reason.length).toBeGreaterThan(20);
    });
  }

  it("reason can be presented to an evaluation panel", () => {
    const decision = decideAutonomy(
      { objective: "Coordinar respuesta de coordinacion en Sevilla Hub.", channel: "call" },
      reglas,
    );
    expect(decision.reason).toContain("Se ejecuta sola");
    expect(decision.reason).toContain("reversible");
  });
});

// ---------------------------------------------------------------------------
// Confidence threshold
// ---------------------------------------------------------------------------

describe("mass notification and confidence threshold", () => {
  const avisoMasivo = {
    objective: "Aviso masivo a la población de Costa del Sol.",
    channel: "sms" as ActionChannel,
  };

  it("waits for human approval below threshold", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, { confidence: 0.75 });
    expect(decision.actionKind).toBe("aviso-masivo");
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("75 %");
    expect(decision.reason).toContain("90 %");
  });

  it("executes automatically and notifies above threshold", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, { confidence: 0.95 });
    expect(decision.level).toBe("auto-notify");
    expect(decision.reason).toContain("supera");
  });

  it("automates exactly at threshold; slightly below does not", () => {
    expect(decideAutonomy(avisoMasivo, reglas, { confidence: 0.9 }).level).toBe("auto-notify");
    expect(decideAutonomy(avisoMasivo, reglas, { confidence: 0.899 }).level).toBe("approval");
  });

  it("chooses the most conservative level without known confidence", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {});
    expect(decision.confidence).toBeNull();
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("no se conoce la confianza");
  });

  it("a confirmed high-confidence signal exceeds threshold without calibrated triage", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {
      event: { category: "alerta publica", confidence: "high", confirmed: true },
    });
    expect(decision.confidence).toBe(0.95);
    expect(decision.level).toBe("auto-notify");
  });

  it("the same unverified signal remains waiting for approval", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {
      event: { category: "alerta publica", confidence: "high", confirmed: null },
    });
    expect(decision.level).toBe("approval");
  });
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

describe("autonomy guardrails", () => {
  it("an unclassified action falls back to human approval", () => {
    const decision = decideAutonomy(
      { objective: "Gestionar el asunto de siempre.", channel: "ticket", target: "Equipo" },
      reglas,
    );
    expect(decision.actionKind).toBeNull();
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("no se ha podido clasificar");
  });

  it("automates nothing without loaded rules", () => {
    expect(decideAutonomy({ objective: "Verificar el dato.", channel: "call" }, []).level).toBe(
      "approval",
    );
    expect(decideAutonomy({ objective: "Verificar el dato.", channel: "call" }, null).level).toBe(
      "approval",
    );
  });

  it("master switch forces approval on all action types", () => {
    const objetivos = [
      "Verificar con el vigilante la columna de humo antes de movilizar.",
      "Coordinar respuesta de coordinacion en Sevilla Hub.",
      "Coordinar respuesta de incendio en Sierra Morena.",
      "Aviso masivo a la población de Costa del Sol.",
      "Coordinar respuesta de evacuacion en Granada y Almería.",
      "Coordinar respuesta de resource-shortage en Sevilla Hub.",
    ];

    for (const objetivo of objetivos) {
      const decision = decideAutonomy({ objective: objetivo, channel: "call" }, reglas, {
        autonomyPaused: true,
        confidence: 1,
      });
      expect(decision.level).toBe("approval");
      expect(decision.reason).toContain("autonomía está en pausa");
    }
  });

  it("an irreversible action is not automated even with confidence 1", () => {
    const evacuacion = decideAutonomy(
      { objective: "Coordinar respuesta de evacuacion en Granada y Almería.", channel: "call" },
      reglas,
      { confidence: 1 },
    );
    expect(evacuacion.level).toBe("approval");
    expect(evacuacion.reversibility).toBe("irreversible");
    expect(evacuacion.reason).toContain("irreversible");

    const escalado = decideAutonomy(
      { objective: "Coordinar respuesta de resource-shortage en Sevilla Hub.", channel: "ticket" },
      reglas,
      { confidence: 1 },
    );
    expect(escalado.level).toBe("approval");
  });

  it("even if a loose rule says auto, irreversible actions still wait for a human", () => {
    const reglaFloja = [
      {
        actionKind: "evacuar" as const,
        reversibility: "irreversible" as const,
        level: "auto" as const,
        confidenceThreshold: 0.1,
        rationale: "Regla mal configurada a propósito para la prueba.",
      },
    ];
    const decision = decideAutonomy(
      { objective: "Coordinar respuesta de evacuacion en Costa del Sol.", channel: "call" },
      reglaFloja,
      { confidence: 1 },
    );
    expect(decision.level).toBe("approval");
  });

  it("an action already approved by a human is not downgraded by the engine", () => {
    const decision = decideAutonomy(
      {
        objective: "Coordinar respuesta de evacuacion en Granada y Almería.",
        channel: "call",
        status: "approved",
        approvedBy: "operator",
      },
      reglas,
    );
    expect(decision.level).toBe("auto");
    expect(decision.reason).toContain("Ya la aprobó una persona");
  });
});

// ---------------------------------------------------------------------------
// Dispatch guardian
// ---------------------------------------------------------------------------

describe("canAutoDispatch", () => {
  const estado = { autonomyRules: reglas, autonomyPaused: false, events: [] };

  it("allows a newly proposed verification to dispatch automatically", () => {
    const action = accion({
      objective: "Verificar con el vigilante la columna de humo antes de movilizar.",
      zoneId: "zone-north",
    });
    expect(canAutoDispatch(action, estado)).toBe(true);
    expect(autonomyDecisionFor(action, estado).level).toBe("auto");
  });

  it("holds an evacuation even if everything else is in order", () => {
    const action = accion({
      objective: "Coordinar respuesta de evacuacion en Granada y Almería.",
      zoneId: "zone-east",
    });
    expect(canAutoDispatch(action, estado)).toBe(false);
  });

  it("returns false on any missing information", () => {
    const action = accion({ objective: "Verificar el dato.", zoneId: "zone-north" });
    expect(canAutoDispatch(null, estado)).toBe(false);
    expect(canAutoDispatch(action, null)).toBe(false);
    expect(canAutoDispatch(action, { autonomyRules: [], autonomyPaused: false })).toBe(false);
    // State without switch is not state with autonomy on.
    expect(
      canAutoDispatch(action, {
        autonomyRules: reglas,
        autonomyPaused: undefined as unknown as boolean,
      }),
    ).toBe(false);
    expect(canAutoDispatch({ ...action, objective: "" }, estado)).toBe(false);
  });

  it("does not re-dispatch an action that is no longer pending", () => {
    const action = accion({
      objective: "Verificar el dato.",
      zoneId: "zone-north",
      status: "running",
    });
    expect(canAutoDispatch(action, estado)).toBe(false);
  });

  it("dispatches nothing when autonomy is paused", () => {
    const action = accion({ objective: "Verificar el dato.", zoneId: "zone-north" });
    expect(canAutoDispatch(action, { ...estado, autonomyPaused: true })).toBe(false);
  });

  it("uses zone signal to measure confidence of mass notification", () => {
    const action = accion({
      objective: "Coordinar respuesta de alerta publica en Sevilla Hub.",
      zoneId: "zone-central",
      channel: "sms",
      target: "Población de Sevilla",
    });
    const conSenal = {
      autonomyRules: reglas,
      autonomyPaused: false,
      events: [
        {
          id: "evt-1",
          source: "sensor" as const,
          title: "Aviso confirmado",
          description: "Confirmado por sensor.",
          zoneId: "zone-central",
          category: "alerta publica",
          severity: "critical" as const,
          confidence: "high" as const,
          createdAt: new Date().toISOString(),
          confirmed: true,
          dedupeKey: "zone-central:alerta publica:critical",
          occurrences: 1,
          appliedRiskDelta: 0,
          appliedNeed: null,
          previousZoneStatus: null,
        },
      ],
    };
    expect(autonomyDecisionFor(action, conSenal).confidence).toBe(0.95);
    expect(canAutoDispatch(action, conSenal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Policy summary
// ---------------------------------------------------------------------------

describe("policy summary", () => {
  it("counts how many types dispatch automatically and how many require human signature", () => {
    const resumen = describeAutonomy(reglas);
    expect(resumen.lines).toHaveLength(6);
    expect(resumen.headline).toContain("3 de 6");
    expect(resumen.headline).toContain("1 solo con confianza muy alta");
    expect(resumen.headline).toContain("2 los firma siempre una persona");
  });

  it("clearly states when autonomy is paused", () => {
    expect(describeAutonomy(reglas, { paused: true }).headline).toContain("Autonomía en pausa");
  });

  it("each line explains level, reversibility, and reason", () => {
    const linea = describeAutonomy(reglas).lines.find((item) => item.actionKind === "aviso-masivo");
    expect(linea).toBeDefined();
    expect(linea!.text).toContain("parcialmente reversible");
    expect(linea!.text).toContain("90 %");
  });
});

// ---------------------------------------------------------------------------
// Waiting list
// ---------------------------------------------------------------------------

describe("waiting list", () => {
  it("with two zones contending for a resource, one waits with estimated time and reason", () => {
    // Only the firefighting crew remains and there are two open fires.
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const sevilla = accion({
      id: "act-sevilla",
      objective: "Coordinar respuesta de incendio en Sevilla Hub.",
      zoneId: "zone-central",
    });
    const sierra = accion({
      id: "act-sierra",
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north",
    });

    const espera = buildWaitingList([sevilla, sierra], brigada, zones);

    // Sevilla Hub is more urgent (active, more population), so it gets the crew.
    expect(espera).toHaveLength(1);
    expect(espera[0].actionId).toBe("act-sierra");
    expect(espera[0].zoneId).toBe("zone-north");
    expect(espera[0].wantedResourceId).toBe("res-field-1");
    expect(espera[0].blockedByActionId).toBe("act-sevilla");
    expect(espera[0].estimatedWaitMinutes).toBe(45);
    expect(espera[0].reason).toContain("INFOCA Sierra Bravo");
    expect(espera[0].reason).toContain("Espera estimada: ~45 min");
  });

  it("third zone in queue waits longer than second", () => {
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const acciones = [
      accion({
        id: "act-1",
        objective: "Coordinar respuesta de incendio en Sevilla Hub.",
        zoneId: "zone-central",
      }),
      accion({
        id: "act-2",
        objective: "Coordinar respuesta de incendio en Sierra Morena.",
        zoneId: "zone-north",
      }),
      accion({
        id: "act-3",
        objective: "Coordinar respuesta de incendio en Costa del Sol.",
        zoneId: "zone-south",
      }),
    ];

    const espera = buildWaitingList(acciones, brigada, zones);
    expect(espera).toHaveLength(2);
    const minutos = espera.map((item) => item.estimatedWaitMinutes ?? 0);
    expect(minutos[1]).toBeGreaterThan(minutos[0]);
    expect(espera[1].reason).toContain("por delante en la cola");
  });

  it("without any capable resource, wait is not estimable and states so", () => {
    const soloComunicaciones = recursos().filter((resource) => resource.id === "res-comms-1");
    const accionIncendio = accion({
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north",
    });

    const espera = buildWaitingList([accionIncendio], soloComunicaciones, zones);
    expect(espera).toHaveLength(1);
    expect(espera[0].estimatedWaitMinutes).toBeNull();
    expect(espera[0].blockedByActionId).toBeNull();
    expect(espera[0].reason).toContain("apoyo externo");
  });

  it("waiting list is empty when surplus resources exist", () => {
    const accionTriaje = accion({
      objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
      zoneId: "zone-central",
    });
    expect(buildWaitingList([accionTriaje], recursos(), zones)).toEqual([]);
  });

  it("closed actions do not occupy space in queue", () => {
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const cerrada = accion({
      id: "act-cerrada",
      objective: "Coordinar respuesta de incendio en Sevilla Hub.",
      zoneId: "zone-central",
      status: "succeeded",
    });
    const abierta = accion({
      id: "act-abierta",
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north",
    });

    expect(buildWaitingList([cerrada, abierta], brigada, zones)).toEqual([]);
  });
});
