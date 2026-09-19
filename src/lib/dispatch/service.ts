// OWNER: P4 dispatch of already reserved mission resources, with durable send claims.
import { z } from "zod";
import { resourceIdSchema } from "../contracts/coordinator";
import type { MissionInput } from "../contracts/mission";
import { dispatchRpc } from "./repository";
import { DispatchStartError, startResourceDispatch } from "./client";
import type { DispatchRpc } from "./contracts";

const contactsSchema = z.partialRecord(
  resourceIdSchema,
  z.strictObject({
    name: z.string().min(1).max(200),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    demoSafe: z.literal(true),
  }),
);

export async function dispatchMissionResources(
  mission: MissionInput,
  token: string,
  rpc: DispatchRpc = dispatchRpc,
  start = startResourceDispatch,
) {
  let contacts: z.infer<typeof contactsSchema> = {};
  let configurationError: string | undefined;
  try {
    contacts = contactsSchema.parse(JSON.parse(process.env.HAPPYROBOT_RESOURCE_CONTACTS ?? "{}"));
  } catch {
    configurationError = "Invalid HappyRobot resource contact configuration.";
  }
  const prepared = await rpc("prepare", { missionId: mission.missionId, token });
  if (prepared.code !== "OK") return { outcome: prepared.code, changed: false };
  for (const dispatch of prepared.dispatches ?? []) {
    const contact = contacts[dispatch.resource_id];
    if (configurationError || !contact) {
      await rpc("start_result", {
        dispatchId: dispatch.dispatch_id,
        status: "failed",
        error: configurationError ?? `No approved demo contact for ${dispatch.resource_id}.`,
      });
      continue;
    }
    const payload = {
      ...dispatch.payload,
      resource_contact_name: contact.name,
      resource_phone: contact.phone,
    };
    // Persist and atomically authorize the send. No expired-lease automatic resend.
    const claim = await rpc("send", { dispatchId: dispatch.dispatch_id });
    if (claim.code !== "OK") continue;
    let runId: string;
    try {
      runId = await start(payload);
    } catch (error) {
      const failure =
        error instanceof DispatchStartError
          ? error
          : new DispatchStartError("unknown", "Dispatch start outcome is unknown.");
      await rpc("start_result", {
        dispatchId: dispatch.dispatch_id,
        status: failure.status,
        error: failure.message,
      });
      continue;
    }
    // Keep persistence failures out of the transport catch: the call may already exist.
    await rpc("start_result", {
      dispatchId: dispatch.dispatch_id,
      status: "awaiting_result",
      runId,
    });
  }
  return { outcome: "OK", missionId: mission.missionId, changed: true };
}
