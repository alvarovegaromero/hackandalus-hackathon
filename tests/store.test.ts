// OWNER: coordination (not edited by module agents).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The adapter is mocked to control the exact moment when
// the external executor responds. Everything else in the module remains real.
const externo = vi.hoisted(() => ({
  impl: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock("@/lib/happyrobot", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/happyrobot")>();
  return {
    ...real,
    executeHappyRobotAction: (...args: unknown[]) =>
      externo.impl
        ? externo.impl(...args)
        : Promise.resolve({ externalActionId: "mock-test", mode: "mock", simulated: true }),
  };
});

const {
  addEvent,
  approveAction,
  cancelAction,
  getSituation,
  injectDemo,
  markEvent,
  pollSituation,
  resetSituation,
  retryAction,
  updateResource,
} = await import("@/lib/store");

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "mock";
  externo.impl = null;
  resetSituation();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discarding a signal undoes its effect", () => {
  it("reverts risk, status, and need, and cancels the motivating action", () => {
    const antes = getSituation().zones.find((zona) => zona.id === "zone-east")!;

    const { event } = addEvent({
      zoneId: "zone-east",
      category: "rumor",
      severity: "critical",
      confidence: "low",
    });

    const durante = getSituation().zones.find((zona) => zona.id === "zone-east")!;
    expect(durante.riskScore).toBeGreaterThan(antes.riskScore);
    expect(durante.status).toBe("critical");
    expect(durante.needs).toContain("rumor");

    markEvent(event.id, false);

    const despues = getSituation();
    const zona = despues.zones.find((candidata) => candidata.id === "zone-east")!;
    expect(zona.riskScore).toBe(antes.riskScore);
    expect(zona.status).toBe(antes.status);
    expect(zona.needs).not.toContain("rumor");

    const accion = despues.actions.find(
      (candidata) => candidata.zoneId === "zone-east" && candidata.objective.includes("rumor"),
    );
    expect(accion?.status).toBe("cancelled");
  });

  it("does not drag down need from another live signal requesting the same", () => {
    const primera = addEvent({
      zoneId: "zone-south",
      category: "refugio",
      severity: "high",
      confidence: "high",
    });
    addEvent({
      zoneId: "zone-south",
      category: "refugio",
      severity: "critical",
      confidence: "high",
    });

    markEvent(primera.event.id, false);

    const zona = getSituation().zones.find((candidata) => candidata.id === "zone-south")!;
    expect(zona.needs).toContain("refugio");
  });

  it("reapplies effect if signal is confirmed after being discarded", () => {
    const { event } = addEvent({
      zoneId: "zone-east",
      category: "rumor",
      severity: "high",
      confidence: "medium",
    });
    const conSenal = getSituation().zones.find((zona) => zona.id === "zone-east")!.riskScore;

    markEvent(event.id, false);
    const revertido = getSituation().zones.find((zona) => zona.id === "zone-east")!.riskScore;
    expect(revertido).toBeLessThan(conSenal);

    markEvent(event.id, true);
    const reaplicado = getSituation().zones.find((zona) => zona.id === "zone-east")!.riskScore;
    expect(reaplicado).toBe(conSenal);
  });
});

describe("a delayed response cannot overwrite an operator decision", () => {
  it("maintains cancellation even if external executor responds later", async () => {
    process.env.ACTION_EXECUTION_MODE = "happyrobot";
    let resolver: (valor: unknown) => void = () => undefined;
    externo.impl = () => new Promise((resolve) => (resolver = resolve));

    const accion = getSituation().actions[0];
    const enVuelo = approveAction(accion.id);
    await Promise.resolve();

    expect(getSituation().actions.find((c) => c.id === accion.id)?.status).toBe("running");

    cancelAction(accion.id);
    expect(getSituation().actions.find((c) => c.id === accion.id)?.status).toBe("cancelled");

    resolver({ externalActionId: "hr-tardio", mode: "happyrobot", simulated: false });
    await enVuelo;

    const final = getSituation().actions.find((c) => c.id === accion.id);
    expect(final?.status).toBe("cancelled");
    expect(final?.externalActionId).not.toBe("hr-tardio");
  });

  it("discards delayed response from previous attempt after a retry", async () => {
    process.env.ACTION_EXECUTION_MODE = "happyrobot";
    let resolver: (valor: unknown) => void = () => undefined;
    externo.impl = () => new Promise((resolve) => (resolver = resolve));

    const accion = getSituation().actions[0];
    const enVuelo = approveAction(accion.id);
    await Promise.resolve();

    retryAction(accion.id);
    const trasReintento = getSituation().actions.find((c) => c.id === accion.id);
    expect(trasReintento?.status).toBe("pending");
    expect(trasReintento?.attempt).toBe(2);

    resolver({ externalActionId: "hr-viejo", mode: "happyrobot", simulated: false });
    await enVuelo;

    expect(getSituation().actions.find((c) => c.id === accion.id)?.status).toBe("pending");
  });
});

