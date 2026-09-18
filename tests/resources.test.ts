import { describe, expect, it } from "vitest";
import {
  assignResource,
  reassignAffectedActions,
  rankResourcesForAction,
  releaseResource,
  resolveResourceConflicts,
  selectResourceForAction
} from "@/lib/resources";
import { seedResources, seedZones } from "@/lib/seed";
import type { Action, ActionChannel, Resource } from "@/lib/types";

const zones = structuredClone(seedZones);

/** Copia limpia de los recursos semilla para cada prueba. */
function recursos(): Resource[] {
  return structuredClone(seedResources);
}

let contador = 0;

/** Accion minima de prueba; solo se rellena lo que mira el motor de recursos. */
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
    ...overrides
  };
}

describe("seleccion de recurso", () => {
  it("prefiere la capacidad correcta antes que el recurso mas cercano", () => {
    // En Sierra Morena el recurso de casa es la brigada INFOCA, pero lo que se
    // pide es triaje sanitario: la brigada no sabe hacerlo y queda descartada.
    const decision = selectResourceForAction(
      { zoneId: "zone-north", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones
    );

    expect(decision).not.toBeNull();
    expect(decision!.resourceId).toBe("res-med-1");
    expect(decision!.reason).toContain("INFOCA Sierra Bravo está más cerca pero no cubre triaje");
    expect(decision!.reason).toContain("Puntuación");
  });

  it("a igualdad de capacidad elige el mas cercano a la zona", () => {
    // Dos unidades sanitarias equivalentes: gana la que ya esta en la zona.
    const decision = selectResourceForAction(
      { zoneId: "zone-east", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones
    );

    expect(decision!.resourceId).toBe("res-med-2");
    expect(decision!.reason).toContain("ya está desplegado en la propia zona");

    const ranking = rankResourcesForAction(
      { zoneId: "zone-east", objective: "triaje sanitario", channel: "call" },
      recursos(),
      zones
    );
    const granada = ranking.find((candidato) => candidato.resource.id === "res-med-2")!;
    const sevilla = ranking.find((candidato) => candidato.resource.id === "res-med-1")!;
    expect(granada.score).toBeGreaterThan(sevilla.score);
  });

  it("devuelve null cuando ningun recurso cubre la necesidad", () => {
    // Sin la brigada INFOCA nadie sabe extinguir: no hay recurso ideal ni
    // aproximado, y el motor lo dice en vez de mandar a cualquiera.
    const sinBrigada = recursos().filter((resource) => resource.id !== "res-field-1");
    const decision = selectResourceForAction(
      { zoneId: "zone-north", objective: "incendio forestal activo", channel: "call" },
      sinBrigada,
      zones
    );

    expect(decision).toBeNull();
  });

  it("nunca elige un recurso fuera de servicio", () => {
    const pool = recursos();
    for (const resource of pool) {
      if (resource.id !== "res-med-2") resource.status = "unavailable";
    }

    const decision = selectResourceForAction(
      { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
      pool,
      zones
    );
    expect(decision!.resourceId).toBe("res-med-2");

    // Y si tambien cae la ultima unidad sanitaria, no hay eleccion posible.
    pool.find((resource) => resource.id === "res-med-2")!.status = "unavailable";
    expect(
      selectResourceForAction(
        { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
        pool,
        zones
      )
    ).toBeNull();
  });

  it("cuando cae la unidad sanitaria de Sevilla no manda a la brigada de Sierra Morena", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const decision = selectResourceForAction(
      { zoneId: "zone-central", objective: "triaje sanitario", channel: "call" },
      pool,
      zones
    );

    expect(decision!.resourceId).not.toBe("res-field-1");
    expect(decision!.resourceId).toBe("res-med-2");
  });
});

describe("estado de los recursos", () => {
  it("asigna y libera el recurso al terminar la accion", () => {
    const pool = recursos();
    const asignado = assignResource(pool, "res-med-1", "act-1", "2026-01-01T00:00:00.000Z");

    expect(asignado!.status).toBe("assigned");
    expect(pool.find((resource) => resource.id === "res-med-1")!.assignedActionId).toBe("act-1");

    const liberado = releaseResource(pool, "act-1");
    expect(liberado!.status).toBe("available");
    expect(liberado!.assignedActionId).toBeNull();
    expect(liberado!.assignedAt).toBeNull();
  });

  it("no asigna un recurso fuera de servicio", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    expect(assignResource(pool, "res-med-1", "act-1", "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(pool.find((resource) => resource.id === "res-med-1")!.assignedActionId).toBeNull();
  });
});

describe("caida de un recurso", () => {
  it("busca sustituto para las acciones que dependian del recurso caido", () => {
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
        resourceId: "res-med-1"
      })
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-med-1");

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      actionId: "act-triaje",
      fromResourceId: "res-med-1",
      toResourceId: "res-med-2"
    });
    expect(movimientos[0].reason).toContain("Sustitución tras la caída de EPES Sevilla Alpha");
  });

  it("deja el sustituto a null cuando no hay ninguno posible", () => {
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
        resourceId: "res-field-1"
      })
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-field-1");

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].toResourceId).toBeNull();
    expect(movimientos[0].reason).toContain("Sin sustituto");
    expect(movimientos[0].reason).toContain("apoyo externo");
  });

  it("da el unico sustituto a la zona mas urgente y explica quien se queda sin el", () => {
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
        resourceId: "res-med-1"
      }),
      accion({
        id: "act-centro",
        zoneId: "zone-central",
        objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
        status: "blocked",
        resourceId: "res-med-1"
      })
    ];

    const movimientos = reassignAffectedActions(acciones, pool, zones, "res-med-1");
    const centro = movimientos.find((movimiento) => movimiento.actionId === "act-centro")!;
    const este = movimientos.find((movimiento) => movimiento.actionId === "act-este")!;

    // Sevilla Hub esta en estado activo y con mas poblacion: se lleva el unico
    // sustituto sanitario y Granada se queda sin el, dicho explicitamente.
    expect(centro.toResourceId).toBe("res-med-2");
    expect(este.toResourceId).toBeNull();
    expect(este.reason).toContain("Sin sustituto");
  });

  it("no toca las acciones ya cerradas", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = [
      accion({
        id: "act-cerrada",
        zoneId: "zone-central",
        objective: "Coordinar respuesta de triaje sanitario en Sevilla Hub.",
        status: "succeeded",
        resourceId: "res-med-1"
      })
    ];

    expect(reassignAffectedActions(acciones, pool, zones, "res-med-1")).toHaveLength(0);
  });
});

