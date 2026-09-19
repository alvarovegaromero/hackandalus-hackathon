import Link from "next/link";

const TABS = [
  { id: "live", href: "/dashboard", label: "Live operations" },
  { id: "drills", href: "/dashboard/drills", label: "Drills" },
] as const;

// Switches between the live console and the training simulator.
export default function ConsoleNav({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Console" className="console-nav">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          prefetch={false}
          aria-current={tab.id === current ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
