import { describe, expect, it } from "vitest";
import {
  autonomyDecisionFor,
  buildWaitingList,
  canAutoDispatch,
  categoriaDeAccion,
  classifyAction,
  decideAutonomy,
  describeAutonomy
} from "@/lib/autonomy";
import { seedAutonomyRules, seedResources, seedZones } from "@/lib/seed";
import type { Action, ActionChannel, Resource } from "@/lib/types";

const zones = structuredClone(seedZones);
const reglas = structuredClone(seedAutonomyRules);

let contador = 0;

/** Acción mínima de prueba; solo se rellena lo que mira el motor de autonomía. */
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
    ...overrides
  };
}

function recursos(): Resource[] {
  return structuredClone(seedResources);
}

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

describe("clasificación del tipo de acción", () => {
  it("saca la categoría del objetivo que redacta el store", () => {
    // store.ts escribe siempre "Coordinar respuesta de <categoría> en <zona>",
    // así que la palabra "coordinar" no distingue nada: la señal es la categoría.
    const objetivo = "Coordinar respuesta de incendio en Sierra Morena.";
    expect(categoriaDeAccion({ objective: objetivo })).toBe("incendio");
    expect(classifyAction({ objective: objetivo, channel: "call", target: "Coordinación INFOCA" })).toBe(
      "asignar-recurso"
    );
  });

  it("no clasifica como aviso cualquier objetivo por empezar con Coordinar", () => {
    const evacuacion = "Coordinar respuesta de evacuacion en Granada y Almería.";
    expect(classifyAction({ objective: evacuacion, channel: "call" })).toBe("evacuar");
  });

  it("clasifica igual con acentos y sin ellos", () => {
    expect(
      classifyAction({ objective: "Coordinar respuesta de evacuación en Almería.", channel: "call" })
    ).toBe("evacuar");
    expect(
      classifyAction({ objective: "Coordinar respuesta de inundación en Almería.", channel: "call" })
    ).toBe("asignar-recurso");
  });

  it("una acción de verificación abierta sobre una señal se clasifica como verificar", () => {
    expect(
      classifyAction({
        objective: "Coordinar respuesta de coordinacion en Sevilla Hub.",
        channel: "call",
        verifiesEventId: "evt-1"
      })
    ).toBe("verificar");
  });

  it("un mensaje de difusión a un colectivo es aviso masivo aunque no lo diga", () => {
    expect(
      classifyAction({
        objective: "Instrucciones de autoprotección",
        channel: "sms",
        target: "Población de Costa del Sol"
      })
    ).toBe("aviso-masivo");
  });

  it("devuelve null cuando no hay señal suficiente", () => {
    expect(
      classifyAction({ objective: "Gestionar el asunto de siempre.", channel: "ticket", target: "Equipo" })
    ).toBeNull();
    expect(classifyAction({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Nivel de autonomía por tipo de acción
// ---------------------------------------------------------------------------

describe("nivel de autonomía por tipo de acción", () => {
  const casos = [
    {
      nombre: "verificar un dato: lo hace sola, es reversible",
      objetivo: "Verificar con el vigilante la columna de humo antes de movilizar.",
      canal: "call" as ActionChannel,
      tipo: "verificar" as const,
      nivel: "auto" as const
    },
    {
      nombre: "avisar a un responsable: lo hace sola y avisa",
      objetivo: "Coordinar respuesta de coordinacion en Sevilla Hub.",
      canal: "call" as ActionChannel,
      tipo: "avisar" as const,
      nivel: "auto-notify" as const
    },
    {
      nombre: "mover un recurso: lo hace sola y se puede deshacer",
      objetivo: "Coordinar respuesta de incendio en Sierra Morena.",
      canal: "call" as ActionChannel,
      tipo: "asignar-recurso" as const,
      nivel: "auto-notify" as const
    },
    {
      nombre: "aviso masivo sin confianza conocida: lo aprueba una persona",
      objetivo: "Aviso masivo a la población de Costa del Sol.",
      canal: "sms" as ActionChannel,
      tipo: "aviso-masivo" as const,
      nivel: "approval" as const
    },
    {
      nombre: "ordenar una evacuación: siempre lo aprueba una persona",
      objetivo: "Coordinar respuesta de evacuacion en Granada y Almería.",
      canal: "call" as ActionChannel,
      tipo: "evacuar" as const,
      nivel: "approval" as const
    },
    {
      nombre: "pedir refuerzos externos: siempre lo aprueba una persona",
      objetivo: "Coordinar respuesta de resource-shortage en Sevilla Hub.",
      canal: "ticket" as ActionChannel,
      tipo: "escalar" as const,
      nivel: "approval" as const
    }
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      const decision = decideAutonomy({ objective: caso.objetivo, channel: caso.canal }, reglas);
      expect(decision.actionKind).toBe(caso.tipo);
      expect(decision.level).toBe(caso.nivel);
      expect(decision.reason.length).toBeGreaterThan(20);
    });
  }

  it("el motivo se puede enseñar a un jurado", () => {
    const decision = decideAutonomy(
      { objective: "Coordinar respuesta de coordinacion en Sevilla Hub.", channel: "call" },
      reglas
    );
    expect(decision.reason).toContain("Se ejecuta sola");
    expect(decision.reason).toContain("reversible");
  });
});

// ---------------------------------------------------------------------------
// Umbral de confianza
// ---------------------------------------------------------------------------

describe("aviso masivo y umbral de confianza", () => {
  const avisoMasivo = {
    objective: "Aviso masivo a la población de Costa del Sol.",
    channel: "sms" as ActionChannel
  };

  it("por debajo del umbral espera aprobación humana", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, { confidence: 0.75 });
    expect(decision.actionKind).toBe("aviso-masivo");
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("75 %");
    expect(decision.reason).toContain("90 %");
  });

  it("por encima del umbral se ejecuta sola y avisa", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, { confidence: 0.95 });
    expect(decision.level).toBe("auto-notify");
    expect(decision.reason).toContain("supera");
  });

  it("justo en el umbral se automatiza; un pelo por debajo, no", () => {
    expect(decideAutonomy(avisoMasivo, reglas, { confidence: 0.9 }).level).toBe("auto-notify");
    expect(decideAutonomy(avisoMasivo, reglas, { confidence: 0.899 }).level).toBe("approval");
  });

  it("sin confianza conocida se elige el nivel más conservador", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {});
    expect(decision.confidence).toBeNull();
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("no se conoce la confianza");
  });

  it("una señal confirmada de confianza alta supera el umbral sin triaje calibrado", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {
      event: { category: "alerta publica", confidence: "high", confirmed: true }
    });
    expect(decision.confidence).toBe(0.95);
    expect(decision.level).toBe("auto-notify");
  });

  it("la misma señal sin verificar se queda esperando aprobación", () => {
    const decision = decideAutonomy(avisoMasivo, reglas, {
      event: { category: "alerta publica", confidence: "high", confirmed: null }
    });
    expect(decision.level).toBe("approval");
  });
});

