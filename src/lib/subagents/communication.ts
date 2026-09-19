// OWNER: P4 communication adapter; currently a no-op with durable acknowledgement.
import { contactOperationSchema, type ContactOperation } from "../contracts/mission";
import { missionRpc } from "./repository";

/** Replacement boundary for HappyRobot. Never performs external communication today. */
export async function executeCommunication(
  missionId: string,
  operation: ContactOperation,
  token: string,
  persistence: typeof missionRpc = missionRpc,
): Promise<ContactOperation> {
  const result = await persistence("contact_result", token, {
    missionId,
    operationId: operation.operationId,
  });
  if (result.code !== "OK") throw new Error(result.code);
  return contactOperationSchema.parse(result.operation);
}
