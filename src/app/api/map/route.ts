import { seedZones } from "@/lib/seed";
import { isDemoShowcase } from "@/lib/demo-access";
import { showcaseSnapshot } from "@/lib/demo/showcase";

// Read-only illustrative geography; does not initialize or advance the scaffold.
export async function GET() {
  return Response.json(isDemoShowcase() ? showcaseSnapshot.map : { zones: seedZones });
}
