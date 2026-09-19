// OWNER: calibrated triage and verification agent.
//
// What is tested here is the middle outcome: that a doubtful signal does not
// sit waiting, but generates a concrete verification. And that confidence
// is fused as independent sources, not as votes.

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
  updateSourceReliability,
} from "@/lib/triage";
import type { SignalAssessor, TriageContext, TriageSignal } from "@/lib/triage";
import { seedContacts, seedSourceReliability, seedZones } from "@/lib/seed";
import type { CrisisEvent, SignalAssessment, SourceReliability } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Fixed timestamp: with frozen `now`, evaluation is reproducible. */
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
    ...overrides,
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
    ...overrides,
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
    ...overrides,
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
// The three outcomes
// ---------------------------------------------------------------------------

describe("three triage outcomes", () => {
  it("resolves a clearly relevant sensor signal as act", () => {
    const assessment = assessSignal(
      senal({ severity: "critical", confidence: "high", source: "sensor" }),
      contexto(),
    );

    expect(assessment.decision).toBe("act");
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.85);
    expect(assessment.pRelevant).toBeGreaterThan(0.85);
    expect(assessment.urgency).toBeGreaterThan(0.9);
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.sourceReliability).toBe(0.9);
    expect(assessment.rationale).toContain("acting");
  });

  it("discards a rumor from an unreliable source with a visible reason", () => {
    const assessment = assessSignal(
      senal({
        source: "public",
        title: "Dicen que han cortado el agua en toda la costa",
        zoneId: "zone-south",
        category: "refugio",
        severity: "low",
        confidence: "low",
      }),
      contexto(),
    );

    expect(assessment.decision).toBe("discard");
    expect(assessment.confidence).toBeLessThan(defaultTriageThresholds.verify);
    // The rationale must be readable and name the source and numbers.
    expect(assessment.rationale).toContain("citizen report");
    expect(assessment.rationale).toContain("discarded");
  });

  it("verifies an intermediate signal instead of waiting and asks closed questions", () => {
    const assessment = assessSignal(
      senal({
        source: "happyrobot",
        title: "Llamada avisa de personas atrapadas en un camping",
        zoneId: "zone-east",
        category: "sanitario",
        severity: "high",
        confidence: "medium",
      }),
      contexto(),
    );

    expect(assessment.decision).toBe("verify");
    expect(assessment.confidence).toBeGreaterThan(0.5);
    expect(assessment.confidence).toBeLessThan(0.85);
    expect(assessment.rationale).toContain("verifying");

    const peticion = buildVerificationRequest(
      eventoDe(assessment, {
        id: "evt-camping",
        zoneId: "zone-east",
        category: "sanitario",
        severity: "high",
        title: "Llamada avisa de personas atrapadas en un camping",
      }),
      assessment,
      { zones: seedZones, contacts: seedContacts },
    );

    // Two or three questions, not a questionnaire.
    expect(peticion.questions.length).toBeGreaterThanOrEqual(2);
    expect(peticion.questions.length).toBeLessThanOrEqual(3);
    // Closed: all offer answer choices in parentheses.
    for (const pregunta of peticion.questions) {
      expect(pregunta).toMatch(/\(.+\)$/);
    }
    expect(peticion.doubt).toBe("veracidad");
    expect(peticion.role).toBe("medical-lead");
    expect(peticion.channel).toBe("call");
    expect(peticion.contactId).toBe("con-med-central");
    expect(peticion.objective).toContain("verify");
    expect(peticion.objective).toContain("Granada y Almería");
    expect(peticion.reason).toContain("Intermediate triage");
    expect(peticion.eventId).toBe("evt-camping");
  });

  it("prevents an already operator-discarded signal from slipping back in", () => {
    const assessment = assessSignal(
      senal({ confirmed: false, severity: "critical", confidence: "high" }),
      contexto(),
    );

    expect(assessment.decision).toBe("discard");
    expect(assessment.pTruthful).toBeLessThan(0.1);
    expect(assessment.rationale).toContain("discarded by an operator");
  });
});

// ---------------------------------------------------------------------------
// Source fusion
// ---------------------------------------------------------------------------

