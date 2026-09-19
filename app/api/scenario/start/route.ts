// PROPIETARIO: agente del escenario que avanza solo.
// Arranca (o reanuda) el guion que hace cambiar la crisis sola.
//
// Cuerpo admitido, todo opcional:
//   { "scriptId": "flood-guadalquivir", "speed": 4, "restart": true }
//
//  - Sin cuerpo: arranca el guion actual, o lo REANUDA si estaba pausado.
//  - restart: true fuerza empezar de cero.
//  - Cambiar de scriptId implica empezar de cero con el guion nuevo.
//  - speed se aplica en caliente: se puede pasar de 1x a 4x sin reiniciar.
//
// A diferencia de /api/demo/*, estas rutas NO llevan `autorizarRutaDemo`: un
// escenario en movimiento es un requisito obligatorio del reto y esa funcion
// desactiva por completo la ruta en produccion cuando no hay DEMO_API_TOKEN,
// lo que dejaria la crisis congelada justo en el entorno de la demo. Si se
// decide protegerlas, hay que dar antes el token a la interfaz.

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

/** Cada cuanto empuja el guion el latido de servidor. */
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
    return apiError("referencia_desconocida", "Ese guion de escenario no existe.", 400, [
      {
        campo: "scriptId",
        mensaje: `Guiones disponibles: ${listScenarioScripts()
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

    // Si ya esta corriendo y solo se pide cambiar la velocidad, no se reinicia
    // el reloj: un reinicio accidental a mitad de demo se nota y no se perdona.
    const situacion = antes.running && !quiereEmpezarDeCero ? pollSituation() : startScenarioRun();

    // El guion no puede depender de que alguien mire la pantalla: mientras
    // corre, un unico intervalo lo empuja aunque nadie sondee.
    ensureHeartbeat(() => {
      tickScenario();
      return getSituation().scenario.running;
    }, HEARTBEAT_MS);

    return apiOk(situacion);
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo arrancar el escenario");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
