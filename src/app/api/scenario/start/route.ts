// OWNER: self-advancing scenario agent.
// Starts (or resumes) the script that drives the crisis autonomously.
//
// Accepted body, all optional:
//   { "scriptId": "flood-guadalquivir", "speed": 4, "restart": true }
//
//  - Without body: starts current script, or RESUMES it if paused.
//  - restart: true forces starting from scratch.
//  - Changing scriptId implies starting from scratch with the new script.
//  - speed applies on the fly: can switch from 1x to 4x without restarting.
//
// Unlike /api/demo/*, these routes do NOT use `autorizarRutaDemo`: an advancing
// scenario is a mandatory requirement of the challenge and that function
// completely disables the route in production when DEMO_API_TOKEN is not set,
// which would leave the crisis frozen in the demo environment. If decided to
// protect them, the token must first be provided to the UI.

import { z } from "zod";

import {
  MAX_SPEED,
  MIN_SPEED,
  configureScenario,
  ensureHeartbeat,
  findScript,
  listScenarioScripts,
} from "@/lib/scenario";
import { getSituation, pollSituation, startScenarioRun, tickScenario } from "@/lib/store";
import {
  apiError,
  apiErrorFromThrown,
  apiOk,
  methodNotAllowed,
  parseJsonBody,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Heartbeat interval to advance the script. */
const HEARTBEAT_MS = 5000;

const scenarioStartSchema = z.strictObject({
  scriptId: z.string().trim().min(1).max(80).optional(),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED).optional(),
  restart: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, scenarioStartSchema);
  if (!parsed.ok) return parsed.response;

  const { scriptId, speed, restart } = parsed.data;

  if (scriptId !== undefined && !findScript(scriptId)) {
    return apiError("referencia_desconocida", "Scenario script does not exist.", 400, [
      {
        campo: "scriptId",
        mensaje: `Available scripts: ${listScenarioScripts()
          .map((script) => script.id)
          .join(", ")}.`,
      },
    ]);
  }

  try {
    const antes = getSituation().scenario;
    const cambiaGuion = scriptId !== undefined && scriptId !== antes.id;
    const quiereEmpezarDeCero = restart === true || cambiaGuion;

    configureScenario({ scriptId, speed, restart });

    // If already running and only speed change was requested, clock is not
    // reset: an accidental reset mid-demo is noticeable and unforgiving.
    const situacion = antes.running && !quiereEmpezarDeCero ? pollSituation() : startScenarioRun();

    // The script cannot depend on someone watching the screen: while
    // running, a single interval drives it even if nobody polls.
    ensureHeartbeat(() => {
      tickScenario();
      return getSituation().scenario.running;
    }, HEARTBEAT_MS);

    return apiOk(situacion);
  } catch (error) {
    return apiErrorFromThrown(error, "Could not start scenario");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
