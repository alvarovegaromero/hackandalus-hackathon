// OWNER: authenticated inbound HappyRobot signal intake.

import { apiError, methodNotAllowed, parseJsonBody } from "@/lib/validation";
import {
  WEBHOOK_SECRET_HEADER,
  isWebhookSecretConfigured,
  verifyWebhookSecret,
} from "@/lib/happyrobot";
import {
  happyRobotExternalIdentity,
  happyRobotNormalizedReportSchema,
  signalIdFromExternalIdentity,
} from "@/lib/signals/happyrobot";
import { processSignal } from "@/lib/signals/process";
import { createSignalRepository, type SignalRepository } from "@/lib/signals/repository";
import { enqueueLegacyEvent } from "@/lib/coordinator/runtime";
import { publishAcceptedEvent } from "@/lib/event-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SignalRouteDependencies {
  repository?: SignalRepository;
  process?: typeof processSignal;
}

function response(
  signalId: string,
  eventId: string | null,
  duplicate: boolean,
  status: "processed" | "already_processed" | "processing" | "processing_failed",
  httpStatus: number,
) {
  return Response.json(
    { signalId, eventId, duplicate, status },
    { status: httpStatus, headers: { "cache-control": "no-store" } },
  );
}

export async function handleSignalPost(
  request: Request,
  dependencies: SignalRouteDependencies = {},
) {
  const auth = verifyWebhookSecret(request);
  if (!auth.ok) {
    return apiError(
      isWebhookSecretConfigured() ? "no_autorizado" : "error_interno",
      auth.reason ?? "Signal intake rejected.",
      isWebhookSecretConfigured() ? 401 : 503,
      [{ campo: WEBHOOK_SECRET_HEADER, mensaje: "Required HappyRobot shared-secret header." }],
    );
  }

  const parsed = await parseJsonBody(request, happyRobotNormalizedReportSchema, {
    permitirVacio: false,
  });
  if (!parsed.ok) return parsed.response;

  const externalIdentity = happyRobotExternalIdentity(parsed.data);
  const signalId = signalIdFromExternalIdentity(externalIdentity);
  let repository: SignalRepository;
  try {
    repository = dependencies.repository ?? createSignalRepository();
  } catch (error) {
    return apiError(
      "persistencia_no_disponible",
      error instanceof Error ? error.message : "Durable signal storage is unavailable.",
      503,
    );
  }

  try {
    const stored = await repository.createOrGet({
      id: signalId,
      channel: parsed.data.channel,
      externalIdentity,
      receivedAt: parsed.data.received_at ?? new Date().toISOString(),
      rawPayload: parsed.data,
    });

    if (stored.signal.processingStatus === "processed") {
      return response(signalId, stored.signal.eventId, true, "already_processed", 200);
    }

    const claimed = await repository.claimForProcessing(signalId);
    if (!claimed) {
      const current = await repository.getById(signalId);
      if (current?.processingStatus === "processed") {
        return response(signalId, current.eventId, true, "already_processed", 200);
      }
      return response(signalId, current?.eventId ?? null, !stored.inserted, "processing", 202);
    }

    try {
      const payload = {
        source: "happyrobot" as const,
        title: "Inbound HappyRobot report",
        description: claimed.rawPayload.report_summary.slice(0, 2000),
        category: "field-report",
      };
      const queued = await enqueueLegacyEvent(payload, claimed.id);
      publishAcceptedEvent(payload, queued.eventId);
      await repository.markProcessed(signalId, queued.eventId);
      return response(signalId, queued.eventId, !stored.inserted, "processed", 201);
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error);
      await repository.markFailed(signalId, safeError);
      return response(signalId, null, !stored.inserted, "processing_failed", 500);
    }
  } catch (error) {
    return apiError(
      "persistencia_no_disponible",
      error instanceof Error ? error.message : "Durable signal storage failed.",
      503,
    );
  }
}

export async function POST(request: Request) {
  return handleSignalPost(request);
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