describe("unresponsive actions", () => {
  it("transition to an explicit state and release their resource instead of remaining in progress", async () => {
    process.env.ACTION_EXECUTION_MODE = "happyrobot";
    externo.impl = () => new Promise(() => undefined);

    const accion = getSituation().actions[0];
    void approveAction(accion.id);
    await Promise.resolve();

    expect(getSituation().actions.find((c) => c.id === accion.id)?.status).toBe("running");

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    const situacion = pollSituation();

    const atascada = situacion.actions.find((c) => c.id === accion.id);
    expect(atascada?.status).toBe("stalled");
    expect(atascada?.error).toContain("Sin respuesta");

    const recurso = situacion.resources.find((r) => r.id === accion.resourceId);
    expect(recurso?.assignedActionId).toBeNull();
  });
});

describe("approving an action without available resource", () => {
  it("blocks it and does not call external executor", async () => {
    const llamadas: unknown[] = [];
    externo.impl = (...args) => {
      llamadas.push(args);
      return Promise.resolve({
        externalActionId: "no-deberia-pasar",
        mode: "mock",
        simulated: true,
      });
    };

    const accion = getSituation().actions[0];
    updateResource(accion.resourceId!, "unavailable");

    const resultado = await approveAction(accion.id);

    expect(resultado.status).toBe("blocked");
    expect(resultado.error).toContain("no está disponible");
    expect(llamadas).toHaveLength(0);
  });
});

describe("demo injectors", () => {
  it("resource outage invalidates actions depending on it", () => {
    const antes = getSituation();
    const accionSemilla = antes.actions[0];

    const despues = injectDemo("resource-down");

    expect(despues.plan.version).toBeGreaterThan(antes.plan.version);
    expect(despues.resources.some((r) => r.status === "unavailable")).toBe(true);

    const invalidadas = despues.plan.invalidatedActionIds;
    expect(invalidadas).toContain(accionSemilla.id);
  });

  it("integration failure does not mark an already completed action as failed", async () => {
    const accion = getSituation().actions[0];
    const completada = await approveAction(accion.id);
    expect(completada.status).toBe("succeeded");

    injectDemo("integration-failure");

    const despues = getSituation().actions.find((c) => c.id === accion.id);
    expect(despues?.status).toBe("succeeded");
  });
});

describe("idempotency and deduplication", () => {
  it("each retry gets a new idempotency key", () => {
    const accion = getSituation().actions[0];
    expect(accion.idempotencyKey).toBe(`${accion.id}:1`);

    const reintentada = retryAction(accion.id);
    expect(reintentada.attempt).toBe(2);
    expect(reintentada.idempotencyKey).toBe(`${accion.id}:2`);
    expect(reintentada.externalActionId).toBeUndefined();
  });

  it("a repeated signal fuses and increments occurrences", () => {
    const primera = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "medium",
    });
    const segunda = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "high",
    });

    expect(primera.duplicate).toBe(false);
    expect(segunda.duplicate).toBe(true);
    expect(segunda.event.occurrences).toBe(2);
  });

  it("a discarded signal does not absorb new identical signals", () => {
    const primera = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "medium",
    });
    markEvent(primera.event.id, false);

    const segunda = addEvent({
      zoneId: "zone-east",
      category: "route-blocked",
      severity: "high",
      confidence: "high",
    });
    expect(segunda.duplicate).toBe(false);
  });
});
