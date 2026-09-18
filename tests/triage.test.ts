// PROPIETARIO: agente de triaje calibrado y verificación.
//
// Lo que se prueba aquí es la salida del medio: que una señal dudosa no se
// quede esperando, sino que genere una verificación concreta. Y que la
// confianza se fusione como fuentes independientes, no como votos.

import { afterEach, describe, expect, it } from "vitest";
import {
  assessSignal,
  buildVerificationRequest,
  defaultTriageThresholds,
  deterministicAssessor,
  externalAssessorPlaceholder,
  fuseConfidence,
  MIN_SOURCE_SAMPLES,
  registerAssessor,
  reliabilityOf,
  selectAssessor,
  updateSourceReliability
} from "@/lib/triage";
import type { SignalAssessor, TriageContext, TriageSignal } from "@/lib/triage";
import { seedContacts, seedSourceReliability, seedZones } from "@/lib/seed";
import type { CrisisEvent, SignalAssessment, SourceReliability } from "@/lib/types";

// ---------------------------------------------------------------------------
// Utilidades de prueba
// ---------------------------------------------------------------------------

/** Instante fijo: con `now` congelado la evaluación es reproducible. */
const AHORA = "2026-03-01T12:00:00.000Z";

function fiabilidades(): SourceReliability[] {
  return seedSourceReliability.map((entry) => ({ ...entry }));
}

function contexto(overrides: Partial<TriageContext> = {}): TriageContext {
  return {
    sourceReliability: fiabilidades(),
    zones: seedZones,
    events: [],
    now: AHORA,
    ...overrides
  };
}

function senal(overrides: Partial<TriageSignal> = {}): TriageSignal {
  return {
    id: "evt-nueva",
    source: "sensor",
    title: "Frente de fuego detectado",
    description: "Lectura térmica sostenida en la ladera norte.",
    zoneId: "zone-north",
    category: "incendio",
    severity: "high",
    confidence: "high",
    confirmed: null,
    occurrences: 1,
    createdAt: AHORA,
    ...overrides
  };
}

function evento(overrides: Partial<CrisisEvent> = {}): CrisisEvent {
  return {
    id: "evt-previa",
    source: "sensor",
    title: "Aviso previo",
    description: "Señal ya presente en el estado.",
    zoneId: "zone-south",
    category: "evacuacion",
    severity: "high",
    confidence: "high",
    createdAt: AHORA,
    confirmed: null,
    dedupeKey: "zone-south:evacuacion:high",
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
    ...overrides
  };
}

function eventoDe(assessment: SignalAssessment, overrides: Partial<CrisisEvent> = {}): CrisisEvent {
  return evento({ assessment, ...overrides });
}

afterEach(() => {
  registerAssessor(null);
  delete process.env.TRIAGE_ASSESSOR;
});

// ---------------------------------------------------------------------------
// Las tres salidas
// ---------------------------------------------------------------------------

