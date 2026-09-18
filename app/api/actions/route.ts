import { NextResponse } from "next/server";
import { createAction } from "@/lib/store";
import type { CreateActionPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as CreateActionPayload;
  const action = createAction(payload);
  return NextResponse.json({ action }, { status: 201 });
}
