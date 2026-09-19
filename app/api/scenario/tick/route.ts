// PROPIETARIO: agente del escenario que avanza solo.
// Empuje manual del guion: aplica los beats que ya tocaban y devuelve la
// situacion. La interfaz no necesita llamarla (sondear /api/situation ya hace
// avanzar el guion), pero es util para el presentador, para pruebas y para un
// cron externo si se despliega en un entorno sin procesos de larga vida.

import { stopHeartbeat } from "@/lib/scenario";
import { getSituation, pollSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // No lee cuerpo a proposito: un tick no admite parametros.
    const situacion = pollSituation();
    // Si el guion ya termino, este es un buen sitio para recoger el latido.
    if (!situacion.scenario.running) stopHeartbeat();
    return apiOk(situacion);
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo avanzar el escenario");
  }
}

/** Lectura sin efectos del estado del guion, comoda para depurar la demo. */
export async function GET() {
  try {
    return apiOk(getSituation().scenario);
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo leer el estado del escenario");
  }
}

export const PUT = methodNotAllowed(["GET", "POST"]);
export const PATCH = methodNotAllowed(["GET", "POST"]);
export const DELETE = methodNotAllowed(["GET", "POST"]);