describe("tres salidas del triaje", () => {
  it("una señal de sensor claramente relevante se resuelve como actuar", () => {
    const assessment = assessSignal(
      senal({ severity: "critical", confidence: "high", source: "sensor" }),
      contexto()
    );

    expect(assessment.decision).toBe("act");
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.85);
    expect(assessment.pRelevant).toBeGreaterThan(0.85);
    expect(assessment.urgency).toBeGreaterThan(0.9);
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.sourceReliability).toBe(0.9);
    expect(assessment.rationale).toContain("se actúa");
  });

  it("un bulo de una fuente poco fiable se descarta con motivo visible", () => {
    const assessment = assessSignal(
      senal({
        source: "public",
        title: "Dicen que han cortado el agua en toda la costa",
        zoneId: "zone-south",
        category: "refugio",
        severity: "low",
        confidence: "low"
      }),
      contexto()
    );

    expect(assessment.decision).toBe("discard");
    expect(assessment.confidence).toBeLessThan(defaultTriageThresholds.verify);
    // El motivo tiene que ser legible y nombrar la fuente y el número.
    expect(assessment.rationale).toContain("aviso ciudadano");
    expect(assessment.rationale).toContain("se descarta");
  });

  it("una señal intermedia se verifica en vez de esperar y pide preguntas cerradas", () => {
    const assessment = assessSignal(
      senal({
        source: "happyrobot",
        title: "Llamada avisa de personas atrapadas en un camping",
        zoneId: "zone-east",
        category: "sanitario",
        severity: "high",
        confidence: "medium"
      }),
      contexto()
    );

    expect(assessment.decision).toBe("verify");
    expect(assessment.confidence).toBeGreaterThan(0.5);
    expect(assessment.confidence).toBeLessThan(0.85);
    expect(assessment.rationale).toContain("se verifica");

    const peticion = buildVerificationRequest(
      eventoDe(assessment, {
        id: "evt-camping",
        zoneId: "zone-east",
        category: "sanitario",
        severity: "high",
        title: "Llamada avisa de personas atrapadas en un camping"
      }),
      assessment,
      { zones: seedZones, contacts: seedContacts }
    );

    // Dos o tres preguntas, no un cuestionario.
    expect(peticion.questions.length).toBeGreaterThanOrEqual(2);
    expect(peticion.questions.length).toBeLessThanOrEqual(3);
    // Cerradas: todas ofrecen las opciones de respuesta entre paréntesis.
    for (const pregunta of peticion.questions) {
      expect(pregunta).toMatch(/\(.+\)$/);
    }
    expect(peticion.doubt).toBe("veracidad");
    expect(peticion.role).toBe("medical-lead");
    expect(peticion.channel).toBe("call");
    expect(peticion.contactId).toBe("con-med-central");
    expect(peticion.objective).toContain("verificar");
    expect(peticion.objective).toContain("Granada y Almería");
    expect(peticion.reason).toContain("Triaje intermedio");
    expect(peticion.eventId).toBe("evt-camping");
  });

  it("una señal ya descartada por un operador no vuelve a colarse", () => {
    const assessment = assessSignal(
      senal({ confirmed: false, severity: "critical", confidence: "high" }),
      contexto()
    );

    expect(assessment.decision).toBe("discard");
    expect(assessment.pTruthful).toBeLessThan(0.1);
    expect(assessment.rationale).toContain("descartada por un operador");
  });
});

// ---------------------------------------------------------------------------
// Fusión de fuentes
// ---------------------------------------------------------------------------

