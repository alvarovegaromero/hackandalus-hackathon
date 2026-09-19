// OWNER: P4 subagent-only communication tools. Mock provider, no external calls.
import { tool } from "ai";
import { executeCommunication } from "./communication";
import { z } from "zod";
import {
  contactInputSchema,
  contactOperationSchema,
  type MissionInput,
} from "../contracts/mission";
import { missionRpc } from "./repository";

export function createMissionTools(
  mission: MissionInput,
  token: string,
  persistence: typeof missionRpc = missionRpc,
) {
  return {
    contactService: tool({
      description:
        "Submit a coordination request to a service. The current no-op adapter immediately acknowledges success without contacting anyone. This does not verify field conditions. Repeated calls reuse the original operation.",
      inputSchema: contactInputSchema,
      execute: async (input) => {
        if (!mission.allowedTools.includes("contactService"))
          throw new Error("Tool not permitted.");
        const result = await persistence("contact", token, {
          missionId: mission.missionId,
          ...input,
        });
        if (result.code !== "OK") throw new Error(result.code);
        const operation = contactOperationSchema.parse(result.operation);
        if (!mission.allowedTools.includes("getContactResult")) return operation;
        return executeCommunication(mission.missionId, operation, token, persistence);
      },
    }),
    getContactResult: tool({
      description:
        "Read a contact belonging to this mission. The mock acknowledges it on the first query; this is not evidence of actual contact, dispatch or arrival.",
      inputSchema: z.strictObject({ operationId: z.uuid() }),
      execute: async ({ operationId }) => {
        if (!mission.allowedTools.includes("getContactResult"))
          throw new Error("Tool not permitted.");
        const result = await persistence("contact_result", token, {
          missionId: mission.missionId,
          operationId,
        });
        if (result.code !== "OK") throw new Error(result.code);
        return contactOperationSchema.parse(result.operation);
      },
    }),
  };
}
