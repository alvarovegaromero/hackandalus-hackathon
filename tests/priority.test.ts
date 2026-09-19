// PROPIETARIO: agente del motor de prioridad.
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
// Utilidades de prueba
// ---------------------------------------------------------------------------

/** Instante fijo de referencia: el decaimiento es determinista en los tests. */
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
    coordinates: { x: 0, y: 0 },
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
// Comportamiento de extremo a extremo (pruebas originales del módulo)
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
// Tabla 1: cuánto pesa cada señal
// ---------------------------------------------------------------------------

describe("tabla de pesos de señal", () => {
  const casos: Array<{ nombre: string; evento: CrisisEvent; esperado: number }> = [
    {
      nombre: "crítica confirmada con confianza alta: pesa entera",
      evento: senal({ severity: "critical", confidence: "high", confirmed: true }),
      esperado: 160,
    },
    {
      nombre: "crítica sin verificar con confianza alta: castigo leve",
      evento: senal({ severity: "critical", confidence: "high", confirmed: null }),
      esperado: 160 * 0.85,
    },
    {
      nombre: "alta confirmada con confianza alta",
      evento: senal({ severity: "high", confidence: "high", confirmed: true }),
      esperado: 70,
    },
    {
      nombre: "alta sin verificar con confianza media: castigo doble",
      evento: senal({ severity: "high", confidence: "medium", confirmed: null }),
      esperado: 70 * 0.75 * 0.6,
    },
    {
      nombre: "media confirmada con confianza media",
      evento: senal({ severity: "medium", confidence: "medium", confirmed: true }),
      esperado: 28 * 0.75,
    },
    {
      nombre: "baja sin verificar con confianza baja: ruido, pesa casi nada",
      evento: senal({ severity: "low", confidence: "low", confirmed: null }),
      esperado: 8 * 0.4 * 0.3,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(signalWeight(caso.evento, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("una señal sin verificar siempre pesa menos que la misma confirmada", () => {
    const sinVerificar = senal({ severity: "high", confidence: "low", confirmed: null });
    const confirmada = senal({ severity: "high", confidence: "low", confirmed: true });

    expect(signalWeight(sinVerificar, { now: AHORA })).toBeLessThan(
      signalWeight(confirmada, { now: AHORA }),
    );
  });

  it("una señal crítica sin verificar sigue pesando más que una baja confirmada", () => {
    // Sin datos completos hay que decidir igual: una crítica creíble manda.
    const critica = senal({ severity: "critical", confidence: "high", confirmed: null });
    const baja = senal({ severity: "low", confidence: "high", confirmed: true });

    expect(signalWeight(critica, { now: AHORA })).toBeGreaterThan(
      signalWeight(baja, { now: AHORA }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tabla 2: decaimiento temporal
// ---------------------------------------------------------------------------

describe("tabla de decaimiento temporal", () => {
  const casos: Array<{ nombre: string; evento: CrisisEvent; esperado: number }> = [
    {
      nombre: "recién llegada: pesa entera",
      evento: senal({ severity: "high", confirmed: true, createdAt: AHORA }),
      esperado: 1,
    },
    {
      nombre: "alta confirmada a su vida media (25 min): la mitad",
      evento: senal({ severity: "high", confirmed: true, createdAt: haceMinutos(25) }),
      esperado: 0.5,
    },
    {
      nombre: "crítica confirmada a los 45 min: la mitad",
      evento: senal({ severity: "critical", confirmed: true, createdAt: haceMinutos(45) }),
      esperado: 0.5,
    },
    {
      nombre: "baja sin verificar a los 12 min: ya casi no cuenta",
      evento: senal({ severity: "low", confirmed: null, createdAt: haceMinutos(12) }),
      esperado: 0.25,
    },
    {
      nombre: "confirmada muy antigua: nunca se olvida del todo (suelo 0,3)",
      evento: senal({ severity: "critical", confirmed: true, createdAt: haceMinutos(600) }),
      esperado: 0.3,
    },
    {
      nombre: "sin verificar muy antigua: cae al suelo 0,05",
      evento: senal({ severity: "low", confirmed: null, createdAt: haceMinutos(600) }),
      esperado: 0.05,
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(decayFactor(caso.evento, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("lo que se sabía a las 12:00 pesa menos a las 12:20", () => {
    const doce = senal({ severity: "high", confirmed: true, createdAt: AHORA });
    const doceVeinte = signalWeight(doce, { now: haceMinutos(-20) });

    expect(doceVeinte).toBeLessThan(signalWeight(doce, { now: AHORA }));
  });
});

// ---------------------------------------------------------------------------
// Tabla 3: repeticiones con rendimientos decrecientes
// ---------------------------------------------------------------------------

describe("tabla de repeticiones", () => {
  const casos: Array<{ nombre: string; occurrences: number; esperado: number }> = [
    { nombre: "una sola vez: sin refuerzo", occurrences: 1, esperado: 1 },
    { nombre: "dos veces", occurrences: 2, esperado: 1 + Math.log(2) * 0.4 },
    { nombre: "cinco veces", occurrences: 5, esperado: 1 + Math.log(5) * 0.4 },
    { nombre: "veinte veces: tope 1,8, no crece sin freno", occurrences: 20, esperado: 1.8 },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(occurrenceFactor(caso.occurrences, { now: AHORA })).toBeCloseTo(caso.esperado, 5);
    });
  }

  it("repetir cinco veces refuerza, pero muy lejos de multiplicar por cinco", () => {
    const unaVez = signalWeight(senal({ occurrences: 1 }), { now: AHORA });
    const cincoVeces = signalWeight(senal({ occurrences: 5 }), { now: AHORA });

    expect(cincoVeces).toBeGreaterThan(unaVez);
    expect(cincoVeces).toBeLessThan(unaVez * 2);
  });
});

// ---------------------------------------------------------------------------
// Tabla 4: decisiones con información incompleta
// ---------------------------------------------------------------------------

describe("tabla de decisiones de prioridad", () => {
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
      nombre: "una crítica confirmada gana a seis señales de ruido",
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
      nombre: "con la misma señal manda la población expuesta",
      zonas: [zona({ populationAtRisk: 600 }), zonaB({ populationAtRisk: 3000 })],
      eventos: [
        senal({ id: "evt-a", severity: "high", confirmed: true }),
        senal({ id: "evt-b", zoneId: "zone-b", severity: "high", confirmed: true }),
      ],
      esperado: "zone-b",
    },
    {
      nombre: "una señal fresca gana a la misma señal de hace una hora",
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
      nombre: "una señal confirmada gana a la misma sin verificar",
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
      nombre: "una señal repetida cinco veces gana a la misma señal suelta",
      zonas: [zona(), zonaB()],
      eventos: [
        senal({ id: "evt-a", occurrences: 5 }),
        senal({ id: "evt-b", zoneId: "zone-b", occurrences: 1 }),
      ],
      esperado: "zone-a",
    },
    {
      nombre: "las señales descartadas no cuentan",
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
      nombre: "un recurso caído sube la presión de su zona",
      zonas: [zona(), zonaB()],
      recursos: [recurso({ id: "res-a", zoneId: "zone-a", status: "unavailable" })],
      esperado: "zone-a",
    },
    {
      nombre: "una acción completada con éxito baja la presión de su zona",
      zonas: [zona(), zonaB()],
      acciones: [accion({ id: "act-a", zoneId: "zone-a", status: "succeeded" })],
      esperado: "zone-b",
    },
    {
      nombre: "una acción solo propuesta todavía no alivia nada",
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
// El ruido no puede ganar a la señal (criterio de aceptación 1)
// ---------------------------------------------------------------------------

describe("resistencia al ruido", () => {
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

  it("ocho señales bajas sin verificar dejan a la zona en la mitad baja del ranking", () => {
    inyectarRuido();

    const priorities = getSituation().plan.priorities;
    const posicion = priorities.findIndex((priority) => priority.zoneId === "zone-islands");

    expect(posicion).toBeGreaterThanOrEqual(Math.floor(priorities.length / 2));
    expect(priorities[0].zoneId).not.toBe("zone-islands");
  });

  it("el ruido no adelanta a una zona con una señal crítica confirmada", () => {
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

  it("ocho necesidades nacidas del ruido no inflan la zona a perpetuidad", () => {
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
    // Nueve necesidades a 8 puntos cada una serían 72; el techo lo impide.
    expect(necesidades.value).toBeLessThanOrEqual(28);
  });
});

// ---------------------------------------------------------------------------
// Resolver algo baja la prioridad (criterio de aceptación 2)
// ---------------------------------------------------------------------------

describe("adaptación: la prioridad también baja", () => {
  it("completar con éxito una acción baja la puntuación de su zona", async () => {
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

  it("el alivio aparece como factor negativo explicable", () => {
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

  it("el alivio caduca: una acción resuelta hace una hora calma menos que una recién resuelta", () => {
    const zonaBase = zona({ riskScore: 40, needs: ["triaje"] });
    const reciente = scoreZone(zonaBase, [], [], [accion({ completedAt: AHORA })], { now: AHORA });
    const antigua = scoreZone(zonaBase, [], [], [accion({ completedAt: haceMinutos(60) })], {
      now: AHORA,
    });

    expect(antigua).toBeGreaterThan(reciente);
  });

  it("el alivio nunca puede borrar la zona entera", () => {
    const acciones = Array.from({ length: 10 }, (_, index) =>
      accion({ id: `act-${index}`, status: "succeeded" }),
    );
    const puntuacion = scoreZone(zona({ riskScore: 30 }), [], [], acciones, { now: AHORA });

    expect(puntuacion).toBeGreaterThan(0);
  });

  it("una acción fallida no alivia nada", () => {
    const zonaBase = zona({ riskScore: 40 });
    const conFallo = scoreZone(zonaBase, [], [], [accion({ status: "failed" })], { now: AHORA });
    const sinAcciones = scoreZone(zonaBase, [], [], [], { now: AHORA });

    expect(conFallo).toBe(sinAcciones);
  });
});

// ---------------------------------------------------------------------------
// La explicación tiene que cuadrar (criterio de aceptación 4)
// ---------------------------------------------------------------------------

describe("explicabilidad", () => {
  it("los factores suman exactamente la puntuación en cada zona del plan", async () => {
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

  it("el desglose nombra los factores reales y no valores fijos", () => {
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

  it("no cuenta dos veces el efecto que el store ya aplicó sobre el riesgo de la zona", () => {
    // El store sube `riskScore` al recibir la señal; el motor lo descuenta para
    // recontarlo con credibilidad y decaimiento propios.
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

  it("la razón explica la señal dominante y su antigüedad", () => {
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
// Determinismo
// ---------------------------------------------------------------------------

describe("determinismo", () => {
  it("las mismas entradas producen el mismo ranking", () => {
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

  it("los empates se resuelven por identificador y no por orden de llegada", () => {
    const gemelaA = zona({ id: "zone-a" });
    const gemelaB = zona({ id: "zone-b" });

    expect(ranking([gemelaA, gemelaB])[0].zoneId).toBe("zone-a");
    expect(ranking([gemelaB, gemelaA])[0].zoneId).toBe("zone-a");
  });

  it("devuelve un plan completo con previousVersion, changes y trigger", () => {
    const plan = buildPlan(4, [zona()], [], [], [], ["act-invalidada"], { now: AHORA });

    expect(plan.version).toBe(4);
    expect(plan.previousVersion).toBe(3);
    expect(plan.changes).toEqual([]);
    expect(plan.trigger).toBe("replanificación");
    expect(plan.invalidatedActionIds).toEqual(["act-invalidada"]);
    expect(buildPlan(1, [zona()], [], [], [], [], { now: AHORA }).previousVersion).toBeNull();
  });
});