describe("fusión de confianza", () => {
  it("dos testigos independientes pesan más que uno, con rendimientos decrecientes", () => {
    const uno = fuseConfidence([{ source: "public", probability: 0.8, reliability: 0.6 }]);
    const dos = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 }
    ]);
    const tres = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 },
      { source: "operator", probability: 0.8, reliability: 0.6 }
    ]);

    expect(uno).toBeCloseTo(0.48, 3);
    expect(dos).toBeCloseTo(0.73, 2);
    expect(tres).toBeGreaterThan(dos);
    // Rendimientos decrecientes: el tercer testigo aporta menos que el segundo.
    expect(tres - dos).toBeLessThan(dos - uno);
    // Nunca llega a la certeza absoluta.
    expect(tres).toBeLessThan(1);
  });

  it("dos señales de la misma fuente no cuentan como dos testigos", () => {
    const independientes = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 }
    ]);
    const mismaFuente = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "public", probability: 0.8, reliability: 0.6 }
    ]);

    expect(mismaFuente).toBeLessThan(independientes);
    // Sigue aportando algo, pero muy descontado por correlación.
    expect(mismaFuente).toBeGreaterThan(
      fuseConfidence([{ source: "public", probability: 0.8, reliability: 0.6 }])
    );
    // Con peso cero, repetir la misma fuente no aporta absolutamente nada.
    const sinCorrelacion = fuseConfidence(
      [
        { source: "public", probability: 0.8, reliability: 0.6 },
        { source: "public", probability: 0.8, reliability: 0.6 }
      ],
      { sameSourceWeight: 0 }
    );
    expect(sinCorrelacion).toBeCloseTo(0.48, 3);
  });

  it("sin señales no hay confianza que fusionar", () => {
    expect(fuseConfidence([])).toBe(0);
  });

  it("dos testigos independientes suben la confianza por encima del umbral de actuar", () => {
    const aviso = senal({
      id: "evt-vecino",
      source: "public",
      title: "Vecino avisa de una urbanización rodeada de humo",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high"
    });

    const solo = assessSignal(aviso, contexto());
    const conTestigo = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-sensor-sur", source: "sensor" })] })
    );

    expect(solo.decision).toBe("verify");
    expect(conTestigo.decision).toBe("act");
    expect(conTestigo.confidence).toBeGreaterThan(solo.confidence);
    expect(conTestigo.confidence).toBeGreaterThanOrEqual(defaultTriageThresholds.act);
  });

  it("dos señales de la misma fuente no suben la confianza igual que dos independientes", () => {
    const aviso = senal({
      id: "evt-vecino",
      source: "public",
      title: "Vecino avisa de una urbanización rodeada de humo",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high"
    });

    const independiente = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-sensor-sur", source: "sensor" })] })
    );
    const mismaFuente = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-otro-vecino", source: "public" })] })
    );

    expect(mismaFuente.confidence).toBeLessThan(independiente.confidence);
    expect(mismaFuente.decision).toBe("verify");
    expect(independiente.decision).toBe("act");
  });

  it("una señal contradicha por otra ya descartada pierde credibilidad", () => {
    const aviso = senal({
      id: "evt-dudoso",
      source: "happyrobot",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high"
    });

    const limpio = assessSignal(aviso, contexto());
    const contradicho = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-falso", confirmed: false })] })
    );

    expect(contradicho.pTruthful).toBeLessThan(limpio.pTruthful);
    expect(contradicho.pRelevant).toBeLessThan(limpio.pRelevant);
    expect(contradicho.rationale).toContain("descartada");
  });
});

// ---------------------------------------------------------------------------
// Fiabilidad aprendida de las fuentes
// ---------------------------------------------------------------------------

describe("fiabilidad de las fuentes", () => {
  it("una sola muestra no mueve la fiabilidad de una fuente", () => {
    const antes = fiabilidades();
    const despues = updateSourceReliability(antes, "public", false);

    const entrada = despues.find((item) => item.source === "public");
    expect(entrada?.reliability).toBe(0.55);
    expect(entrada?.observations).toBe(1);
    expect(entrada?.confirmed).toBe(0);
    // No muta la lista original.
    expect(antes.find((item) => item.source === "public")?.observations).toBe(0);
  });

  it("la fiabilidad baja tras varios falsos confirmados, pero paso a paso", () => {
    let lista = fiabilidades();
    const inicial = reliabilityOf(lista, "public");

    for (let i = 0; i < MIN_SOURCE_SAMPLES - 1; i += 1) {
      lista = updateSourceReliability(lista, "public", false);
      expect(reliabilityOf(lista, "public")).toBe(inicial);
    }

    lista = updateSourceReliability(lista, "public", false);
    const trasMinimo = reliabilityOf(lista, "public");
    expect(trasMinimo).toBeLessThan(inicial);
    // Movimiento acotado: nunca se desploma de golpe.
    expect(inicial - trasMinimo).toBeLessThanOrEqual(0.05 + 1e-9);

    for (let i = 0; i < 20; i += 1) lista = updateSourceReliability(lista, "public", false);
    // Ni con veinte bulos seguidos se llega a cero: la fuente puede acertar mañana.
    expect(reliabilityOf(lista, "public")).toBeGreaterThanOrEqual(0.15);
  });

  it("la fiabilidad sube cuando las señales de la fuente se confirman", () => {
    let lista = fiabilidades();
    const inicial = reliabilityOf(lista, "public");
    for (let i = 0; i < MIN_SOURCE_SAMPLES; i += 1) {
      lista = updateSourceReliability(lista, "public", true);
    }
    expect(reliabilityOf(lista, "public")).toBeGreaterThan(inicial);
  });

  it("una fuente desconocida arranca con la fiabilidad por defecto y se registra", () => {
    const lista = updateSourceReliability([], "scenario", true);
    const entrada = lista.find((item) => item.source === "scenario");
    expect(entrada).toBeTruthy();
    expect(entrada?.observations).toBe(1);
    expect(reliabilityOf([], "scenario")).toBe(0.6);
  });

  it("una fuente menos fiable empuja la misma señal de actuar a verificar", () => {
    const aviso = senal({ severity: "critical", confidence: "high", source: "sensor" });
    const confiable = assessSignal(aviso, contexto());

    let degradada = fiabilidades();
    for (let i = 0; i < 12; i += 1) degradada = updateSourceReliability(degradada, "sensor", false);
    const dudosa = assessSignal(aviso, contexto({ sourceReliability: degradada }));

    expect(confiable.decision).toBe("act");
    expect(dudosa.confidence).toBeLessThan(confiable.confidence);
    expect(dudosa.decision).not.toBe("act");
  });
});