describe("confidence fusion", () => {
  it("two independent witnesses weigh more than one, with diminishing returns", () => {
    const uno = fuseConfidence([{ source: "public", probability: 0.8, reliability: 0.6 }]);
    const dos = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 },
    ]);
    const tres = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 },
      { source: "operator", probability: 0.8, reliability: 0.6 },
    ]);

    expect(uno).toBeCloseTo(0.48, 3);
    expect(dos).toBeCloseTo(0.73, 2);
    expect(tres).toBeGreaterThan(dos);
    // Diminishing returns: the third witness adds less than the second.
    expect(tres - dos).toBeLessThan(dos - uno);
    // Never reaches absolute certainty.
    expect(tres).toBeLessThan(1);
  });

  it("two signals from the same source do not count as two witnesses", () => {
    const independientes = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "sensor", probability: 0.8, reliability: 0.6 },
    ]);
    const mismaFuente = fuseConfidence([
      { source: "public", probability: 0.8, reliability: 0.6 },
      { source: "public", probability: 0.8, reliability: 0.6 },
    ]);

    expect(mismaFuente).toBeLessThan(independientes);
    // Still contributes something, but heavily discounted for correlation.
    expect(mismaFuente).toBeGreaterThan(
      fuseConfidence([{ source: "public", probability: 0.8, reliability: 0.6 }]),
    );
    // With zero weight, repeating the same source adds absolutely nothing.
    const sinCorrelacion = fuseConfidence(
      [
        { source: "public", probability: 0.8, reliability: 0.6 },
        { source: "public", probability: 0.8, reliability: 0.6 },
      ],
      { sameSourceWeight: 0 },
    );
    expect(sinCorrelacion).toBeCloseTo(0.48, 3);
  });

  it("without signals there is no confidence to fuse", () => {
    expect(fuseConfidence([])).toBe(0);
  });

  it("two independent witnesses push confidence above the act threshold", () => {
    const aviso = senal({
      id: "evt-vecino",
      source: "public",
      title: "Vecino avisa de una urbanización rodeada de humo",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high",
    });

    const solo = assessSignal(aviso, contexto());
    const conTestigo = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-sensor-sur", source: "sensor" })] }),
    );

    expect(solo.decision).toBe("verify");
    expect(conTestigo.decision).toBe("act");
    expect(conTestigo.confidence).toBeGreaterThan(solo.confidence);
    expect(conTestigo.confidence).toBeGreaterThanOrEqual(defaultTriageThresholds.act);
  });

  it("two signals from the same source do not raise confidence like two independent ones", () => {
    const aviso = senal({
      id: "evt-vecino",
      source: "public",
      title: "Vecino avisa de una urbanización rodeada de humo",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high",
    });

    const independiente = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-sensor-sur", source: "sensor" })] }),
    );
    const mismaFuente = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-otro-vecino", source: "public" })] }),
    );

    expect(mismaFuente.confidence).toBeLessThan(independiente.confidence);
    expect(mismaFuente.decision).toBe("verify");
    expect(independiente.decision).toBe("act");
  });

  it("a signal contradicted by an already discarded one loses credibility", () => {
    const aviso = senal({
      id: "evt-dudoso",
      source: "happyrobot",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "high",
    });

    const limpio = assessSignal(aviso, contexto());
    const contradicho = assessSignal(
      aviso,
      contexto({ events: [evento({ id: "evt-falso", confirmed: false })] }),
    );

    expect(contradicho.pTruthful).toBeLessThan(limpio.pTruthful);
    expect(contradicho.pRelevant).toBeLessThan(limpio.pRelevant);
    expect(contradicho.rationale).toContain("discarded");
  });
});

// ---------------------------------------------------------------------------
// Learned source reliability
// ---------------------------------------------------------------------------

