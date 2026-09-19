"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Kpi from "./kpi";
import type { Report } from "./model";

// Filter outcomes are a pipeline step, not a severity: ink and outline only, never a hue.
export default function IntakeCard({ reports }: { reports: Report[] }) {
  const count = (filter: Report["filter"]) => reports.filter((r) => r.filter === filter).length;
  const relevant = count("relevant");
  const discarded = count("discarded");
  const pending = count("pending") + count("unavailable");
  const total = reports.length;
  const share = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <Card aria-labelledby="intake-title">
      <CardHeader>
        <CardTitle id="intake-title">Reports filtered</CardTitle>
        <span className="text-meta text-muted tabular-nums">{total} received</span>
      </CardHeader>
      <CardContent className="flex items-end gap-6">
        <Kpi value={relevant} label="Relevant" />
        <Kpi value={discarded} label="Discarded as noise" tone="text-muted" />
      </CardContent>
      <CardFooter className="grid gap-1.5">
        <div
          className="flex h-1.5 overflow-hidden rounded-full bg-line"
          role="img"
          aria-label={`${relevant} relevant, ${discarded} discarded, ${pending} pending review of ${total} reports`}
        >
          <span
            className="bg-ink transition-[width] duration-500"
            style={{ width: share(relevant) }}
          />
          <span
            className="bg-muted/40 transition-[width] duration-500"
            style={{ width: share(pending) }}
          />
        </div>
        <span>{pending ? `${pending} awaiting the relevance filter` : "Jev relevance filter"}</span>
      </CardFooter>
    </Card>
  );
}
