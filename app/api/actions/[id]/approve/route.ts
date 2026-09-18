import { NextResponse } from "next/server";
import { approveAction } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const action = await approveAction(params.id);
    return NextResponse.json({ action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 404 });
  }
}
