import Dashboard from "@/components/Dashboard";
import Link from "next/link";
import { publicDemoExpiresAt } from "@/lib/demo-access";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const demoControlsEnabled = process.env.ACTION_EXECUTION_MODE !== "happyrobot";
  if (process.env.NODE_ENV === "development")
    return <Dashboard demoControlsEnabled={demoControlsEnabled} />;
  const expiresAt = publicDemoExpiresAt();
  if (!expiresAt) {
    return (
      <main className="shell faro-dashboard flex min-h-dvh flex-col items-center justify-center gap-4">
        <h1 className="text-2xl">The public demo is closed</h1>
        <p>Thank you for visiting Far0.</p>
        <Link href="/" prefetch={false} className="underline underline-offset-4">
          Back to home
        </Link>
      </main>
    );
  }
  return <Dashboard demoControlsEnabled={demoControlsEnabled} expiresAt={expiresAt} />;
}
