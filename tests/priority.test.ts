// OWNER: priority engine agent.
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  buildPlan,
  decayFactor,
  explainZone,
  occurrenceFactor,
  scoreZone,
  signalWeight,
} from "@/lib/priority";
import {
  addEvent,
  approveAction,
  getSituation,
  injectDemo,
  resetSituation,
  setActionStatus,
} from "@/lib/store";
import type { Action, CrisisEvent, CrisisZone, Resource } from "@/lib/types";

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "mock";
  resetSituation();
});

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Fixed reference timestamp: decay is deterministic in tests. */
const AHORA = "2026-03-01T12:00:00.000Z";

function haceMinutos(minutos: number) {
  return new Date(Date.parse(AHORA) - minutos * 60000).toISOString();
}

function zona(overrides: Partial<CrisisZone> = {}): CrisisZone {
  return {
    id: "zone-a",
    name: "Zona A",
    status: "watch",
    populationAtRisk: 600,
    riskScore: 20,
    needs: [],
    coordinates: { x: 0, y: 0, lat: 0, lng: 0 },
    lastUpdatedAt: AHORA,
    ...overrides,
  };
}

function senal(overrides: Partial<CrisisEvent> = {}): CrisisEvent {
  const base: CrisisEvent = {
    id: "evt-test",
    source: "sensor",
    title: "Señal de prueba",
    description: "Entrada sintética para pruebas del motor de prioridad.",
    zoneId: "zone-a",
    category: "incendio",
    severity: "medium",
    confidence: "medium",
    createdAt: AHORA,
    confirmed: null,
    dedupeKey: "zone-a:incendio:medium",
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
  };
  return { ...base, ...overrides };
}

function recurso(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "res-test",
    name: "Recurso de prueba",
    type: "campo",
    capacity: 10,
    status: "available",
    zoneId: "zone-a",
    homeZoneId: "zone-a",
    capabilities: [],
    assignedActionId: null,
    assignedAt: null,
    ...overrides,
  };
}

