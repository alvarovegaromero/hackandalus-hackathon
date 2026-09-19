// OWNER: resource allocation agent.

import { describe, expect, it } from "vitest";
import {
  assignResource,
  reassignAffectedActions,
  rankResourcesForAction,
  releaseResource,
  resolveResourceConflicts,
  selectResourceForAction,
} from "@/lib/resources";
import { seedResources, seedZones } from "@/lib/seed";
import type { Action, ActionChannel, Resource } from "@/lib/types";

const zones = structuredClone(seedZones);

/** Clean copy of seed resources for each test. */
function recursos(): Resource[] {
  return structuredClone(seedResources);
}

let contador = 0;

/** Minimal test action; only fields inspected by resource engine are populated. */
function accion(overrides: Partial<Action> & Pick<Action, "zoneId" | "objective">): Action {
  contador += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, contador)).toISOString();
  const id = overrides.id ?? `act-test-${contador}`;
  const channel: ActionChannel = overrides.channel ?? "call";
  return {
    id,
    channel,
    target: "Destinatario de prueba",
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

describe("resource selection", () => {
  it("prefers correct capability over closest resource", () => {
    // In Sierra Morena the home resource is the INFOCA crew, but what is
    // requested is medical triage: crew cannot do it and is discarded.
    const decision = selectResourceForAction(
      { zoneId: "zone-north", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones,
    );

    expect(decision).not.toBeNull();
    expect(decision!.resourceId).toBe("res-med-1");
    expect(decision!.reason).toContain("INFOCA Sierra Bravo está más cerca pero no cubre triaje");
    expect(decision!.reason).toContain("Puntuación");
  });

  it("with equal capability selects the closest to the zone", () => {
    // Two equivalent medical units: the one already in the zone wins.
    const decision = selectResourceForAction(
      { zoneId: "zone-east", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones,
    );

    expect(decision!.resourceId).toBe("res-med-2");
    expect(decision!.reason).toContain("ya está desplegado en la propia zona");

    const ranking = rankResourcesForAction(
      { zoneId: "zone-east", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones,
    );
    const granada = ranking.find((candidato) => candidato.resource.id === "res-med-2")!;
    const sevilla = ranking.find((candidato) => candidato.resource.id === "res-med-1")!;
    expect(granada.score).toBeGreaterThan(sevilla.score);
  });

  it("returns null when no resource covers the need", () => {
    // Without INFOCA crew nobody can extinguish: there is no ideal or
    // approximate resource, and the engine states so instead of dispatching anyone.
    const sinBrigada = recursos().filter((resource) => resource.id !== "res-field-1");
    const decision = selectResourceForAction(
      { zoneId: "zone-north", objective: "incendio forestal activo", channel: "call" },
      sinBrigada,
      zones,
    );

    expect(decision).toBeNull();
  });

  it("never selects an out-of-service resource", () => {
    const pool = recursos();
    for (const resource of pool) {
      if (resource.id !== "res-med-2") resource.status = "unavailable";
    }

    const decision = selectResourceForAction(
      { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
      pool,
      zones,
    );
    expect(decision!.resourceId).toBe("res-med-2");

    // And if the last medical unit also drops, no choice is possible.
    pool.find((resource) => resource.id === "res-med-2")!.status = "unavailable";
    expect(
      selectResourceForAction(
        { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
        pool,
        zones,
      ),
    ).toBeNull();
  });

  it("when Seville medical unit drops does not dispatch Sierra Morena crew", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const decision = selectResourceForAction(
      { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
      pool,
      zones,
    );

    expect(decision!.resourceId).not.toBe("res-field-1");
    expect(decision!.resourceId).toBe("res-med-2");
  });
});

describe("resource status", () => {
  it("assigns and releases resource upon action completion", () => {
    const pool = recursos();
    const asignado = assignResource(pool, "res-med-1", "act-1", "2026-01-01T00:00:00.000Z");

    expect(asignado!.status).toBe("assigned");
    expect(pool.find((resource) => resource.id === "res-med-1")!.assignedActionId).toBe("act-1");

    const liberado = releaseResource(pool, "act-1");
    expect(liberado!.status).toBe("available");
    expect(liberado!.assignedActionId).toBeNull();
    expect(liberado!.assignedAt).toBeNull();
  });

  it("does not assign an out-of-service resource", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    expect(assignResource(pool, "res-med-1", "act-1", "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(pool.find((resource) => resource.id === "res-med-1")!.assignedActionId).toBeNull();
  });
});

describe("resource outage", () => {
  it("searches replacement for actions depending on downed resource", () => {
    const pool = recursos();
    const caido = pool.find((resource) => resource.id === "res-med-1")!;
    caido.status = "unavailable";
    caido.assignedActionId = null;

    const acciones = [
      accion({
        id: "act-triaje",
        zoneId: "zone-central",
        objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
        status: "blocked",
        resourceId: "res-med-1",
      }),
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-med-1");

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      actionId: "act-triaje",
      fromResourceId: "res-med-1",
      toResourceId: "res-med-2",
    });
    expect(movimientos[0].reason).toContain("Sustitución tras la caída de EPES Sevilla Alpha");
  });

  it("leaves replacement as null when none is possible", () => {
    const pool = recursos();
    const caido = pool.find((resource) => resource.id === "res-field-1")!;
    caido.status = "unavailable";
    caido.assignedActionId = null;

    const acciones = [
      accion({
        id: "act-extincion",
        zoneId: "zone-north",
        objective: "Coordinar respuesta de incendio en Sierra Morena.",
        status: "blocked",
        resourceId: "res-field-1",
      }),
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-field-1");

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].toResourceId).toBeNull();
    expect(movimientos[0].reason).toContain("Sin sustituto");
    expect(movimientos[0].reason).toContain("apoyo externo");
  });

  it("allocates the only replacement to most urgent zone and explains who is left without one", () => {
    const pool = recursos();
    const caido = pool.find((resource) => resource.id === "res-med-1")!;
    caido.status = "unavailable";
    caido.assignedActionId = null;

    const acciones = [
      accion({
        id: "act-este",
        zoneId: "zone-east",
        objective: "Coordinar respuesta de triaje sanitario en Granada y Almeria.",
        status: "blocked",
        resourceId: "res-med-1",
      }),
      accion({
        id: "act-centro",
        zoneId: "zone-central",
        objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
        status: "blocked",
        resourceId: "res-med-1",
      }),
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-med-1");
    const centro = movimientos.find((movimiento) => movimiento.actionId === "act-centro")!;
    const este = movimientos.find((movimiento) => movimiento.actionId === "act-este")!;

    // Seville Hub is active and has more population: gets the only medical
    // replacement, and Granada is left without, explicitly stated.
    expect(centro.toResourceId).toBe("res-med-2");
    expect(este.toResourceId).toBeNull();
    expect(este.reason).toContain("Sin sustituto");
  });

  it("does not touch already closed actions", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = [
      accion({
        id: "act-cerrada",
        zoneId: "zone-central",
        objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
        status: "succeeded",
        resourceId: "res-med-1",
      }),
    ];

    expect(reassignAffectedActions(acciones, pool, zones, "res-med-1")).toHaveLength(0);
  });
});

describe("contention between zones for the same resource", () => {
  it("allocates scarce resource by urgency and places the rest on waiting list", () => {
    const pool = recursos();
    // Only one medical unit remains in the entire deployment.
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = [
      accion({
        id: "act-este",
        zoneId: "zone-east",
        objective: "Montar triaje sanitario en Granada y Almeria.",
        status: "pending",
      }),
      accion({
        id: "act-centro",
        zoneId: "zone-central",
        objective: "Montar triaje sanitario en Sevilla Hub.",
        status: "pending",
      }),
    ];

    const reparto = resolveResourceConflicts(acciones, pool, zones);

    expect(reparto.allocations).toHaveLength(1);
    expect(reparto.allocations[0]).toMatchObject({
      actionId: "act-centro",
      resourceId: "res-med-2",
    });
    expect(reparto.waiting).toHaveLength(1);
    expect(reparto.waiting[0].actionId).toBe("act-este");
    expect(reparto.waiting[0].blockedByActionId).toBe("act-centro");
    expect(reparto.waiting[0].reason).toContain("EPES Granada Delta");
    expect(reparto.waiting[0].reason).toContain("espera");
    expect(reparto.summary).toContain("en espera");
  });

  it("leaves no one waiting when each need has a resource", () => {
    const acciones = [
      accion({
        id: "act-fuego",
        zoneId: "zone-north",
        objective: "Extinción del incendio en Sierra Morena.",
      }),
      accion({
        id: "act-triaje",
        zoneId: "zone-central",
        objective: "Montar triaje sanitario en Sevilla Hub.",
      }),
      accion({
        id: "act-refugio",
        zoneId: "zone-south",
        objective: "Abrir refugio en la Costa del Sol.",
      }),
    ];

    const reparto = resolveResourceConflicts(acciones, recursos(), zones);

    expect(reparto.waiting).toHaveLength(0);
    expect(reparto.allocations.map((item) => item.resourceId).sort()).toEqual([
      "res-field-1",
      "res-med-1",
      "res-transport-1",
    ]);
    expect(reparto.summary).toContain("nadie queda en espera");
  });

  it("reports the most contested resource in summary", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = ["zone-east", "zone-central", "zone-south"].map((zoneId, indice) =>
      accion({ id: `act-${indice}`, zoneId, objective: "Montar triaje sanitario." }),
    );

    const reparto = resolveResourceConflicts(acciones, pool, zones);

    expect(reparto.waiting).toHaveLength(2);
    expect(reparto.summary).toContain("EPES Granada Delta");
  });
});
