import { NextResponse } from "next/server";
import { markEvent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = (await request.json()) as { confirmed?: boolean };
  try {
    const event = markEvent(params.id, Boolean(payload.confirmed));
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 404 });
  }
}