describe("source reliability", () => {
  it("a single sample does not move a source's reliability", () => {
    const antes = fiabilidades();
    const despues = updateSourceReliability(antes, "public", false);

    const entrada = despues.find((item) => item.source === "public");
    expect(entrada?.reliability).toBe(0.55);
    expect(entrada?.observations).toBe(1);
    expect(entrada?.confirmed).toBe(0);
    // Does not mutate the original list.
    expect(antes.find((item) => item.source === "public")?.observations).toBe(0);
  });

  it("reliability drops after several confirmed false reports, but step by step", () => {
    let lista = fiabilidades();
    const inicial = reliabilityOf(lista, "public");

    for (let i = 0; i < MIN_SOURCE_SAMPLES - 1; i += 1) {
      lista = updateSourceReliability(lista, "public", false);
      expect(reliabilityOf(lista, "public")).toBe(inicial);
    }

    lista = updateSourceReliability(lista, "public", false);
    const trasMinimo = reliabilityOf(lista, "public");
    expect(trasMinimo).toBeLessThan(inicial);
    // Bounded movement: never collapses all at once.
    expect(inicial - trasMinimo).toBeLessThanOrEqual(0.05 + 1e-9);

    for (let i = 0; i < 20; i += 1) lista = updateSourceReliability(lista, "public", false);
    // Even with twenty rumors in a row it never reaches zero: source may be right tomorrow.
    expect(reliabilityOf(lista, "public")).toBeGreaterThanOrEqual(0.15);
  });

  it("reliability rises when signals from the source are confirmed", () => {
    let lista = fiabilidades();
    const inicial = reliabilityOf(lista, "public");
    for (let i = 0; i < MIN_SOURCE_SAMPLES; i += 1) {
      lista = updateSourceReliability(lista, "public", true);
    }
    expect(reliabilityOf(lista, "public")).toBeGreaterThan(inicial);
  });

  it("an unknown source starts with default reliability and is registered", () => {
    const lista = updateSourceReliability([], "scenario", true);
    const entrada = lista.find((item) => item.source === "scenario");
    expect(entrada).toBeTruthy();
    expect(entrada?.observations).toBe(1);
    expect(reliabilityOf([], "scenario")).toBe(0.6);
  });

  it("a less reliable source pushes the same signal from act to verify", () => {
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
// Thresholds and determinism
// ---------------------------------------------------------------------------

describe("thresholds and determinism", () => {
  it("thresholds are configurable and change the decision", () => {
    const aviso = senal({
      source: "happyrobot",
      zoneId: "zone-east",
      category: "sanitario",
      severity: "high",
      confidence: "medium",
    });

    const pordefecto = assessSignal(aviso, contexto());
    expect(pordefecto.decision).toBe("verify");

    // Lowering act threshold (what learning would propose if signals
    // above 0.6 are consistently confirmed) turns this signal into direct action.
    const exigenteMenos = assessSignal(
      aviso,
      contexto({ thresholds: { act: 0.6, urgencyRelief: 0, verifyUrgencyRelief: 0 } }),
    );
    expect(exigenteMenos.decision).toBe("act");

    // Raising verify threshold sends it to discard.
    const exigenteMas = assessSignal(
      aviso,
      contexto({ thresholds: { verify: 0.9, urgencyRelief: 0, verifyUrgencyRelief: 0 } }),
    );
    expect(exigenteMas.decision).toBe("discard");
  });

  it("threshold yields to urgency: urgent signals are verified before being discarded", () => {
    const aviso = senal({
      source: "public",
      zoneId: "zone-south",
      category: "evacuacion",
      severity: "high",
      confidence: "medium",
    });

    const conAlivio = assessSignal(aviso, contexto());
    const sinAlivio = assessSignal(
      aviso,
      contexto({ thresholds: { urgencyRelief: 0, verifyUrgencyRelief: 0 } }),
    );

    expect(conAlivio.decision).toBe("verify");
    expect(sinAlivio.decision).toBe("discard");
    // Probabilities do not change: only the bar moves.
    expect(conAlivio.confidence).toBe(sinAlivio.confidence);
  });

  it("same inputs produce same assessment", () => {
    const aviso = senal({ source: "happyrobot", confidence: "medium", severity: "high" });
    const contextoFijo = contexto({
      events: [evento({ zoneId: "zone-north", category: "incendio" })],
    });

    const primera = assessSignal(aviso, contextoFijo);
    const segunda = assessSignal(
      aviso,
      contexto({ events: [evento({ zoneId: "zone-north", category: "incendio" })] }),
    );

    expect(segunda).toEqual(primera);
    expect(primera.assessedAt).toBe(AHORA);
  });

  it("an older signal is less urgent than the same signal freshly arrived", () => {
    const reciente = assessSignal(senal(), contexto());
    const vieja = assessSignal(
      senal({ createdAt: new Date(Date.parse(AHORA) - 90 * 60000).toISOString() }),
      contexto(),
    );

    expect(vieja.urgency).toBeLessThan(reciente.urgency);
  });
});

// ---------------------------------------------------------------------------
// Swappable architecture
// ---------------------------------------------------------------------------

describe("swappable assessors", () => {
  const falso: SignalAssessor = {
    name: "jev",
    available: () => true,
    assess: () => ({
      pRelevant: 0.99,
      pTruthful: 0.99,
      urgency: 0.99,
      confidence: 0.99,
      decision: "act",
      rationale: "External classifier evaluation.",
      assessedBy: "jev",
      sourceReliability: 0.99,
      assessedAt: AHORA,
    }),
  };

  it("uses deterministic engine when no assessor is registered", () => {
    expect(selectAssessor()).toBe(deterministicAssessor);
    expect(assessSignal(senal(), contexto()).assessedBy).toBe("deterministic");
  });

  it("external assessor only activates if environment requests it", () => {
    registerAssessor(falso);
    expect(selectAssessor()).toBe(deterministicAssessor);

    process.env.TRIAGE_ASSESSOR = "jev";
    expect(selectAssessor()).toBe(falso);
    expect(assessSignal(senal(), contexto()).assessedBy).toBe("jev");
  });

  it("an unavailable external assessor falls back to deterministic without breaking", () => {
    process.env.TRIAGE_ASSESSOR = "jev";
    registerAssessor({ ...falso, available: () => false });
    expect(selectAssessor()).toBe(deterministicAssessor);

    // And if it throws when checking availability, it is not propagated either.
    registerAssessor({
      ...falso,
      available: () => {
        throw new Error("no early access");
      },
    });
    expect(selectAssessor()).toBe(deterministicAssessor);
  });

  it("if external assessor throws while assessing, deterministic responds and notes it", () => {
    process.env.TRIAGE_ASSESSOR = "jev";
    registerAssessor({
      ...falso,
      assess: () => {
        throw new Error("classifier timeout");
      },
    });

    const assessment = assessSignal(senal({ severity: "critical" }), contexto());
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.rationale).toContain("deterministic fallback");
    expect(assessment.decision).toBe("act");
  });

  it("Jev placeholder never signs as Jev while access is unavailable", () => {
    expect(externalAssessorPlaceholder.available()).toBe(false);
    const assessment = externalAssessorPlaceholder.assess(senal(), contexto());
    expect(assessment.assessedBy).toBe("deterministic");
    expect(assessment.rationale).toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Verification request
// ---------------------------------------------------------------------------

describe("verification request", () => {
  it("asks about relevance when doubt is whether this matters here", () => {
    const assessment: SignalAssessment = {
      pRelevant: 0.45,
      pTruthful: 0.8,
      urgency: 0.3,
      confidence: 0.8,
      decision: "verify",
      rationale: "test",
      assessedBy: "deterministic",
      sourceReliability: 0.6,
      assessedAt: AHORA,
    };

    const peticion = buildVerificationRequest(
      evento({
        id: "evt-dudoso",
        zoneId: "zone-south",
        category: "refugio",
        severity: "medium",
        title: "Aviso de refugio saturado",
      }),
      assessment,
      { zones: seedZones, contacts: seedContacts },
    );

    expect(peticion.doubt).toBe("relevancia");
    expect(peticion.channel).toBe("sms");
    expect(peticion.questions.length).toBeGreaterThanOrEqual(2);
    expect(peticion.questions[0]).toContain("Costa del Sol");
  });

  it("works without contacts or zones and still names someone specific", () => {
    const assessment: SignalAssessment = {
      pRelevant: 0.7,
      pTruthful: 0.6,
      urgency: 0.8,
      confidence: 0.6,
      decision: "verify",
      rationale: "test",
      assessedBy: "deterministic",
      sourceReliability: 0.6,
      assessedAt: AHORA,
    };

    const peticion = buildVerificationRequest(evento({ id: "evt-sin-contexto" }), assessment);

    expect(peticion.contactId).toBeNull();
    expect(peticion.target).toContain("field coordinator");
    expect(peticion.channel).toBe("call");
    expect(peticion.zoneId).toBe("zone-south");
  });
});
