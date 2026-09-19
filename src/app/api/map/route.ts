import { seedZones } from "@/lib/seed";

// Read-only illustrative geography; does not initialize or advance the scaffold.
export async function GET() {
  return Response.json({ zones: seedZones });
}
