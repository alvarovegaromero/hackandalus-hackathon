"use client";

import { TriangleAlert } from "lucide-react";
import { cva } from "class-variance-authority";
import { TextSkeleton } from "@/components/Skeleton";
import { resourceSummary } from "@/components/resource-summary";
import { cn } from "@/lib/utils";
import { PRIORITY_LABELS, clock, type RankedEvent, type Report } from "./model";

// Color + text + position (the list is sorted by priority): never color alone.
const mark = cva("size-2.5 shrink-0 rounded-[2px]", {
  variants: {
    priority: {
      critical: "bg-critical",
      high: "bg-high",
      medium: "bg-medium",
      low: "bg-low",
      unassessed: "border border-unassessed bg-transparent",
    },
  },
});

export default function PriorityQueue({
  events,
  discarded,
  status,
  selectedId,
  onSelect,
}: {
  events: RankedEvent[];
  discarded: Report[];
  status: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const connecting = ["Connecting…", "Loading…"].includes(status);
  return (
    <section className="flex min-h-0 flex-col gap-2" aria-labelledby="queue-title">
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="queue-title" className="text-body font-medium text-muted">
          Events by priority
        </h2>
        {status !== "Live" && (
          <span role="status" className="flex items-center gap-1 text-meta">
            {!connecting && <TriangleAlert size={12} aria-hidden="true" />}
            {status}
          </span>
        )}
      </header>
      <div className="dashboard-scroll">
        {!events.length &&
          (connecting ? (
            <TextSkeleton />
          ) : (
            <p className="text-meta text-muted">
              No active events. New reports appear here as they arrive.
            </p>
          ))}
        <ol className="divide-y divide-line" aria-live="polite" aria-relevant="additions">
          {events.map((event) => (
            <li key={event.id}>
              <details
                className={cn(
                  "group py-2",
                  selectedId === event.id && "-mx-2 rounded-md bg-panel px-2",
                )}
              >
                <summary
                  className="grid cursor-pointer list-none grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-2"
                  onClick={() => onSelect(event.id)}
                >
                  <span className="flex items-center gap-2 text-meta text-muted">
                    <span aria-hidden="true" className={mark({ priority: event.priority })} />
                    {PRIORITY_LABELS[event.priority]}
                  </span>
                  <span className="truncate text-body group-open:whitespace-normal">
                    {event.summary}
                  </span>
                  <span className="text-meta text-muted tabular-nums">
                    {event.at ? <time dateTime={event.at}>{clock(event.at)}</time> : null}
                  </span>
                </summary>
                <div className="mt-1 grid gap-1 pl-[6rem] text-meta text-muted">
                  {event.filterUnavailable && (
                    <p className="flex items-center gap-1 text-ink">
                      <TriangleAlert size={12} aria-hidden="true" /> Relevance filter unavailable;
                      review manually.
                    </p>
                  )}
                  {event.rationale && <p>{event.rationale}</p>}
                  <p>{event.units.length ? resourceSummary(event.units) : "No units assigned"}</p>
                </div>
              </details>
            </li>
          ))}
        </ol>
        {!!discarded.length && (
          <details className="mt-2 text-meta text-muted">
            <summary className="cursor-pointer py-1">
              {discarded.length} reports discarded as not relevant
            </summary>
            <ul className="mt-1 grid gap-1 pl-4">
              {discarded.map((report) => (
                <li key={report.id} className="truncate" title={report.filterNote}>
                  <time dateTime={report.at} className="tabular-nums">
                    {clock(report.at)}
                  </time>{" "}
                  {report.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
