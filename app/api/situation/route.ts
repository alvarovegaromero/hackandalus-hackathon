// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Lectura viva del estado: es lo que sondea la interfaz cada 4 segundos.

import { pollSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `pollSituation` (y no `getSituation`) porque el sondeo es lo que hace
    // avanzar el escenario y barrer las acciones atascadas. Con `getSituation`
    // el escenario nunca avanzaba y las acciones colgadas no se detectaban.
    return apiOk(pollSituation());
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo leer la situación");
  }
}

export const POST = methodNotAllowed(["GET"]);
export const PUT = methodNotAllowed(["GET"]);
export const PATCH = methodNotAllowed(["GET"]);
export const DELETE = methodNotAllowed(["GET"]);
