// PROPIETARIO: agente del escenario que avanza solo.
// Pausa el guion. No es un reinicio: el tiempo de guion consumido se conserva
// y volver a llamar a /api/scenario/start continua donde se quedo.

import { stopHeartbeat } from "@/lib/scenario";
import { stopScenarioRun } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Primero se apaga el latido: si no, un tick en vuelo podria disparar un
    // beat justo despues de que el operador haya pedido parar.
    stopHeartbeat();
    return apiOk(stopScenarioRun());
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo detener el escenario");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
