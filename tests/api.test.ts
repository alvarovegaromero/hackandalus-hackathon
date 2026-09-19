// OWNER: API hardening and input validation agent.
//
// Covers HTTP route behavior: success contract, input validation,
// status codes, and demo route protection.

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

/** JSON request with headers that the UI would send. */
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
    // This route is for the UI: the external HappyRobot callback lives in
    // /api/webhooks/happyrobot and does not pass through here.
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

describe("input validation", () => {
  it("rejects malformed JSON with 400 instead of crashing with 500", async () => {
    const response = await eventPost(
      jsonRequest("http://localhost/api/events", "{ esto no es json"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("json_invalido");
    expect(typeof body.error).toBe("string");
  });

  it("rejects non-existent zone instead of accepting orphaned signal", async () => {
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

  it("rejects values outside enum and unknown fields", async () => {
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

  it("rejects an empty body when fields are required", async () => {
    const response = await eventPost(jsonRequest("http://localhost/api/events", {}));
    expect(response.status).toBe(400);

    const mark = await markPost(jsonRequest("http://localhost", ""), {
      params: Promise.resolve({ id: getSituation().events[0].id }),
    });
    expect(mark.status).toBe(400);
    expect((await mark.json()).code).toBe("cuerpo_vacio");
  });

  it("rejects non-JSON Content-Type and oversized body", async () => {
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

  it("validates body for manual action creation", async () => {
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

  it("distinguishes 404 from 400 and responds 405 to disallowed method", async () => {
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

describe("UI operations on actions", () => {
  it("cancels and retries even when HAPPYROBOT_WEBHOOK_SECRET is defined", async () => {
    // Regression: previously this route required the webhook secret and UI
    // buttons returned 401 as soon as the integration was configured.
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

  it("responds 409 when operation does not match current state", async () => {
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

describe("demo route protection", () => {
  it("works without friction in development when no token is configured", async () => {
    const inject = await injectPost(
      jsonRequest("http://localhost/api/demo/inject", { kind: "incident" }),
    );
    expect(inject.status).toBe(200);

    const reset = await resetPost(jsonRequest("http://localhost/api/demo/reset", {}));
    expect(reset.status).toBe(200);
  });

  it("requires token when DEMO_API_TOKEN is configured", async () => {
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

  it("disables demo routes in production if no token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await resetPost(jsonRequest("http://localhost/api/demo/reset", {}));
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("no_autorizado");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects unknown demo fault", async () => {
    const response = await injectPost(
      jsonRequest("http://localhost/api/demo/inject", { kind: "terremoto" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("cuerpo_invalido");
  });
});