// ---------------------------------------------------------------------------
// Barandillas
// ---------------------------------------------------------------------------

describe("barandillas de la autonomía", () => {
  it("una acción sin clasificar cae en aprobación humana", () => {
    const decision = decideAutonomy(
      { objective: "Gestionar el asunto de siempre.", channel: "ticket", target: "Equipo" },
      reglas
    );
    expect(decision.actionKind).toBeNull();
    expect(decision.level).toBe("approval");
    expect(decision.reason).toContain("no se ha podido clasificar");
  });

  it("sin reglas cargadas no se automatiza nada", () => {
    expect(decideAutonomy({ objective: "Verificar el dato.", channel: "call" }, []).level).toBe("approval");
    expect(decideAutonomy({ objective: "Verificar el dato.", channel: "call" }, null).level).toBe("approval");
  });

  it("el interruptor general fuerza aprobación en todos los tipos de acción", () => {
    const objetivos = [
      "Verificar con el vigilante la columna de humo antes de movilizar.",
      "Coordinar respuesta de coordinacion en Sevilla Hub.",
      "Coordinar respuesta de incendio en Sierra Morena.",
      "Aviso masivo a la población de Costa del Sol.",
      "Coordinar respuesta de evacuacion en Granada y Almería.",
      "Coordinar respuesta de resource-shortage en Sevilla Hub."
    ];

    for (const objetivo of objetivos) {
      const decision = decideAutonomy({ objective: objetivo, channel: "call" }, reglas, {
        autonomyPaused: true,
        confidence: 1
      });
      expect(decision.level).toBe("approval");
      expect(decision.reason).toContain("autonomía está en pausa");
    }
  });

  it("una acción irreversible no se automatiza ni con confianza 1", () => {
    const evacuacion = decideAutonomy(
      { objective: "Coordinar respuesta de evacuacion en Granada y Almería.", channel: "call" },
      reglas,
      { confidence: 1 }
    );
    expect(evacuacion.level).toBe("approval");
    expect(evacuacion.reversibility).toBe("irreversible");
    expect(evacuacion.reason).toContain("irreversible");

    const escalado = decideAutonomy(
      { objective: "Coordinar respuesta de resource-shortage en Sevilla Hub.", channel: "ticket" },
      reglas,
      { confidence: 1 }
    );
    expect(escalado.level).toBe("approval");
  });

  it("aunque una regla suelta diga auto, lo irreversible sigue esperando a una persona", () => {
    const reglaFloja = [
      {
        actionKind: "evacuar" as const,
        reversibility: "irreversible" as const,
        level: "auto" as const,
        confidenceThreshold: 0.1,
        rationale: "Regla mal configurada a propósito para la prueba."
      }
    ];
    const decision = decideAutonomy(
      { objective: "Coordinar respuesta de evacuacion en Costa del Sol.", channel: "call" },
      reglaFloja,
      { confidence: 1 }
    );
    expect(decision.level).toBe("approval");
  });

  it("una acción ya aprobada por una persona no la degrada el motor", () => {
    const decision = decideAutonomy(
      {
        objective: "Coordinar respuesta de evacuacion en Granada y Almería.",
        channel: "call",
        status: "approved",
        approvedBy: "operator"
      },
      reglas
    );
    expect(decision.level).toBe("auto");
    expect(decision.reason).toContain("Ya la aprobó una persona");
  });
});