function accion(overrides: Partial<Action> = {}): Action {
  return {
    id: "act-test",
    channel: "call",
    target: "Responsable de zona",
    objective: "Coordinar respuesta.",
    status: "succeeded",
    reason: "Prueba.",
    zoneId: "zone-a",
    executionMode: "mock",
    attempt: 1,
    idempotencyKey: "act-test:1",
    stalledAfter: null,
    approvedBy: "operator",
    approvedAt: AHORA,
    completedAt: AHORA,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

function ranking(
  zonas: CrisisZone[],
  eventos: CrisisEvent[] = [],
  recursos: Resource[] = [],
  acciones: Action[] = [],
) {
  return buildPlan(2, zonas, eventos, recursos, acciones, [], { now: AHORA }).priorities;
}

// ---------------------------------------------------------------------------
// End-to-end behavior (original module tests)
// ---------------------------------------------------------------------------

describe("crisis priority engine", () => {
  it("scores high-confidence critical events above the seed priority", () => {
    addEvent({
      source: "demo",
      title: "Critical change",
      description: "A changing situation requires immediate replanning.",
      zoneId: "zone-north",
      category: "evacuation",
      severity: "critical",
      confidence: "high",
      confirmed: true,
    });

    const situation = getSituation();
    expect(situation.plan.priorities[0].zoneId).toBe("zone-north");
    expect(situation.plan.version).toBeGreaterThan(1);
  });

  it("deduplicates similar events inside a short time window", () => {
    const first = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "medium",
    });
    const second = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "high",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(
      getSituation().events.filter(
        (event) =>
          event.dedupeKey ===
          buildDedupeKey({
            zoneId: "zone-east",
            category: "route-blocked",
            severity: "high",
          }),
      ).length,
    ).toBe(1);
  });

  it("accounts for resource failures during replanning", () => {
    const before = getSituation().plan.version;
    const next = injectDemo("resource-down");

    expect(next.plan.version).toBeGreaterThan(before);
    expect(next.resources.some((resource) => resource.status === "unavailable")).toBe(true);
  });

  it("updates action state through approval and external callbacks", async () => {
    const action = getSituation().actions[0];
    const approved = await approveAction(action.id);
    expect(approved.status).toBe("succeeded");
    expect(approved.externalActionId).toMatch(/^mock-/);

    const failed = setActionStatus(
      action.id,
      "failed",
      approved.externalActionId,
      "callback failure",
    );
    expect(failed.status).toBe("failed");
    expect(getSituation().integration.lastExternalError).toBe("callback failure");
  });

  it("can score a zone without matching events", () => {
    const situation = getSituation();
    const zone = situation.zones.find((candidate) => candidate.id === "zone-south");

    expect(zone).toBeDefined();
    expect(scoreZone(zone!, [], situation.resources)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Table 1: signal weight
// ---------------------------------------------------------------------------

describe("signal weight table", () => {
  const casos: Array<{ nombre: string; evento: CrisisEvent; esperado: number }> = [
    {
      nombre: "critical confirmed with high confidence: full weight",
      evento: senal({ severity: "critical", confidence: "high", confirmed: true }),
      esperado: 160,
    },
    {
      nombre: "critical unverified with high confidence: slight penalty",
      evento: senal({ severity: "critical", confidence: "high", confirmed: null }),
      esperado: 160 * 0.85,
    },
    {
      nombre: "high confirmed with high confidence",
      evento: senal({ severity: "high", confidence: "high", confirmed: true }),
      esperado: 70,
    },
    {
      nombre: "high unverified with medium confidence: double penalty",
      evento: senal({ severity: "high", confidence: "medium", confirmed: null }),
      esperado: 70 * 0.75 * 0.6,
    },
    {
      nombre: "medium confirmed with medium confidence",
      evento: senal({ severity: "medium", confidence: "medium", confirmed: true }),
      esperado: 28 * 0.75,
    },
    {
      nombre: "low unverified with low confidence: noise, minimal weight",
      evento: senal({ severity: "low", confidence: "low", confirmed: null }),
      esperado: 8 * 0.4 * 0.3,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(signalWeight(caso.evento, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("an unverified signal always weighs less than the same confirmed signal", () => {
    const sinVerificar = senal({ severity: "high", confidence: "low", confirmed: null });
    const confirmada = senal({ severity: "high", confidence: "low", confirmed: true });

    expect(signalWeight(sinVerificar, { now: AHORA })).toBeLessThan(
      signalWeight(confirmada, { now: AHORA }),
    );
  });

  it("an unverified critical signal still weighs more than a confirmed low signal", () => {
    // Must decide even without complete data: credible critical signal dominates.
    const critica = senal({ severity: "critical", confidence: "high", confirmed: null });
    const baja = senal({ severity: "low", confidence: "high", confirmed: true });

    expect(signalWeight(critica, { now: AHORA })).toBeGreaterThan(
      signalWeight(baja, { now: AHORA }),
    );
  });
});

// ---------------------------------------------------------------------------
// Table 2: time decay
// ---------------------------------------------------------------------------

describe("time decay table", () => {
  const casos: Array<{ nombre: string; evento: CrisisEvent; esperado: number }> = [
    {
      nombre: "fresh arrival: full weight",
      evento: senal({ severity: "high", confirmed: true, createdAt: AHORA }),
      esperado: 1,
    },
    {
      nombre: "high confirmed at half-life (25 min): half weight",
      evento: senal({ severity: "high", confirmed: true, createdAt: haceMinutos(25) }),
      esperado: 0.5,
    },
    {
      nombre: "critical confirmed at 45 min: half weight",
      evento: senal({ severity: "critical", confirmed: true, createdAt: haceMinutos(45) }),
      esperado: 0.5,
    },
    {
      nombre: "low unverified at 12 min: barely counts",
      evento: senal({ severity: "low", confirmed: null, createdAt: haceMinutos(12) }),
      esperado: 0.25,
    },
    {
      nombre: "very old confirmed: never fully forgotten (floor 0.3)",
      evento: senal({ severity: "critical", confirmed: true, createdAt: haceMinutos(600) }),
      esperado: 0.3,
    },
    {
      nombre: "very old unverified: drops to floor 0.05",
      evento: senal({ severity: "low", confirmed: null, createdAt: haceMinutos(600) }),
      esperado: 0.05,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(decayFactor(caso.evento, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("what was known at 12:00 weighs less at 12:20", () => {
    const doce = senal({ severity: "high", confirmed: true, createdAt: AHORA });
    const doceVeinte = signalWeight(doce, { now: haceMinutos(-20) });

    expect(doceVeinte).toBeLessThan(signalWeight(doce, { now: AHORA }));
  });
});

// ---------------------------------------------------------------------------
// Table 3: repetitions with diminishing returns
// ---------------------------------------------------------------------------

describe("repetitions table", () => {
  const casos: Array<{ nombre: string; occurrences: number; esperado: number }> = [
    { nombre: "single occurrence: no reinforcement", occurrences: 1, esperado: 1 },
    { nombre: "two occurrences", occurrences: 2, esperado: 1 + Math.log(2) * 0.4 },
    { nombre: "five occurrences", occurrences: 5, esperado: 1 + Math.log(5) * 0.4 },
    {
      nombre: "twenty occurrences: cap 1.8, does not grow unbounded",
      occurrences: 20,
      esperado: 1.8,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(occurrenceFactor(caso.occurrences, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("repeating five times reinforces, but far below multiplying by five", () => {
    const unaVez = signalWeight(senal({ occurrences: 1 }), { now: AHORA });
    const cincoVeces = signalWeight(senal({ occurrences: 5 }), { now: AHORA });

    expect(cincoVeces).toBeGreaterThan(unaVez);
    expect(cincoVeces).toBeLessThan(unaVez * 2);
  });
});

// ---------------------------------------------------------------------------
// Table 4: decisions under incomplete information
// ---------------------------------------------------------------------------

describe("priority decision table", () => {
  const zonaB = (overrides: Partial<CrisisZone> = {}) =>
    zona({ id: "zone-b", name: "Zona B", ...overrides });

  const casos: Array<{
    nombre: string;
    zonas: CrisisZone[];
    eventos?: CrisisEvent[];
    recursos?: Resource[];
    acciones?: Action[];
    esperado: string;
  }> = [
    {
      nombre: "one confirmed critical signal beats six noise signals",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-critica", severity: "critical", confidence: "high", confirmed: true }),
        ...Array.from({ length: 6 }, (_, index) =>
          senal({
            id: `evt-ruido-${index}`,
            zoneId: "zone-b",
            category: `ruido-${index}`,
            severity: "low",
            confidence: "low",
            confirmed: null,
          }),
        ),
      ],
      esperado: "zone-a",
    },
    {
      nombre: "with identical signals exposed population dictates priority",
      zonas: [zona({ populationAtRisk: 600 }), zonaB({ populationAtRisk: 3000 })],
      eventos: [
        senal({ id: "evt-a", severity: "high", confirmed: true }),
        senal({ id: "evt-b", zoneId: "zone-b", severity: "high", confirmed: true }),
      ],
      esperado: "zone-b",
    },
    {
      nombre: "a fresh signal beats the same signal from an hour ago",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-a", severity: "high", confirmed: true, createdAt: AHORA }),
        senal({
          id: "evt-b",
          zoneId: "zone-b",
          severity: "high",
          confirmed: true,
          createdAt: haceMinutos(60),
        }),
      ],
      esperado: "zone-a",
    },
    {
      nombre: "a confirmed signal beats the same unverified signal",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-a", severity: "high", confidence: "medium", confirmed: true }),
        senal({
          id: "evt-b",
          zoneId: "zone-b",
          severity: "high",
          confidence: "medium",
          confirmed: null,
        }),
      ],
      esperado: "zone-a",
    },
    {
      nombre: "a signal repeated five times beats the same single signal",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-a", occurrences: 5 }),
        senal({ id: "evt-b", zoneId: "zone-b", occurrences: 1 }),
      ],
      esperado: "zone-a",
    },
    {
      nombre: "discarded signals do not count",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-a", severity: "critical", confidence: "high", confirmed: false }),
        senal({
          id: "evt-b",
          zoneId: "zone-b",
          severity: "medium",
          confidence: "medium",
          confirmed: null,
        }),
      ],
      esperado: "zone-b",
    },
    {
      nombre: "a downed resource increases pressure on its zone",
      zonas: [zona(), zonaB()],
      recursos: [recurso({ id: "res-a", zoneId: "zone-a", status: "unavailable" })],
      esperado: "zone-a",
    },
    {
      nombre: "a successfully completed action lowers pressure on its zone",
      zonas: [zona(), zonaB()],
      acciones: [accion({ id: "act-a", zoneId: "zone-a", status: "succeeded" })],
      esperado: "zone-b",
    },
    {
      nombre: "a merely proposed action does not relieve anything yet",
      zonas: [zona({ riskScore: 21 }), zonaB({ riskScore: 20 })],
      acciones: [accion({ id: "act-a", zoneId: "zone-a", status: "pending", completedAt: null })],
      esperado: "zone-a",
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      const orden = ranking(
        caso.zonas,
        caso.eventos ?? [],
        caso.recursos ?? [],
        caso.acciones ?? [],
      );
      expect(orden[0].zoneId).toBe(caso.esperado);
    });
  }
});

// ---------------------------------------------------------------------------
// Noise resistance (acceptance criterion 1)
// ---------------------------------------------------------------------------

describe("noise resistance", () => {
  const categoriasRuido = [
    "rumor-vecinal",
    "foto-sin-contexto",
    "aviso-duplicado",
    "llamada-confusa",
    "mensaje-anonimo",
    "sensor-intermitente",
    "comentario-red-social",
    "aviso-sin-ubicacion",
  ];

  function inyectarRuido() {
    for (const categoria of categoriasRuido) {
      addEvent({
        source: "public",
        title: `Aviso sin contrastar: ${categoria}`,
        description: "Entrada de baja calidad, sin verificar.",
        zoneId: "zone-islands",
        category: categoria,
        severity: "low",
        confidence: "low",
      });
    }
  }

  it("eight unverified low signals leave the zone in the bottom half of ranking", () => {
    inyectarRuido();

    const priorities = getSituation().plan.priorities;
    const posicion = priorities.findIndex((priority) => priority.zoneId === "zone-islands");

    expect(posicion).toBeGreaterThanOrEqual(Math.floor(priorities.length / 2));
    expect(priorities[0].zoneId).not.toBe("zone-islands");
  });

  it("noise does not overtake a zone with a confirmed critical signal", () => {
    addEvent({
      source: "operator",
      title: "Frente activo confirmado",
      description: "Vigilancia confirma el frente sobre núcleos habitados.",
      zoneId: "zone-north",
      category: "evacuación",
      severity: "critical",
      confidence: "high",
      confirmed: true,
    });
    inyectarRuido();

    const priorities = getSituation().plan.priorities;
    const ruidosa = priorities.find((priority) => priority.zoneId === "zone-islands")!;
    const critica = priorities.find((priority) => priority.zoneId === "zone-north")!;

    expect(priorities[0].zoneId).toBe("zone-north");
    expect(ruidosa.score).toBeLessThan(critica.score / 2);
  });

  it("eight noise-generated needs do not inflate zone indefinitely", () => {
    inyectarRuido();

    const situacion = getSituation();
    const islas = situacion.zones.find((zone) => zone.id === "zone-islands")!;
    const prioridad = situacion.plan.priorities.find(
      (priority) => priority.zoneId === "zone-islands",
    )!;
    const necesidades = prioridad.factors.find(
      (factor) => factor.label === "Necesidades abiertas",
    )!;

    expect(islas.needs.length).toBeGreaterThanOrEqual(9);
    // Nine needs at 8 points each would be 72; cap prevents it.
    expect(necesidades.value).toBeLessThanOrEqual(28);
  });
});

// ---------------------------------------------------------------------------
// Adaptation: priority also decreases (acceptance criterion 2)
// ---------------------------------------------------------------------------

describe("adaptation: priority also decreases", () => {
  it("successfully completing an action lowers its zone score", async () => {
    const antes = getSituation();
    const zonaTop = antes.plan.priorities[0].zoneId;
    const puntuacionAntes = antes.plan.priorities[0].score;
    const accionDeLaZona = antes.actions.find((action) => action.zoneId === zonaTop)!;

    const ejecutada = await approveAction(accionDeLaZona.id);
    expect(ejecutada.status).toBe("succeeded");

    const despues = getSituation();
    const puntuacionDespues = despues.plan.priorities.find(
      (priority) => priority.zoneId === zonaTop,
    )!.score;

    expect(puntuacionDespues).toBeLessThan(puntuacionAntes);
  });

  it("relief appears as an explainable negative factor", () => {
    const zonaConAccion = zona({ riskScore: 40, needs: ["triaje"] });
    const conAlivio = explainZone(zonaConAccion, [], [], [accion({ status: "succeeded" })], {
      now: AHORA,
    });
    const sinAlivio = explainZone(zonaConAccion, [], [], [], { now: AHORA });

    const alivio = conAlivio.factors.find(
      (factor) => factor.label === "Alivio por acciones completadas",
    );
    expect(alivio).toBeDefined();
    expect(alivio!.value).toBeLessThan(0);
    expect(conAlivio.score).toBeLessThan(sinAlivio.score);
  });

  it("relief decays: an action resolved an hour ago calms less than a newly resolved one", () => {
    const zonaBase = zona({ riskScore: 40, needs: ["triaje"] });
    const reciente = scoreZone(zonaBase, [], [], [accion({ completedAt: AHORA })], { now: AHORA });
    const antigua = scoreZone(zonaBase, [], [], [accion({ completedAt: haceMinutos(60) })], {
      now: AHORA,
    });

    expect(antigua).toBeGreaterThan(reciente);
  });

  it("relief can never erase the entire zone score", () => {
    const acciones = Array.from({ length: 10 }, (_, index) =>
      accion({ id: `act-${index}`, status: "succeeded" }),
    );
    const puntuacion = scoreZone(zona({ riskScore: 30 }), [], [], acciones, { now: AHORA });

    expect(puntuacion).toBeGreaterThan(0);
  });

  it("a failed action provides no relief", () => {
    const zonaBase = zona({ riskScore: 40 });
    const conFallo = scoreZone(zonaBase, [], [], [accion({ status: "failed" })], { now: AHORA });
    const sinAcciones = scoreZone(zonaBase, [], [], [], { now: AHORA });

    expect(conFallo).toBe(sinAcciones);
  });
});

// ---------------------------------------------------------------------------
// Explainability (acceptance criterion 4)
// ---------------------------------------------------------------------------

describe("explainability", () => {
  it("factors sum exactly to the score in each zone of the plan", async () => {
    addEvent({
      zoneId: "zone-south",
      category: "refugio",
      severity: "critical",
      confidence: "high",
      confirmed: true,
    });
    injectDemo("resource-down");
    const accionAbierta = getSituation().actions.find((action) => action.status === "pending");
    if (accionAbierta) await approveAction(accionAbierta.id);

    const priorities = getSituation().plan.priorities;
    expect(priorities.length).toBeGreaterThan(0);

    for (const priority of priorities) {
      const suma = priority.factors.reduce((total, factor) => total + factor.value, 0);
      expect(suma).toBe(priority.score);
    }
  });

  it("breakdown names real factors and not fixed values", () => {
    const explicacion = explainZone(
      zona({ riskScore: 30, populationAtRisk: 2400, needs: ["triaje"] }),
      [senal({ severity: "high", confirmed: true })],
      [recurso({ status: "unavailable" })],
      [],
      { now: AHORA },
    );
    const etiquetas = explicacion.factors.map((factor) => factor.label);

    expect(etiquetas).toContain("Riesgo base");
    expect(etiquetas).toContain("Señales vivas");
    expect(etiquetas).toContain("Población en riesgo");
    expect(etiquetas).toContain("Necesidades abiertas");
    expect(etiquetas).toContain("Recursos caídos");
    expect(explicacion.factors.reduce((total, factor) => total + factor.value, 0)).toBe(
      explicacion.score,
    );
  });

  it("does not double-count effect that store already applied to zone risk", () => {
    // The store raises `riskScore` upon receiving the signal; priority engine discounts it
    // to recount with its own credibility and decay.
    const explicacion = explainZone(
      zona({ riskScore: 38 }),
      [senal({ appliedRiskDelta: 18, severity: "critical", confirmed: true })],
      [],
      [],
      { now: AHORA },
    );
    const riesgoBase = explicacion.factors.find((factor) => factor.label === "Riesgo base")!;

    expect(riesgoBase.value).toBe(20);
  });

  it("reason explains dominant signal and its age", () => {
    const explicacion = explainZone(
      zona(),
      [senal({ severity: "critical", confidence: "high", confirmed: true, occurrences: 3 })],
      [],
      [],
      { now: AHORA },
    );

    expect(explicacion.reason).toContain("gravedad crítica");
    expect(explicacion.reason).toContain("confirmada");
    expect(explicacion.reason).toContain("repetida 3 veces");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same inputs produce same ranking", () => {
    const zonas = [zona(), zona({ id: "zone-b", name: "Zona B", populationAtRisk: 1500 })];
    const eventos = [
      senal({ severity: "high", confirmed: true }),
      senal({ id: "evt-b", zoneId: "zone-b" }),
    ];

    const primero = buildPlan(3, zonas, eventos, [], [], [], { now: AHORA });
    const segundo = buildPlan(3, zonas, eventos, [], [], [], { now: AHORA });

    expect(JSON.stringify(segundo.priorities)).toBe(JSON.stringify(primero.priorities));
    expect(segundo.summary).toBe(primero.summary);
  });

  it("ties are resolved by identifier and not by arrival order", () => {
    const gemelaA = zona({ id: "zone-a" });
    const gemelaB = zona({ id: "zone-b" });

    expect(ranking([gemelaA, gemelaB])[0].zoneId).toBe("zone-a");
    expect(ranking([gemelaB, gemelaA])[0].zoneId).toBe("zone-a");
  });

  it("returns complete plan with previousVersion, changes, and trigger", () => {
    const plan = buildPlan(4, [zona()], [], [], [], ["act-invalidada"], { now: AHORA });

    expect(plan.version).toBe(4);
    expect(plan.previousVersion).toBe(3);
    expect(plan.changes).toEqual([]);
    expect(plan.trigger).toBe("replanificación");
    expect(plan.invalidatedActionIds).toEqual(["act-invalidada"]);
    expect(buildPlan(1, [zona()], [], [], [], [], { now: AHORA }).previousVersion).toBeNull();
  });
});