describe("competencia entre zonas por el mismo recurso", () => {
  it("reparte el recurso escaso por urgencia y deja en espera al resto", () => {
    const pool = recursos();
    // Solo queda una unidad sanitaria en todo el dispositivo.
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = [
      accion({
        id: "act-este",
        zoneId: "zone-east",
        objective: "Montar triaje sanitario en Granada y Almeria.",
        status: "pending"
      }),
      accion({
        id: "act-centro",
        zoneId: "zone-central",
        objective: "Montar triaje sanitario en Sevilla Hub.",
        status: "pending"
      })
    ];

    const reparto = resolveResourceConflicts(acciones, pool, zones);

    expect(reparto.allocations).toHaveLength(1);
    expect(reparto.allocations[0]).toMatchObject({ actionId: "act-centro", resourceId: "res-med-2" });
    expect(reparto.waiting).toHaveLength(1);
    expect(reparto.waiting[0].actionId).toBe("act-este");
    expect(reparto.waiting[0].blockedByActionId).toBe("act-centro");
    expect(reparto.waiting[0].reason).toContain("EPES Granada Delta");
    expect(reparto.waiting[0].reason).toContain("espera");
    expect(reparto.summary).toContain("en espera");
  });

  it("no deja a nadie esperando cuando cada necesidad tiene su recurso", () => {
    const acciones = [
      accion({ id: "act-fuego", zoneId: "zone-north", objective: "Extinción del incendio en Sierra Morena." }),
      accion({ id: "act-triaje", zoneId: "zone-central", objective: "Montar triaje sanitario en Sevilla Hub." }),
      accion({ id: "act-refugio", zoneId: "zone-south", objective: "Abrir refugio en la Costa del Sol." })
    ];

    const reparto = resolveResourceConflicts(acciones, recursos(), zones);

    expect(reparto.waiting).toHaveLength(0);
    expect(reparto.allocations.map((item) => item.resourceId).sort()).toEqual([
      "res-field-1",
      "res-med-1",
      "res-transport-1"
    ]);
    expect(reparto.summary).toContain("nadie queda en espera");
  });

  it("cuenta el recurso mas disputado en el resumen", () => {
    const pool = recursos();
    pool.find((resource) => resource.id === "res-med-1")!.status = "unavailable";

    const acciones = ["zone-east", "zone-central", "zone-south"].map((zoneId, indice) =>
      accion({ id: `act-${indice}`, zoneId, objective: "Montar triaje sanitario." })
    );

    const reparto = resolveResourceConflicts(acciones, pool, zones);

    expect(reparto.waiting).toHaveLength(2);
    expect(reparto.summary).toContain("EPES Granada Delta");
  });
});
