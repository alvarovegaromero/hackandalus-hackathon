import { cookies } from "next/headers";
import Dashboard from "@/components/Dashboard";
import DemoUnlock from "@/components/DemoUnlock";
import { DEMO_COOKIE, demoAccessEnabled, demoSessionExpiry } from "@/lib/demo-access";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (process.env.NODE_ENV === "development") return <Dashboard demoControlsEnabled />;
  const enabled = demoAccessEnabled();
  const expiresAt = demoSessionExpiry((await cookies()).get(DEMO_COOKIE)?.value);
  if (!expiresAt) return <DemoUnlock enabled={enabled} />;
  return <Dashboard demoControlsEnabled={enabled} />;
}