// ---------------------------------------------------------------------------
// Umbrales y determinismo
// ---------------------------------------------------------------------------

describe("umbrales y determinismo", () => {
  it("los umbrales son configurables y cambian la decisión", () => {
    const aviso = senal({
      source: "happyrobot",
      zoneId: "zone-east",
      category: "sanitario",
      severity: "high",
      confidence: "medium"
    });

    const pordefecto = assessSignal(aviso, contexto());
    expect(pordefecto.decision).toBe("verify");

    // Bajar el umbral de actuación (lo que propondría el aprendizaje si las
    // señales por encima de 0,6 se confirman siempre) convierte esa misma
    // señal en acción directa.
    const exigenteMenos = assessSignal(
      aviso,
      contexto({ thresholds: { act: 0.6, urgencyRelief: 0, verifyUrgencyRelief: 0 } })
    );
    expect(exigenteMenos.decision).toBe("act");

    // Subir el umbral de verificación la manda a la papelera.
    const exigenteMas = assessSignal(
      aviso,
      contexto({ thresholds: { verify: 0.9, urgencyRelief: 0, verifyUrgencyRelief: 0 } })
    );
    expect(exigenteMas.decision).toBe("discard");
  });

  it("el umbral cede con la urgencia: lo urgente se verifica antes que se descarta", () => {
    const aviso = senal({
      source: "public",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "medium"
    });

    const conAlivio = assessSignal(aviso, contexto());
    const sinAlivio = assessSignal(
      aviso,
      contexto({ thresholds: { urgencyRelief: 0, verifyUrgencyRelief: 0 } })
    );

    expect(conAlivio.decision).toBe("verify");
    expect(sinAlivio.decision).toBe("discard");
    // Las probabilidades no cambian: lo único que se mueve es el listón.
    expect(conAlivio.confidence).toBe(sinAlivio.confidence);
  });

  it("mismas entradas, misma evaluación", () => {
    const aviso = senal({ source: "happyrobot", confidence: "medium", severity: "high" });
    const contextoFijo = contexto({ events: [evento({ zoneId: "zone-north", category: "incendio" })] });

    const primera = assessSignal(aviso, contextoFijo);
    const segunda = assessSignal(
      aviso,
      contexto({ events: [evento({ zoneId: "zone-north", category: "incendio" })] })
    );

    expect(segunda).toEqual(primera);
    expect(primera.assessedAt).toBe(AHORA);
  });

  it("una señal más vieja urge menos que la misma recién llegada", () => {
    const reciente = assessSignal(senal(), contexto());
    const vieja = assessSignal(
      senal({ createdAt: new Date(Date.parse(AHORA) - 90 * 60000).toISOString() }),
      contexto()
    );

    expect(vieja.urgency).toBeLessThan(reciente.urgency);
  });
});

// ---------------------------------------------------------------------------
// Arquitectura intercambiable
// ---------------------------------------------------------------------------

