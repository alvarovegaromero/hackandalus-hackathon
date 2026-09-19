// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Aprobacion humana de una accion: es el punto donde el sistema actua.

import { approveAction } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Esta ruta no lee cuerpo: el identificador va en la ruta y la aprobacion no
  // admite parametros. Un cuerpo enviado por la interfaz se ignora.
  try {
    const action = await approveAction(id);
    return apiOk({ action });
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo aprobar la acción");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
