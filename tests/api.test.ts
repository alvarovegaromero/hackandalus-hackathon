// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
//
// Cubre el comportamiento de las rutas HTTP: contrato de exito, validacion de
// entrada, codigos de estado y proteccion de las rutas de demo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as actionsPost } from "@/app/api/actions/route";
import { POST as approvePost } from "@/app/api/actions/[id]/approve/route";
import { POST as statusPost } from "@/app/api/actions/[id]/status/route";
import { POST as markPost } from "@/app/api/events/[id]/mark/route";
import { GET as eventsGet, POST as eventPost } from "@/app/api/events/route";
import { POST as injectPost } from "@/app/api/demo/inject/route";
import { POST as resetPost } from "@/app/api/demo/reset/route";
import { GET as situationGet } from "@/app/api/situation/route";
import { getSituation, resetSituation } from "@/lib/store";

/** Peticion JSON con las cabeceras que enviaria la interfaz. */
function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "mock";
  process.env.HAPPYROBOT_WEBHOOK_SECRET = "";
  delete process.env.DEMO_API_TOKEN;
  resetSituation();
});

afterEach(() => {
  delete process.env.DEMO_API_TOKEN;
});

describe("crisis API routes", () => {
  it("creates an event and updates the situation", async () => {
    const response = await eventPost(
      jsonRequest("http://localhost/api/events", {
        zoneId: "zone-south",
        category: "shelter-overflow",
        severity: "critical",
        confidence: "high",
      }),
    );

    expect(response.status).toBe(201);
    const situationResponse = await situationGet();
    const situation = await situationResponse.json();
    expect(situation.events[0].category).toBe("shelter-overflow");
    expect(situation.plan.priorities[0].zoneId).toBe("zone-south");
  });

  it("approves an action through the mock HappyRobot adapter", async () => {
    const action = getSituation().actions[0];
    const response = await approvePost(new Request("http://localhost"), {
      params: Promise.resolve({ id: action.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("succeeded");
    expect(body.action.externalActionId).toContain("mock-");
  });

  it("surfaces HappyRobot execution failures", async () => {
    process.env.ACTION_EXECUTION_MODE = "happyrobot";
    delete process.env.HAPPYROBOT_API_KEY;
    delete process.env.HAPPYROBOT_AGENT_ID;

    const action = getSituation().actions[0];
    const response = await approvePost(new Request("http://localhost"), {
      params: Promise.resolve({ id: action.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("failed");
    expect(body.action.error).toContain("HappyRobot credentials are missing");
  });

  it("accepts operator-driven status changes", async () => {
    // Esta ruta es de interfaz: el callback externo de HappyRobot vive en
    // /api/webhooks/happyrobot y no pasa por aqui.
    const action = getSituation().actions[0];
    const response = await statusPost(
      jsonRequest("http://localhost", {
        status: "running",
        externalActionId: "hr-123",
        localActionId: action.id,
      }),
      { params: Promise.resolve({ id: action.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("running");
    expect(body.action.externalActionId).toBe("hr-123");
  });
});

describe("validacion de entrada", () => {
  it("rechaza un JSON malformado con 400 en vez de reventar con 500", async () => {
    const response = await eventPost(
      jsonRequest("http://localhost/api/events", "{ esto no es json"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("json_invalido");
    expect(typeof body.error).toBe("string");
  });

  it("rechaza una zona inexistente en vez de aceptar una señal huérfana", async () => {
    const before = getSituation().events.length;
    const response = await eventPost(
      jsonRequest("http://localhost/api/events", {
        zoneId: "zone-nope",
        category: "incendio",
        severity: "critical",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("referencia_desconocida");
    expect(body.detalles[0].campo).toBe("zoneId");
    expect(getSituation().events.length).toBe(before);
  });

  it("rechaza valores fuera del enumerado y campos desconocidos", async () => {
    const response = await eventPost(
      jsonRequest("http://localhost/api/events", {
        zoneId: "zone-south",
        severity: "apocaliptica",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("cuerpo_invalido");

    const typo = await eventPost(
      jsonRequest("http://localhost/api/events", { zoneid: "zone-south" }),
    );
    expect(typo.status).toBe(400);
  });

  it("rechaza un cuerpo vacío donde hacen falta campos", async () => {
    const response = await eventPost(jsonRequest("http://localhost/api/events", {}));
    expect(response.status).toBe(400);

    const mark = await markPost(jsonRequest("http://localhost", ""), {
      params: Promise.resolve({ id: getSituation().events[0].id }),
    });
    expect(mark.status).toBe(400);
    expect((await mark.json()).code).toBe("cuerpo_vacio");
  });

  it("rechaza un Content-Type que no es JSON y un cuerpo desmesurado", async () => {
    const tipo = await eventPost(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "zoneId=zone-south",
      }),
    );
    expect(tipo.status).toBe(415);

    const gigante = await eventPost(
      jsonRequest("http://localhost/api/events", {
        zoneId: "zone-south",
        description: "x".repeat(40_000),
      }),
    );
    expect(gigante.status).toBe(413);
  });

  it("valida el cuerpo de la creación manual de acciones", async () => {
    const incompleta = await actionsPost(
      jsonRequest("http://localhost/api/actions", { channel: "call" }),
    );
    expect(incompleta.status).toBe(400);

    const recursoFantasma = await actionsPost(
      jsonRequest("http://localhost/api/actions", {
        channel: "call",
        target: "Coordinadora de campo",
        objective: "Confirmar evacuación",
        reason: "Zona crítica",
        zoneId: "zone-south",
        resourceId: "res-nope",
      }),
    );
    expect(recursoFantasma.status).toBe(400);
    expect((await recursoFantasma.json()).detalles[0].campo).toBe("resourceId");

    const valida = await actionsPost(
      jsonRequest("http://localhost/api/actions", {
        channel: "call",
        target: "Coordinadora de campo",
        objective: "Confirmar evacuación",
        reason: "Zona crítica",
        zoneId: "zone-south",
      }),
    );
    expect(valida.status).toBe(201);
  });

  it("distingue 404 de 400 y responde 405 a un método no permitido", async () => {
    const inexistente = await statusPost(jsonRequest("http://localhost", { operation: "cancel" }), {
      params: Promise.resolve({ id: "act-no-existe" }),
    });
    expect(inexistente.status).toBe(404);
    expect((await inexistente.json()).code).toBe("no_encontrado");

    const metodo = await eventsGet();
    expect(metodo.status).toBe(405);
    expect(metodo.headers.get("allow")).toBe("POST");
  });
});

describe("operaciones de interfaz sobre acciones", () => {
  it("cancela y reintenta aunque HAPPYROBOT_WEBHOOK_SECRET esté definido", async () => {
    // Regresion: antes esta ruta exigia el secreto del webhook y los botones de
    // la interfaz devolvian 401 en cuanto se configuraba la integracion.
    process.env.HAPPYROBOT_WEBHOOK_SECRET = "secreto-de-demo";
    const action = getSituation().actions[0];

    const cancel = await statusPost(jsonRequest("http://localhost", { operation: "cancel" }), {
      params: Promise.resolve({ id: action.id }),
    });
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).action.status).toBe("cancelled");

    const retry = await statusPost(jsonRequest("http://localhost", { operation: "retry" }), {
      params: Promise.resolve({ id: action.id }),
    });
    expect(retry.status).toBe(200);
    const reintentada = (await retry.json()).action;
    expect(reintentada.status).toBe("pending");
    expect(reintentada.attempt).toBe(2);
  });

  it("responde 409 cuando la operación no encaja con el estado actual", async () => {
    const action = getSituation().actions[0];
    await approvePost(new Request("http://localhost"), {
      params: Promise.resolve({ id: action.id }),
    });

    const cancel = await statusPost(jsonRequest("http://localhost", { operation: "cancel" }), {
      params: Promise.resolve({ id: action.id }),
    });
    expect(cancel.status).toBe(409);
    expect((await cancel.json()).code).toBe("conflicto");
  });
});

describe("proteccion de las rutas de demo", () => {
  it("funciona sin fricción en desarrollo cuando no hay token configurado", async () => {
    const inject = await injectPost(
      jsonRequest("http://localhost/api/demo/inject", { kind: "incident" }),
    );
    expect(inject.status).toBe(200);

    const reset = await resetPost(jsonRequest("http://localhost/api/demo/reset", {}));
    expect(reset.status).toBe(200);
  });

  it("exige el token cuando DEMO_API_TOKEN está configurado", async () => {
    process.env.DEMO_API_TOKEN = "token-de-demo";

    const sinToken = await injectPost(
      jsonRequest("http://localhost/api/demo/inject", { kind: "incident" }),
    );
    expect(sinToken.status).toBe(401);
    expect((await sinToken.json()).code).toBe("no_autorizado");

    const resetSinToken = await resetPost(jsonRequest("http://localhost/api/demo/reset", {}));
    expect(resetSinToken.status).toBe(401);

    const conToken = await injectPost(
      jsonRequest(
        "http://localhost/api/demo/inject",
        { kind: "incident" },
        { "x-demo-token": "token-de-demo" },
      ),
    );
    expect(conToken.status).toBe(200);
  });

  it("desactiva las rutas de demo en producción si no hay token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await resetPost(jsonRequest("http://localhost/api/demo/reset", {}));
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("no_autorizado");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rechaza una avería de demo desconocida", async () => {
    const response = await injectPost(
      jsonRequest("http://localhost/api/demo/inject", { kind: "terremoto" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("cuerpo_invalido");
  });
});
