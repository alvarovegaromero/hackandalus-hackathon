// OWNER: P4 authenticated durable Resource Dispatch callback.
import { createHash } from "node:crypto";
import { after } from "next/server";
import { isWebhookSecretConfigured, verifyWebhookSecret } from "@/lib/happyrobot";
import { parseDispatchResult } from "@/lib/dispatch/contracts";
import type { DispatchRpc } from "@/lib/dispatch/contracts";
import { dispatchRpc } from "@/lib/dispatch/repository";
import { processDispatchReplanning } from "@/lib/coordinator/background";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleDispatchResult(
  request: Request,
  dependencies: {
    rpc?: DispatchRpc;
    schedule?: () => void;
  } = {},
) {
  if (!verifyWebhookSecret(request).ok)
    return json({ code: "UNAUTHORIZED" }, isWebhookSecretConfigured() ? 401 : 503);
  let result;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 128_000) return json({ code: "BODY_TOO_LARGE" }, 413);
    result = parseDispatchResult(JSON.parse(raw));
  } catch {
    return json({ code: "INVALID_DISPATCH_RESULT" }, 400);
  }
  try {
    const saved = await (dependencies.rpc ?? dispatchRpc)("callback", {
      result,
      fingerprint: createHash("sha256").update(canonical(result)).digest("hex"),
    });
    if (saved.code !== "OK") return json(saved, saved.code === "NOT_FOUND" ? 404 : 409);
    // Duplicates also wake a persisted pending replan after a process interruption.
    (dependencies.schedule ?? (() => after(processDispatchReplanning)))();
    return json(
      {
        ...saved,
        status: saved.stale ? "recorded_stale" : "processed",
        duplicate: Boolean(saved.duplicate),
        replanning: "scheduled",
      },
      200,
    );
  } catch {
    return json({ code: "DISPATCH_STORAGE_UNAVAILABLE" }, 503);
  }
}
