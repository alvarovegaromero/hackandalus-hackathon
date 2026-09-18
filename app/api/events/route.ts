import { NextResponse } from "next/server";
import { addEvent } from "@/lib/store";
import type { IncomingEventPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as IncomingEventPayload;
  const result = addEvent(payload);
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
}
