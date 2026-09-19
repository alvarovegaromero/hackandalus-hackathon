import { describe, expect, it } from "vitest";
import {
  MAX_SUPUESTOS,
  applyEventToWorld,
  checkAssumptions,
  consequencesOfBreak,
  deriveAssumptions,
  evaluatePlanAgainstWorld,
  explainInvalidation,
} from "@/lib/assumptions";
import { seedResources, seedWorld, seedZones } from "@/lib/seed";
import type { Action, ActionChannel, Assumption, CrisisEvent, Plan } from "@/lib/types";

const AHORA = "2026-02-14T10:00:00.000Z";
const zonas = structuredClone(seedZones);
const recursos = structuredClone(seedResources);

/** Copia limpia del mundo semilla: viento del NE, todo abierto y operativo. */
function mundo(overrides: Partial<ReturnType<typeof clonarMundo>> = {}) {
  return { ...clonarMundo(), ...overrides };
}

function clonarMundo() {
  return { ...structuredClone(seedWorld), updatedAt: AHORA };
}

/** Accion minima: solo se rellena lo que miran los supuestos. */
function accion(overrides: Partial<Action> & Pick<Action, "id" | "zoneId" | "objective">): Action {
  const channel: ActionChannel = overrides.channel ?? "call";
  return {
    channel,
    target: "Destinatario de prueba",
    status: "pending",
    reason: "Prueba.",
    executionMode: "mock",
    attempt: 1,
    idempotencyKey: `${overrides.id}:1`,
    stalledAfter: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

/**
 * Situacion de referencia: el frente aprieta en Sierra Morena, un transporte
 * sube desde la costa, una ambulancia de Sevilla baja a la Costa del Sol y el
 * aviso a los nucleos sale por SMS.
 */
function acciones(): Action[] {
  return [
    accion({
      id: "act-evac-norte",
      zoneId: "zone-north",
      resourceId: "res-transport-1",
      channel: "sms",
      objective: "Coordinar evacuación de los núcleos de Sierra Morena hacia los refugios.",
    }),
    accion({
      id: "act-aviso-sevilla",
      zoneId: "zone-central",
      resourceId: "res-comms-1",
      channel: "call",
      objective: "Avisar a la jefatura sanitaria de Sevilla Hub.",
    }),
    accion({
      id: "act-triaje-costa",
      zoneId: "zone-south",
      resourceId: "res-med-1",
      channel: "call",
      objective: "Triaje sanitario y traslado de heridos en Costa del Sol.",
    }),
  ];
}

function plan(): Plan {
  return {
    id: "plan-3",
    version: 3,
    previousVersion: 2,
    generatedAt: AHORA,
    summary: "Sierra Morena es la prioridad actual.",
    priorities: [
      { zoneId: "zone-north", score: 92, reason: "Frente activo.", factors: [] },
      { zoneId: "zone-south", score: 61, reason: "Refugios al límite.", factors: [] },
      { zoneId: "zone-central", score: 44, reason: "Demanda sanitaria.", factors: [] },
      { zoneId: "zone-east", score: 20, reason: "Sin novedad.", factors: [] },
      { zoneId: "zone-islands", score: 12, reason: "Sin novedad.", factors: [] },
    ],
    proposedActionIds: ["act-evac-norte", "act-aviso-sevilla", "act-triaje-costa"],
    invalidatedActionIds: [],
    changes: [],
    trigger: "nueva señal",
  };
}

function senal(
  overrides: Partial<CrisisEvent> & Pick<CrisisEvent, "id" | "zoneId" | "category">,
): CrisisEvent {
  return {
    source: "scenario",
    title: "Señal de prueba",
    description: "",
    severity: "high",
    confidence: "high",
    createdAt: "2026-02-14T10:12:00.000Z",
    confirmed: true,
    dedupeKey: `${overrides.zoneId}:${overrides.category}`,
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
    ...overrides,
  };
}

function supuestos(world = mundo()) {
  return deriveAssumptions(plan(), zonas, recursos, world, acciones());
}

function variables(lista: Assumption[]) {
  return lista.map((assumption) => assumption.variable);
}

// ---------------------------------------------------------------------------
// Derivacion
// ---------------------------------------------------------------------------

describe("derivación de supuestos", () => {
  it("declara de qué depende el plan a partir de sus propias decisiones", () => {
    const lista = supuestos();

    // Viento (sostiene el orden), las dos rutas que cruzan medios, el hospital
    // de destino de la evacuación sanitaria y los dos canales en uso.
    expect(variables(lista)).toEqual([
      "wind.direction",
      "road.A-397",
      "road.A-375",
      "hospital.beds.hospital-costa-del-sol",
      "comms.sms",
      "comms.voice",
    ]);
    expect(lista.length).toBeLessThanOrEqual(MAX_SUPUESTOS);
    expect(lista.every((assumption) => assumption.status === "ok")).toBe(true);
    expect(lista.every((assumption) => assumption.planVersion === 3)).toBe(true);
  });

  it("nombra la decisión concreta que sostiene cada supuesto", () => {
    const lista = supuestos();
    const carretera = lista.find((assumption) => assumption.variable === "road.A-397");

    expect(carretera?.text).toBe(
      "La A-397 sigue abierta para llevar Transporte Costa Uno a Sierra Morena.",
    );
    expect(carretera?.condition).toContain("destino: Sierra Morena (zone-north)");
    expect(carretera?.condition).toContain("origen: Costa del Sol (zone-south)");
    expect(carretera?.id).toBe("sup-v3-road-a-397");

    const viento = lista.find((assumption) => assumption.variable === "wind.direction");
    expect(viento?.text).toContain("del nordeste");
    expect(viento?.text).toContain("Sierra Morena");
  });

  it("no declara un supuesto que ya es falso cuando se genera el plan", () => {
    // La A-397 ya está cortada: el plan nuevo no puede apoyarse en ella. Y el
    // Hospital de la Serranía tiene 8 camas, por debajo del umbral, así que
    // tampoco se declara: se elige el hospital que sí sostiene la decisión.
    const lista = supuestos(mundo({ blockedRoads: ["A-397"] }));

    expect(variables(lista)).not.toContain("road.A-397");
    expect(variables(lista)).toContain("road.A-375");
    expect(variables(lista)).not.toContain("hospital.beds.hospital-serrania");
  });

  it("no declara canales que el plan no usa", () => {
    const soloVoz = acciones().filter((action) => action.channel === "call");
    const lista = deriveAssumptions(plan(), zonas, recursos, mundo(), soloVoz);

    expect(variables(lista)).toContain("comms.voice");
    expect(variables(lista)).not.toContain("comms.sms");
  });
});

// ---------------------------------------------------------------------------
// Rotura por cambio del mundo
// ---------------------------------------------------------------------------

describe("roturas de supuestos", () => {
  it("un giro de viento rompe el supuesto del viento y sólo ése", () => {
    const evento = senal({
      id: "evt-viento",
      zoneId: "zone-north",
      category: "wind-shift",
      title: "Cambio de viento hacia núcleos habitados",
      description: "El frente gira al suroeste con rachas de 48 km/h.",
    });

    const antes = mundo();
    const despues = applyEventToWorld(antes, evento);
    expect(despues.windDirection).toBe("SO");
    expect(despues.windSpeedKmh).toBe(48);
    expect(antes.windDirection).toBe("NE"); // no se muta el mundo recibido

    const check = checkAssumptions(supuestos(antes), despues, evento);

    expect(variables(check.broken)).toEqual(["wind.direction"]);
    expect(check.broken[0].brokenByEventId).toBe("evt-viento");
    expect(check.broken[0].brokenAt).toBe(evento.createdAt);
    expect(check.assumptions.filter((a) => a.status === "ok")).toHaveLength(5);
  });

  it("un corte de carretera invalida la acción que dependía de ella y no las demás", () => {
    const evento = senal({
      id: "evt-corte",
      zoneId: "zone-north",
      category: "route-blocked",
      title: "Ruta de acceso bloqueada",
      description: "La A-397 queda cortada por el frente y no hay paso hacia los núcleos.",
    });

    const despues = applyEventToWorld(mundo(), evento);
    expect(despues.blockedRoads).toEqual(["A-397"]);

    const check = checkAssumptions(supuestos(), despues, evento);
    expect(variables(check.broken)).toEqual(["road.A-397"]);

    const consecuencias = consequencesOfBreak(check.broken[0], plan(), acciones());
    expect(consecuencias.map((c) => c.actionId)).toEqual(["act-evac-norte"]);
    expect(consecuencias[0].effect).toBe("invalidada");
    expect(consecuencias[0].reason).toContain("A-397");
    expect(consecuencias[0].reason).toContain("Sierra Morena");
  });

  it("una señal de corte que no cita carretera usa la vía principal de la zona", () => {
    const evento = senal({
      id: "evt-corte-este",
      zoneId: "zone-east",
      category: "route-blocked",
      title: "Ruta de acceso bloqueada",
      description: "La ruta principal entre Granada y Almería queda bloqueada.",
    });

    expect(applyEventToWorld(mundo(), evento).blockedRoads).toEqual(["A-92"]);
  });

  it("la caída de la mensajería rompe el supuesto del SMS y tumba el aviso que salía por ahí", () => {
    const evento = senal({
      id: "evt-sms",
      zoneId: "zone-north",
      category: "integration-failure",
      title: "Caída de la integración de mensajería",
      description: "El envío de SMS queda fuera de servicio.",
    });

    const despues = applyEventToWorld(mundo(), evento);
    expect(despues.smsOperational).toBe(false);
    expect(despues.voiceOperational).toBe(true);

    const check = checkAssumptions(supuestos(), despues, evento);
    expect(variables(check.broken)).toEqual(["comms.sms"]);

    const consecuencias = consequencesOfBreak(check.broken[0], plan(), acciones());
    expect(consecuencias.map((c) => c.actionId)).toEqual(["act-evac-norte"]);
    expect(consecuencias[0].reason).toContain("mensajería");
  });

  it("las camas por debajo del umbral rompen el supuesto del hospital", () => {
    const evento = senal({
      id: "evt-camas",
      zoneId: "zone-south",
      category: "hospital-beds",
      title: "Saturación hospitalaria en la costa",
      description: "El Hospital Costa del Sol se queda con 4 camas libres.",
    });

    const despues = applyEventToWorld(mundo(), evento);
    expect(despues.hospitalBeds["hospital-costa-del-sol"]).toBe(4);

    const check = checkAssumptions(supuestos(), despues, evento);
    expect(variables(check.broken)).toEqual(["hospital.beds.hospital-costa-del-sol"]);

    const consecuencias = consequencesOfBreak(check.broken[0], plan(), acciones());
    expect(consecuencias.map((c) => c.actionId)).toEqual(["act-triaje-costa"]);
    expect(consecuencias[0].reason).toContain("Hospital Costa del Sol");
  });

  it("si desaparece el dato de camas el supuesto queda en desconocido, no en roto", () => {
    const evento = senal({
      id: "evt-sin-datos",
      zoneId: "zone-south",
      category: "hospital-beds",
      title: "Sin contacto con el hospital",
      description: "El Hospital Costa del Sol queda incomunicado: no hay datos de camas.",
    });

    const despues = applyEventToWorld(mundo(), evento);
    expect(despues.hospitalBeds["hospital-costa-del-sol"]).toBeUndefined();

    const check = checkAssumptions(supuestos(), despues, evento);
    expect(check.broken).toHaveLength(0);
    expect(variables(check.unknown)).toEqual(["hospital.beds.hospital-costa-del-sol"]);
    expect(check.unknown[0].brokenByEventId).toBeNull();
  });

  it("una señal irrelevante deja el mundo igual y no rompe nada", () => {
    const evento = senal({
      id: "evt-refugios",
      zoneId: "zone-south",
      category: "refugio",
      title: "Refugios de la Costa del Sol al límite",
      description: "Llegan más desplazados de los previstos y la capacidad de refugio se agota.",
    });

    const antes = mundo();
    const despues = applyEventToWorld(antes, evento);
    expect(despues).toBe(antes);

    const check = checkAssumptions(supuestos(), despues, evento);
    expect(check.broken).toHaveLength(0);
    expect(check.changed).toBe(false);
    expect(check.assumptions.every((assumption) => assumption.status === "ok")).toBe(true);
  });

  it("un supuesto ya roto no se vuelve a romper ni resucita solo", () => {
    const giro = senal({
      id: "evt-giro",
      zoneId: "zone-north",
      category: "wind-shift",
      title: "El viento gira",
      description: "El frente pasa a soplar del suroeste.",
    });

    const roto = checkAssumptions(supuestos(), applyEventToWorld(mundo(), giro), giro);
    expect(variables(roto.broken)).toEqual(["wind.direction"]);

    // Segunda comprobación con el viento de vuelta al NE y otra señal: el
    // supuesto sigue roto, conserva quién lo rompió y no se vuelve a anunciar.
    const otra = senal({ id: "evt-posterior", zoneId: "zone-north", category: "incendio" });
    const segunda = checkAssumptions(roto.assumptions, mundo(), otra);

    expect(segunda.broken).toHaveLength(0);
    expect(variables(segunda.alreadyBroken)).toEqual(["wind.direction"]);
    const viento = segunda.assumptions.find(
      (assumption) => assumption.variable === "wind.direction",
    );
    expect(viento?.status).toBe("broken");
    expect(viento?.brokenByEventId).toBe("evt-giro");
  });
});

// ---------------------------------------------------------------------------
// Explicacion
// ---------------------------------------------------------------------------

describe("explicación de la invalidación", () => {
  it("nombra el supuesto caído y la consecuencia, no el identificador", () => {
    const carretera = supuestos().find((assumption) => assumption.variable === "road.A-397")!;
    const texto = explainInvalidation([{ ...carretera, status: "broken" }], plan());

    expect(texto).toBe(
      "El plan v3 ya no vale: contaba con que la A-397 siguiera abierta para llevar medios a Sierra Morena, y acaba de cortarse. Los equipos que iban hacia Sierra Morena se quedan sin ruta, así que hay que rehacer el plan.",
    );
    expect(texto).not.toContain("road.");
    expect(texto).not.toContain("zone-north");
  });

  it("explica también el giro de viento y las camas en lenguaje de sala", () => {
    const lista = supuestos();
    const viento = lista.find((assumption) => assumption.variable === "wind.direction")!;
    const camas = lista.find((assumption) => assumption.variable.startsWith("hospital.beds."))!;

    const textoViento = explainInvalidation([{ ...viento, status: "broken" }], plan());
    expect(textoViento).toContain(
      "daba por hecho que el viento seguiría del nordeste sobre Sierra Morena",
    );
    // La frase abre oración, así que llega en mayúscula: se compara sin distinguirla.
    expect(textoViento.toLowerCase()).toContain("el orden de prioridades ya no se sostiene");

    const textoCamas = explainInvalidation([{ ...camas, status: "broken" }], plan());
    expect(textoCamas).toContain("contaba con al menos 10 camas libres en Hospital Costa del Sol");
    expect(textoCamas).toContain("deja de caber");
  });

  it("menciona los supuestos secundarios sin repetir la consecuencia principal", () => {
    const lista = supuestos().map((assumption) => ({ ...assumption, status: "broken" as const }));
    const texto = explainInvalidation([lista[1], lista[4]], plan());

    expect(texto).toContain("El plan v3 ya no vale: contaba con que la A-397");
    expect(texto).toContain("También ha caído: la mensajería seguía operativa");
  });

  it("dice que el plan sigue en pie cuando no hay nada roto", () => {
    expect(explainInvalidation([], plan())).toBe(
      "El plan v3 sigue en pie: ninguno de sus supuestos se ha roto.",
    );
  });
});

// ---------------------------------------------------------------------------
// Orquestacion para el store
// ---------------------------------------------------------------------------

describe("evaluación del plan contra el mundo", () => {
  it("marca el plan como inválido, explica por qué y lista lo que se cae", () => {
    const evento = senal({
      id: "evt-corte-2",
      zoneId: "zone-north",
      category: "route-blocked",
      title: "Ruta cortada",
      description: "La A-397 queda cortada.",
    });

    const conSupuestos = {
      ...plan(),
      assumptions: supuestos(),
      valid: true,
      invalidatedReason: null,
    };
    const despues = applyEventToWorld(mundo(), evento);
    const resultado = evaluatePlanAgainstWorld(conSupuestos, despues, acciones(), evento);

    expect(resultado.invalidated).toBe(true);
    expect(resultado.plan.valid).toBe(false);
    expect(resultado.plan.invalidatedReason).toContain("A-397");
    expect(resultado.consequences.map((c) => c.actionId)).toEqual(["act-evac-norte"]);
    // El plan de entrada no se toca: la función es pura.
    expect(conSupuestos.valid).toBe(true);
  });

  it("deja el plan válido mientras se sostengan todos los supuestos", () => {
    const conSupuestos = { ...plan(), assumptions: supuestos() };
    const resultado = evaluatePlanAgainstWorld(conSupuestos, mundo(), acciones());

    expect(resultado.invalidated).toBe(false);
    expect(resultado.plan.valid).toBe(true);
    expect(resultado.plan.invalidatedReason).toBeNull();
    expect(resultado.consequences).toHaveLength(0);
  });
});
