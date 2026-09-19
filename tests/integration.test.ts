// OWNER: HappyRobot integration, contacts, and escalation agent.
//
// Coverage of the external boundary. Everything with mocked `fetch`: these
// tests must NEVER trigger a real call, message, or email.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webhookPost } from "@/app/api/webhooks/happyrobot/route";
import {
  briefingForRole,
  canReceiveLiveAction,
  rolesForCategory,
  selectChannel,
  selectContact,
} from "@/lib/contacts";
import { buildEscalationChain } from "@/lib/escalation";
import {
  HappyRobotError,
  actionEndpoint,
  buildActionPayload,
  executeHappyRobotAction,
  verifyWebhookSecret,
} from "@/lib/happyrobot";
import { getSituation, resetSituation } from "@/lib/store";
import type { Action, ActionChannel, Contact } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<Action> = {}): Action {
  const at = new Date().toISOString();
  return {
    id: "act-test-1",
    channel: "call",
    target: "Coordinacion de demo",
    objective: "Confirmar si la ruta de evacuacion sigue abierta.",
    status: "running",
    reason: "El frente giro y la ruta puede estar cortada.",
    zoneId: "zone-north",
    contactId: "con-demo",
    executionMode: "happyrobot",
    attempt: 1,
    idempotencyKey: "act-test-1:1",
    stalledAfter: null,
    approvedBy: "operator",
    approvedAt: at,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "con-demo",
    name: "Contacto de demo aprobado",
    role: "field-coordinator",
    zoneId: "zone-north",
    channels: ["call", "sms", "email"],
    phone: "+34600000000",
    email: "demo@example.org",
    demoSafe: true,
    lastContactedAt: null,
    responsiveness: 0.8,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Last request observed by mocked `fetch`. */
function lastCall(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
}

const SECRET = "secreto-de-pruebas";

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "happyrobot";
  process.env.HAPPYROBOT_API_KEY = "clave-de-pruebas";
  process.env.HAPPYROBOT_BASE_URL = "https://api.happyrobot.test";
  process.env.HAPPYROBOT_AGENT_ID = "agente-demo";
  process.env.HAPPYROBOT_WEBHOOK_SECRET = SECRET;
  // Instant retries: test checks policy, not clock.
  process.env.HAPPYROBOT_RETRY_BASE_MS = "1";
  process.env.HAPPYROBOT_MAX_ATTEMPTS = "3";
  process.env.HAPPYROBOT_TIMEOUT_MS = "8000";
  delete process.env.HAPPYROBOT_ACTION_PATH;
  delete process.env.HAPPYROBOT_AUTH_HEADER;
  delete process.env.HAPPYROBOT_AUTH_SCHEME;
  delete process.env.HAPPYROBOT_PAYLOAD_SHAPE;
  resetSituation();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Adapter: safeguards
// ---------------------------------------------------------------------------

describe("HappyRobot adapter: safeguards", () => {
  it("in mock mode nothing leaves the process and is labeled as simulated", async () => {
    process.env.ACTION_EXECUTION_MODE = "mock";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(makeAction(), makeContact());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
    expect(result.simulated).toBe(true);
    expect(result.externalActionId).toContain("mock-");
    expect(result.detail).toMatch(/simulad/i);
  });

  it("fails explicitly when credentials are missing, without calling anyone", async () => {
    delete process.env.HAPPYROBOT_API_KEY;
    delete process.env.HAPPYROBOT_AGENT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeHappyRobotAction(makeAction(), makeContact())).rejects.toMatchObject({
      kind: "missing-credentials",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downgrades to simulation if contact is not demo-safe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(
      makeAction(),
      makeContact({ demoSafe: false, name: "Contacto real no aprobado" }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
    expect(result.simulated).toBe(true);
    expect(result.externalActionId).toContain("mock-");
    expect(result.detail).toContain("demoSafe");
  });

  it("downgrades to simulation if approved contact has no phone or email", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(
      makeAction(),
      makeContact({ phone: null, email: null }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.simulated).toBe(true);
  });

  it("downgrades to simulation when action does not identify any contact", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Without explicit contact it searches live state; ID does not exist, so
    // safeguard prevents external dispatch.
    const result = await executeHappyRobotAction(makeAction({ contactId: "con-inexistente" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
  });

  it("seed contacts cannot receive live execution", () => {
    for (const contact of getSituation().contacts) {
      expect(canReceiveLiveAction(contact)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Adapter: transport
// ---------------------------------------------------------------------------

describe("HappyRobot adapter: transport", () => {
  it("sends action with action's own idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "hr-externo-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const action = makeAction({ attempt: 2, idempotencyKey: "act-test-1:2" });
    const result = await executeHappyRobotAction(action, makeContact());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://api.happyrobot.test/agents/agente-demo/actions");
    expect(headers["idempotency-key"]).toBe("act-test-1:2");
    expect(headers.authorization).toBe("Bearer clave-de-pruebas");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    expect(body.channel).toBe("voice");
    expect(metadata.localActionId).toBe("act-test-1");
    expect(metadata.idempotencyKey).toBe("act-test-1:2");
    expect(result.mode).toBe("happyrobot");
    expect(result.simulated).toBe(false);
    expect(result.externalActionId).toBe("hr-externo-1");
  });

  it("does not retry a 4xx", async () => {
    // Each attempt needs its own Response: an already consumed body cannot
    // be read again, which would mask the real code.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse(422, { error: "payload invalido" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeHappyRobotAction(makeAction(), makeContact()).catch((err) => err);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(HappyRobotError);
    expect((error as HappyRobotError).kind).toBe("client-error");
    expect((error as HappyRobotError).status).toBe(422);
  });

  it("retries a 5xx with backoff and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "no disponible" }))
      .mockResolvedValueOnce(jsonResponse(500, { error: "interno" }))
      .mockResolvedValueOnce(jsonResponse(200, { actionId: "hr-externo-2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHappyRobotAction(makeAction(), makeContact());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.externalActionId).toBe("hr-externo-2");
    // All internal retries share key: HappyRobot can deduplicate them and
    // recipient does not get three calls.
    const claves = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(new Set(claves.map((header) => header["idempotency-key"])).size).toBe(1);
  });

  it("exhausts 5xx retries and propagates service failure", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(500, { error: "interno" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeHappyRobotAction(makeAction(), makeContact()).catch((err) => err);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((error as HappyRobotError).kind).toBe("server-error");
  });

  it("times out instead of leaving command center hanging", async () => {
    process.env.HAPPYROBOT_TIMEOUT_MS = "20";
    process.env.HAPPYROBOT_MAX_ATTEMPTS = "1";
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeHappyRobotAction(makeAction(), makeContact()).catch((err) => err);

    expect((error as HappyRobotError).kind).toBe("timeout");
    expect((error as HappyRobotError).message).toContain("tiempo de espera");
  });

  it("distinguishes network failure from service failure", async () => {
    process.env.HAPPYROBOT_MAX_ATTEMPTS = "1";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeHappyRobotAction(makeAction(), makeContact()).catch((err) => err);

    expect((error as HappyRobotError).kind).toBe("network");
  });

  it("rejects unreadable response", async () => {
    process.env.HAPPYROBOT_MAX_ATTEMPTS = "1";
    const fetchMock = vi
      .fn()
      .mockImplementation(() => new Response("<html>gateway</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeHappyRobotAction(makeAction(), makeContact()).catch((err) => err);

    expect((error as HappyRobotError).kind).toBe("unreadable-response");
    expect((error as HappyRobotError).message).toContain("ilegible");
  });

  it("endpoint, authentication, and payload shape are configurable without code changes", async () => {
    process.env.HAPPYROBOT_ACTION_PATH = "/v2/workflows/{workflowId}/run";
    process.env.HAPPYROBOT_WORKFLOW_ID = "wf-crisis";
    process.env.HAPPYROBOT_AUTH_HEADER = "x-api-key";
    process.env.HAPPYROBOT_AUTH_SCHEME = "";
    process.env.HAPPYROBOT_PAYLOAD_SHAPE = "trigger";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { id: "hr-externo-3" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(actionEndpoint()).toBe("https://api.happyrobot.test/v2/workflows/wf-crisis/run");

    const result = await executeHappyRobotAction(makeAction(), makeContact());
    const [url, init] = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(url).toBe("https://api.happyrobot.test/v2/workflows/wf-crisis/run");
    expect(headers["x-api-key"]).toBe("clave-de-pruebas");
    expect(body.input).toBeDefined();
    expect(body.idempotencyKey).toBe("act-test-1:1");
    expect(result.externalActionId).toBe("hr-externo-3");

    delete process.env.HAPPYROBOT_WORKFLOW_ID;
  });

  it("adapts briefing to recipient role", () => {
    const paraVoluntario = buildActionPayload(
      makeAction({ channel: "sms" }),
      makeContact({ role: "volunteer" }),
    );
    const paraAutoridad = buildActionPayload(
      makeAction({ channel: "email" }),
      makeContact({ role: "authority" }),
    );

    const briefingVoluntario = (paraVoluntario.briefing as { detail: string }).detail;
    const briefingAutoridad = (paraAutoridad.briefing as { askFor: string }).askFor;
    expect(briefingVoluntario).not.toBe(
      (paraAutoridad as { briefing: { detail: string } }).briefing.detail,
    );
    expect(briefingAutoridad).toMatch(/respaldo|medios/i);
  });
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

describe("contact and channel selection", () => {
  const contactos: Contact[] = [
    makeContact({ id: "con-field", role: "field-coordinator", zoneId: "zone-north" }),
    makeContact({
      id: "con-med",
      role: "medical-lead",
      zoneId: "zone-central",
      responsiveness: 0.7,
    }),
    makeContact({
      id: "con-vol",
      role: "volunteer",
      zoneId: "zone-south",
      channels: ["sms", "whatsapp", "call"],
    }),
    makeContact({
      id: "con-ops",
      role: "operations-lead",
      zoneId: null,
      channels: ["slack", "call", "email"],
    }),
    makeContact({ id: "con-auth", role: "authority", zoneId: null, channels: ["email", "call"] }),
  ];

  it("selects appropriate role for category", () => {
    expect(selectContact(contactos, "zone-central", "triaje")?.id).toBe("con-med");
    expect(selectContact(contactos, "zone-north", "incendio")?.id).toBe("con-field");
    expect(selectContact(contactos, "zone-south", "refugio")?.id).toBe("con-vol");
  });

  it("understands categories in English and variations", () => {
    expect(rolesForCategory("shelter-overflow")[0]).toBe("volunteer");
    expect(rolesForCategory("evacuation-support")[0]).toBe("field-coordinator");
    expect(rolesForCategory("categoria-desconocida")[0]).toBe("operations-lead");
  });

  it("prefers affected zone when multiple candidates share same role", () => {
    const ampliado = [
      ...contactos,
      makeContact({ id: "con-field-sur", role: "field-coordinator", zoneId: "zone-south" }),
    ];
    expect(selectContact(ampliado, "zone-south", "incendio")?.id).toBe("con-field-sur");
  });

  it("calls field personnel and writes to those who should not be interrupted", () => {
    const campo = makeContact({ role: "field-coordinator", channels: ["call", "sms", "email"] });
    const voluntario = makeContact({ role: "volunteer", channels: ["sms", "whatsapp", "call"] });
    const autoridad = makeContact({ role: "authority", channels: ["email", "call"] });

    expect(selectChannel(campo, true)).toBe("call");
    // A neighbor or volunteer receives a short text, not a phone call.
    expect(selectChannel(voluntario, true)).not.toBe("call");
    expect(selectChannel(autoridad, false)).toBe("email");
  });

  it("considers learned success rate when selecting channel", () => {
    // Between two comparable channels, learned stats decide. Urgency still
    // outweighs history: email never replaces a call.
    const contacto = makeContact({ role: "public-safety", channels: ["sms", "whatsapp"] });
    const canalSinAprendizaje = selectChannel(contacto, true);
    const canalConAprendizaje = selectChannel(contacto, true, {
      channelStats: {
        sms: { attempts: 10, successes: 0 },
        whatsapp: { attempts: 10, successes: 10 },
      },
      contactStats: {},
      unconfirmedPenalty: 0,
      runsAnalyzed: 3,
      updatedAt: null,
    });

    expect(canalSinAprendizaje).toBe("sms");
    expect(canalConAprendizaje).toBe("whatsapp");
  });

  it("each role receives a distinct message", () => {
    const entrada = {
      objective: "Confirmar evacuacion.",
      zoneName: "Sierra Morena",
      reason: "el frente giro",
      urgent: true,
    };
    const voluntario = briefingForRole("volunteer", entrada);
    const autoridad = briefingForRole("authority", entrada);
    const campo = briefingForRole("field-coordinator", entrada);

    expect(voluntario.askFor).not.toBe(autoridad.askFor);
    expect(campo.detail).not.toBe(voluntario.detail);
    expect(voluntario.detail).toMatch(/no te desplaces/i);
  });
});

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

describe("escalation chain", () => {
  it("builds multi-step chain ending at authority", () => {
    const chain = buildEscalationChain({
      id: "chain-1",
      objective: "Evacuar el nucleo norte.",
      zoneId: "zone-north",
      category: "evacuacion",
      urgent: true,
      contacts: getSituation().contacts,
      at: new Date().toISOString(),
    });

    expect(chain.steps.length).toBeGreaterThanOrEqual(3);
    expect(chain.status).toBe("active");

    const contactos = chain.steps.map((step) => step.contactId);
    expect(new Set(contactos).size).toBe(contactos.length);

    const ultimo = chain.steps[chain.steps.length - 1];
    const autoridad = getSituation().contacts.find((contact) => contact.id === ultimo.contactId);
    expect(autoridad?.role).toBe("authority");

    for (const step of chain.steps) {
      expect(step.reason.length).toBeGreaterThan(20);
      expect(step.waitSeconds).toBeGreaterThan(0);
      expect(step.order).toBe(chain.steps.indexOf(step) + 1);
    }
  });

  it("first tier uses most direct channel and subsequent tiers wait longer", () => {
    const chain = buildEscalationChain({
      id: "chain-2",
      objective: "Confirmar estado de la ruta.",
      zoneId: "zone-east",
      category: "route-blocked",
      urgent: true,
      contacts: getSituation().contacts,
      at: new Date().toISOString(),
    });

    const directos: ActionChannel[] = ["call", "sms", "whatsapp"];
    expect(directos).toContain(chain.steps[0].channel);
    expect(chain.steps[chain.steps.length - 1].waitSeconds).toBeGreaterThan(
      chain.steps[0].waitSeconds,
    );
  });
});

// ---------------------------------------------------------------------------
// Inbound webhook
// ---------------------------------------------------------------------------

function webhookRequest(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-happyrobot-secret"] = secret;
  return new Request("http://localhost/api/webhooks/happyrobot", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("HappyRobot inbound webhook", () => {
  it("rejects an invalid secret", async () => {
    const response = await webhookPost(
      webhookRequest({ status: "completed" }, "secreto-equivocado"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a request without secret header", async () => {
    const response = await webhookPost(webhookRequest({ status: "completed" }, null));
    expect(response.status).toBe(401);
  });

  it("shuts down completely if no secret is configured", async () => {
    delete process.env.HAPPYROBOT_WEBHOOK_SECRET;
    const response = await webhookPost(webhookRequest({ status: "completed" }, "lo-que-sea"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/HAPPYROBOT_WEBHOOK_SECRET/);
    expect(verifyWebhookSecret(webhookRequest({}, SECRET)).ok).toBe(false);
  });

  it("updates action status from valid callback", async () => {
    const action = getSituation().actions[0];
    const response = await webhookPost(
      webhookRequest({
        deliveryId: "entrega-estado-1",
        localActionId: action.id,
        externalActionId: "hr-callback-1",
        status: "completed",
        summary: "El coordinador confirmo la evacuacion.",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.duplicate).toBe(false);
    expect(body.action.status).toBe("succeeded");
    expect(body.action.externalActionId).toBe("hr-callback-1");
  });

  it("converts new information into signals and forces replanning", async () => {
    const action = getSituation().actions[0];
    const versionPrevia = getSituation().plan.version;

    const response = await webhookPost(
      webhookRequest({
        deliveryId: "entrega-info-1",
        localActionId: action.id,
        status: "completed",
        summary: "Llamada atendida.",
        newInformation: [
          {
            type: "route-blocked",
            zoneId: "zone-east",
            description: "La A-92 esta cortada a la altura de la salida 241.",
          },
        ],
      }),
    );
    const body = await response.json();
    const situacion = getSituation();

    expect(response.status).toBe(200);
    expect(body.ingestedEventIds).toHaveLength(1);
    const evento = situacion.events.find((candidate) => candidate.id === body.ingestedEventIds[0]);
    expect(evento?.source).toBe("happyrobot");
    expect(evento?.zoneId).toBe("zone-east");
    expect(evento?.category).toBe("route-blocked");
    expect(situacion.plan.version).toBeGreaterThan(versionPrevia);
  });

  it("repeated callback does not duplicate signals or re-advance state", async () => {
    const action = getSituation().actions[0];
    const payload = {
      deliveryId: "entrega-repetida-1",
      localActionId: action.id,
      status: "completed",
      newInformation: [
        {
          type: "shelter-overflow",
          zoneId: "zone-south",
          description: "El pabellon municipal esta al limite de aforo.",
        },
      ],
    };

    const primera = await webhookPost(webhookRequest(payload));
    const cuerpoPrimera = await primera.json();
    const eventosTrasPrimera = getSituation().events.length;
    const versionTrasPrimera = getSituation().plan.version;

    const segunda = await webhookPost(webhookRequest(payload));
    const cuerpoSegunda = await segunda.json();

    expect(cuerpoPrimera.duplicate).toBe(false);
    expect(cuerpoSegunda.duplicate).toBe(true);
    expect(cuerpoSegunda.ingestedEventIds).toEqual(cuerpoPrimera.ingestedEventIds);
    expect(getSituation().events.length).toBe(eventosTrasPrimera);
    expect(getSituation().plan.version).toBe(versionTrasPrimera);
  });

  it("accepts new information even if local action no longer exists", async () => {
    const response = await webhookPost(
      webhookRequest({
        deliveryId: "entrega-huerfana-1",
        localActionId: "act-que-no-existe",
        status: "completed",
        newInformation: [
          {
            type: "medical-support",
            zoneId: "zone-central",
            description: "Un equipo sanitario informa de diez atenciones nuevas.",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.ingestedEventIds).toHaveLength(1);
    expect(body.notes.join(" ")).toContain("act-que-no-existe");
  });

  it("rejects empty callback and unknown status", async () => {
    const vacio = await webhookPost(webhookRequest({ deliveryId: "entrega-vacia-1" }));
    expect(vacio.status).toBe(400);

    const desconocido = await webhookPost(
      webhookRequest({ deliveryId: "entrega-rara-1", status: "teletransportado" }),
    );
    expect(desconocido.status).toBe(400);
  });

  it("rejects methods other than POST", async () => {
    const { GET } = await import("@/app/api/webhooks/happyrobot/route");
    const response = GET();
    expect(response.status).toBe(405);
  });
});
