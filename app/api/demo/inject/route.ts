import { NextResponse } from "next/server";
import { injectDemo } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    kind?: "incident" | "resource-down" | "route-blocked" | "integration-failure";
  };
  return NextResponse.json(injectDemo(payload.kind ?? "incident"));
}
