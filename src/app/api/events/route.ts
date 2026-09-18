import { authorize } from "@/lib/api-auth";
import { normalizeBatch } from "@/lib/ingest";
import { ingestBatch } from "@/lib/ingest-server";

// One event, an array, or { events: [...] }. `?wait=1` returns each run's result.
export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const body = normalizeBatch(await request.json().catch(() => undefined));
  const wait = new URL(request.url).searchParams.get("wait") === "1";
  const { status, body: response } = await ingestBatch(body, wait);
  return Response.json(response, { status });
}