// ---------------------------------------------------------------------------
// Guardián de despacho
// ---------------------------------------------------------------------------

describe("canAutoDispatch", () => {
  const estado = { autonomyRules: reglas, autonomyPaused: false, events: [] };

  it("deja salir sola una verificación recién propuesta", () => {
    const action = accion({
      objective: "Verificar con el vigilante la columna de humo antes de movilizar.",
      zoneId: "zone-north"
    });
    expect(canAutoDispatch(action, estado)).toBe(true);
    expect(autonomyDecisionFor(action, estado).level).toBe("auto");
  });

  it("frena una evacuación aunque todo lo demás esté en orden", () => {
    const action = accion({
      objective: "Coordinar respuesta de evacuacion en Granada y Almería.",
      zoneId: "zone-east"
    });
    expect(canAutoDispatch(action, estado)).toBe(false);
  });

  it("devuelve false ante cualquier falta de información", () => {
    const action = accion({ objective: "Verificar el dato.", zoneId: "zone-north" });
    expect(canAutoDispatch(null, estado)).toBe(false);
    expect(canAutoDispatch(action, null)).toBe(false);
    expect(canAutoDispatch(action, { autonomyRules: [], autonomyPaused: false })).toBe(false);
    // Un estado sin interruptor no es un estado con la autonomía encendida.
    expect(
      canAutoDispatch(action, { autonomyRules: reglas, autonomyPaused: undefined as unknown as boolean })
    ).toBe(false);
    expect(canAutoDispatch({ ...action, objective: "" }, estado)).toBe(false);
  });

  it("no vuelve a despachar una acción que ya no está pendiente", () => {
    const action = accion({
      objective: "Verificar el dato.",
      zoneId: "zone-north",
      status: "running"
    });
    expect(canAutoDispatch(action, estado)).toBe(false);
  });

  it("con la autonomía en pausa no sale nada", () => {
    const action = accion({ objective: "Verificar el dato.", zoneId: "zone-north" });
    expect(canAutoDispatch(action, { ...estado, autonomyPaused: true })).toBe(false);
  });

  it("usa la señal de la zona para medir la confianza del aviso masivo", () => {
    const action = accion({
      objective: "Coordinar respuesta de alerta publica en Sevilla Hub.",
      zoneId: "zone-central",
      channel: "sms",
      target: "Población de Sevilla"
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
          previousZoneStatus: null
        }
      ]
    };
    expect(autonomyDecisionFor(action, conSenal).confidence).toBe(0.95);
    expect(canAutoDispatch(action, conSenal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Política legible
// ---------------------------------------------------------------------------

describe("resumen de la política", () => {
  it("cuenta cuántos tipos salen solos y cuántos firma una persona", () => {
    const resumen = describeAutonomy(reglas);
    expect(resumen.lines).toHaveLength(6);
    expect(resumen.headline).toContain("3 de 6");
    expect(resumen.headline).toContain("1 solo con confianza muy alta");
    expect(resumen.headline).toContain("2 los firma siempre una persona");
  });

  it("dice claramente cuando la autonomía está en pausa", () => {
    expect(describeAutonomy(reglas, { paused: true }).headline).toContain("Autonomía en pausa");
  });

  it("cada línea explica nivel, reversibilidad y motivo", () => {
    const linea = describeAutonomy(reglas).lines.find((item) => item.actionKind === "aviso-masivo");
    expect(linea).toBeDefined();
    expect(linea!.text).toContain("parcialmente reversible");
    expect(linea!.text).toContain("90 %");
  });
});

// ---------------------------------------------------------------------------
// Coste de oportunidad
// ---------------------------------------------------------------------------

describe("lista de espera", () => {
  it("con dos zonas peleándose un recurso, una espera y se dice cuánto y por qué", () => {
    // Solo queda la brigada de extinción y hay dos incendios abiertos.
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const sevilla = accion({
      id: "act-sevilla",
      objective: "Coordinar respuesta de incendio en Sevilla Hub.",
      zoneId: "zone-central"
    });
    const sierra = accion({
      id: "act-sierra",
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north"
    });

    const espera = buildWaitingList([sevilla, sierra], brigada, zones);

    // Sevilla Hub es más urgente (activa, más población), así que se lleva la brigada.
    expect(espera).toHaveLength(1);
    expect(espera[0].actionId).toBe("act-sierra");
    expect(espera[0].zoneId).toBe("zone-north");
    expect(espera[0].wantedResourceId).toBe("res-field-1");
    expect(espera[0].blockedByActionId).toBe("act-sevilla");
    expect(espera[0].estimatedWaitMinutes).toBe(45);
    expect(espera[0].reason).toContain("INFOCA Sierra Bravo");
    expect(espera[0].reason).toContain("Espera estimada: ~45 min");
  });

  it("la tercera zona en la cola espera más que la segunda", () => {
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const acciones = [
      accion({
        id: "act-1",
        objective: "Coordinar respuesta de incendio en Sevilla Hub.",
        zoneId: "zone-central"
      }),
      accion({
        id: "act-2",
        objective: "Coordinar respuesta de incendio en Sierra Morena.",
        zoneId: "zone-north"
      }),
      accion({
        id: "act-3",
        objective: "Coordinar respuesta de incendio en Costa del Sol.",
        zoneId: "zone-south"
      })
    ];

    const espera = buildWaitingList(acciones, brigada, zones);
    expect(espera).toHaveLength(2);
    const minutos = espera.map((item) => item.estimatedWaitMinutes ?? 0);
    expect(minutos[1]).toBeGreaterThan(minutos[0]);
    expect(espera[1].reason).toContain("por delante en la cola");
  });

  it("sin ningún recurso capaz, la espera no es estimable y lo dice", () => {
    const soloComunicaciones = recursos().filter((resource) => resource.id === "res-comms-1");
    const accionIncendio = accion({
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north"
    });

    const espera = buildWaitingList([accionIncendio], soloComunicaciones, zones);
    expect(espera).toHaveLength(1);
    expect(espera[0].estimatedWaitMinutes).toBeNull();
    expect(espera[0].blockedByActionId).toBeNull();
    expect(espera[0].reason).toContain("apoyo externo");
  });

  it("con recursos de sobra la lista de espera queda vacía", () => {
    const accionTriaje = accion({
      objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
      zoneId: "zone-central"
    });
    expect(buildWaitingList([accionTriaje], recursos(), zones)).toEqual([]);
  });

  it("las acciones cerradas no ocupan sitio en la cola", () => {
    const brigada = recursos().filter((resource) => resource.id === "res-field-1");
    const cerrada = accion({
      id: "act-cerrada",
      objective: "Coordinar respuesta de incendio en Sevilla Hub.",
      zoneId: "zone-central",
      status: "succeeded"
    });
    const abierta = accion({
      id: "act-abierta",
      objective: "Coordinar respuesta de incendio en Sierra Morena.",
      zoneId: "zone-north"
    });

    expect(buildWaitingList([cerrada, abierta], brigada, zones)).toEqual([]);
  });
});
