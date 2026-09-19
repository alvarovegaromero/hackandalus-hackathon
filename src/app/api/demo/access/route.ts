import { NextResponse } from "next/server";
import {
  createDemoSession,
  DEMO_COOKIE,
  DEMO_SESSION_SECONDS,
  demoAccessEnabled,
  matchesDemoCode,
  requireSameOrigin,
} from "@/lib/demo-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  if (!demoAccessEnabled()) {
    return NextResponse.json({ error: "Demo access is disabled." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "JSON required." }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  if (!matchesDemoCode(code)) {
    return NextResponse.json(
      { error: "Incorrect demo code." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const session = createDemoSession();
  const response = NextResponse.json(
    { unlocked: true, expiresAt: session.expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(DEMO_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: DEMO_SESSION_SECONDS,
  });
  return response;
}
