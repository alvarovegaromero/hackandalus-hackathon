import { NextResponse } from "next/server";
import { getSituation } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSituation());
}
