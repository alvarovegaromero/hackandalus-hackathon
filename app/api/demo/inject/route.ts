// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Inyeccion de averias de demo. Ruta protegida: manipula el estado de la crisis.

import { injectDemo } from "@/lib/store";
import {
  apiErrorFromThrown,
  apiOk,
  autorizarRutaDemo,
  demoInjectSchema,
  methodNotAllowed,
  parseJsonBody,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const noAutorizado = autorizarRutaDemo(request);
  if (noAutorizado) return noAutorizado;

  const parsed = await parseJsonBody(request, demoInjectSchema);
  if (!parsed.ok) return parsed.response;

  try {
    return apiOk(injectDemo(parsed.data.kind ?? "incident"));
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo inyectar la avería de demo");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