describe("evaluadores intercambiables", () => {
  const falso: SignalAssessor = {
    name: "jev",
    available: () => true,
    assess: () => ({
      pRelevant: 0.99,
      pTruthful: 0.99,
      urgency: 0.99,
      confidence: 0.99,
      decision: "act",
      rationale: "Evaluación del clasificador externo.",
      assessedBy: "jev",
      sourceReliability: 0.99,
      assessedAt: AHORA
    })
  };

  it("sin evaluador registrado se usa el motor determinista", () => {
    expect(selectAssessor()).toBe(deterministicAssessor);
    expect(assessSignal(senal(), contexto()).assessedBy).toBe("deterministic");
  });

  it("el evaluador externo sólo entra si el entorno lo pide", () => {
    registerAssessor(falso);
    expect(selectAssessor()).toBe(deterministicAssessor);

    process.env.TRIAGE_ASSESSOR = "jev";
    expect(selectAssessor()).toBe(falso);
    expect(assessSignal(senal(), contexto()).assessedBy).toBe("jev");
  });

  it("un evaluador externo no disponible cae al determinista sin romper nada", () => {
    process.env.TRIAGE_ASSESSOR = "jev";
    registerAssessor({ ...falso, available: () => false });
    expect(selectAssessor()).toBe(deterministicAssessor);

    // Y si revienta al comprobar disponibilidad, tampoco se propaga.
    registerAssessor({
      ...falso,
      available: () => {
        throw new Error("sin acceso anticipado");
      }
    });
    expect(selectAssessor()).toBe(deterministicAssessor);
  });

  it("si el evaluador externo falla al evaluar, responde el determinista y se dice", () => {
    process.env.TRIAGE_ASSESSOR = "jev";
    registerAssessor({
      ...falso,
      assess: () => {
        throw new Error("timeout del clasificador");
      }
    });

    const assessment = assessSignal(senal({ severity: "critical" }), contexto());
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.rationale).toContain("respaldo determinista");
    expect(assessment.decision).toBe("act");
  });

  it("el hueco de Jev nunca firma como Jev mientras no haya acceso", () => {
    expect(externalAssessorPlaceholder.available()).toBe(false);
    const assessment = externalAssessorPlaceholder.assess(senal(), contexto());
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.rationale).toContain("no disponible");
  });
});

// ---------------------------------------------------------------------------
// Petición de verificación
// ---------------------------------------------------------------------------

describe("petición de verificación", () => {
  it("pregunta por la relevancia cuando la duda es si eso importa aquí", () => {
    const assessment: SignalAssessment = {
      pRelevant: 0.45,
      pTruthful: 0.8,
      urgency: 0.3,
      confidence: 0.8,
      decision: "verify",
      rationale: "prueba",
      assessedBy: "deterministic",
      sourceReliability: 0.6,
      assessedAt: AHORA
    };

    const peticion = buildVerificationRequest(
      evento({
        id: "evt-dudoso",
        zoneId: "zone-south",
        category: "refugio",
        severity: "medium",
        title: "Aviso de refugio saturado"
      }),
      assessment,
      { zones: seedZones, contacts: seedContacts }
    );

    expect(peticion.doubt).toBe("relevancia");
    expect(peticion.channel).toBe("sms");
    expect(peticion.questions.length).toBeGreaterThanOrEqual(2);
    expect(peticion.questions[0]).toContain("Costa del Sol");
  });

  it("funciona sin contactos ni zonas y sigue nombrando a alguien concreto", () => {
    const assessment: SignalAssessment = {
      pRelevant: 0.7,
      pTruthful: 0.6,
      urgency: 0.8,
      confidence: 0.6,
      decision: "verify",
      rationale: "prueba",
      assessedBy: "deterministic",
      sourceReliability: 0.6,
      assessedAt: AHORA
    };

    const peticion = buildVerificationRequest(evento({ id: "evt-sin-contexto" }), assessment);

    expect(peticion.contactId).toBeNull();
    expect(peticion.target).toContain("coordinación de campo");
    expect(peticion.channel).toBe("call");
    expect(peticion.zoneId).toBe("zone-south");
  });
});
