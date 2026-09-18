import { NextResponse } from "next/server";
import { resetSituation } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(resetSituation());
}
