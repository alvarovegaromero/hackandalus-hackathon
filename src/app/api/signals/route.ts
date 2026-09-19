import { after } from "next/server";
import { processCoordinatorInBackground } from "@/lib/coordinator/background";
import { methodNotAllowed } from "@/lib/validation";
import { handleSignalPost } from "./handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleSignalPost(request);
  if (result.ok) after(processCoordinatorInBackground);
  return result;
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);

export const maxDuration = 180;
