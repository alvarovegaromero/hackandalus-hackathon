import "server-only";
import { timingSafeEqual } from "node:crypto";

export function authorize(request: Request): Response | undefined {
  const token = process.env.CRISIS_API_TOKEN;
  if (!token) return Response.json({ error: "Workflow API disabled: configure CRISIS_API_TOKEN." }, { status: 503 });
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
