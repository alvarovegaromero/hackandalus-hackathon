// OWNER: P4 subagent-only communication tools. Mock provider, no external calls.
import { tool } from "ai";
import { z } from "zod";
import {
  contactInputSchema,
  contactOperationSchema,
  type MissionInput,
} from "../contracts/mission";
import { missionRpc } from "./repository";

export function createMissionTools(mission: MissionInput, token: string) {
  return {
    contactService: tool({
      description:
        "Start one simulated HappyRobot contact per service for this mission. Repeated calls return the original operation, even if wording changes. Never sends a real call. Query its result next.",
      inputSchema: contactInputSchema,
      execute: async (input) => {
        if (!mission.allowedTools.includes("contactService"))
          throw new Error("Tool not permitted.");
        const result = await missionRpc("contact", token, {
          missionId: mission.missionId,
          ...input,
        });
        if (result.code !== "OK") throw new Error(result.code);
        return contactOperationSchema.parse(result.operation);
      },
    }),
    getContactResult: tool({
      description:
        "Read a contact belonging to this mission. The mock acknowledges it on the first query; this is not evidence of actual contact, dispatch or arrival.",
      inputSchema: z.strictObject({ operationId: z.uuid() }),
      execute: async ({ operationId }) => {
        if (!mission.allowedTools.includes("getContactResult"))
          throw new Error("Tool not permitted.");
        const result = await missionRpc("contact_result", token, {
          missionId: mission.missionId,
          operationId,
        });
        if (result.code !== "OK") throw new Error(result.code);
        return contactOperationSchema.parse(result.operation);
      },
    }),
  };
}
