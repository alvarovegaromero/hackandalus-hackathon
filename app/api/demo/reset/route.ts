// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Reinicio del estado de la crisis. Ruta protegida: es destructiva.

import { resetSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, autorizarRutaDemo, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const noAutorizado = autorizarRutaDemo(request);
  if (noAutorizado) return noAutorizado;

  // No lee cuerpo a proposito: reiniciar no admite parametros, asi que un
  // cuerpo vacio o un "{}" de la interfaz valen igual.
  try {
    return apiOk(resetSituation());
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo reiniciar la demo");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
