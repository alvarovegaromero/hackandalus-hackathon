// OWNER: P4 explicit model-provider configuration; no cross-provider fallback.
import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, type LanguageModel } from "ai";
import { z } from "zod";

export const PLANNER_ENV_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_GATEWAY_API_KEY",
  "OPENCODE_MODEL",
  "OPENCODE_API_KEY",
] as const;

export class PlannerModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerModelConfigurationError";
  }
}

export type PlannerModel = {
  model: LanguageModel;
  modelId: string;
  provider: "gateway" | "opencode-go" | "opencode-zen";
};

/** Construct a client only: no request is sent by configuration/preflight. */
export function createPlannerModel(
  runId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlannerModel {
  z.uuid().parse(runId);
  const provider = env.AI_PROVIDER?.trim() || "gateway";
  if (provider === "gateway") {
    const modelId = env.AI_MODEL?.trim();
    const apiKey = env.AI_GATEWAY_API_KEY?.trim();
    if (!modelId || !apiKey) {
      throw new PlannerModelConfigurationError(
        "Configure AI_MODEL and AI_GATEWAY_API_KEY for gateway planning.",
      );
    }
    return { provider, modelId, model: createGateway({ apiKey })(modelId) };
  }
  if (provider !== "opencode-go" && provider !== "opencode-zen") {
    throw new PlannerModelConfigurationError(
      "AI_PROVIDER must be gateway, opencode-go or opencode-zen.",
    );
  }
  const modelId = env.OPENCODE_MODEL?.trim();
  const apiKey = env.OPENCODE_API_KEY?.trim();
  if (!modelId || !apiKey) {
    throw new PlannerModelConfigurationError(
      "Configure OPENCODE_MODEL and OPENCODE_API_KEY for OpenCode planning.",
    );
  }
  if (modelId !== "gpt-5.6-luna") {
    throw new PlannerModelConfigurationError(
      "This POC OpenCode adapter supports only gpt-5.6-luna via Responses. Other models need their documented protocol adapter.",
    );
  }
  // Official model-specific endpoints; never send the key to a model-supplied URL.
  const client = createOpenAI({
    apiKey,
    baseURL:
      provider === "opencode-go" ? "https://opencode.ai/zen/go/v1" : "https://opencode.ai/zen/v1",
    headers: { "User-Agent": "faro-poc/0.1", "x-opencode-session": runId },
  });
  return { provider, modelId, model: client.responses(modelId) };
}
