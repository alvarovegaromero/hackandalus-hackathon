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

// Each row carries its group hue as a left rail over a faint tint of the same hue.
const row = cva("group rounded-r-lg border-l-2 py-2 pr-2 pl-3 transition-colors", {
  variants: {
    priority: {
      critical: "border-critical bg-critical/[0.07] hover:bg-critical/[0.12]",
      high: "border-high bg-high/[0.06] hover:bg-high/[0.11]",
      medium: "border-medium bg-medium/[0.05] hover:bg-medium/[0.09]",
      low: "border-low bg-low/[0.06] hover:bg-low/[0.1]",
      unassessed: "border-unassessed bg-ink/[0.02] hover:bg-ink/[0.05]",
    },
    selected: { true: "ring-1 ring-ink/30", false: "" },
  },
});
const heading = cva("flex items-center gap-2 pb-1.5 text-meta font-medium", {
  variants: {
    priority: {
      critical: "text-critical",
      high: "text-high",
      medium: "text-medium",
      low: "text-muted",
      unassessed: "text-muted",
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
    <section className="glass flex h-full min-h-0 flex-col gap-2 p-4" aria-labelledby="queue-title">
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="queue-title" className="text-body font-medium text-muted">
          Incidents by priority
        </h2>
        {status !== "Live" && (
          <span role="status" className="flex items-center gap-1 text-meta">
            {!connecting && <TriangleAlert size={12} aria-hidden="true" />}
            {status}
          </span>
        )}
      </header>
      <div className="dashboard-scroll -mx-2 px-2">
        {!events.length &&
          (connecting ? (
            <TextSkeleton />
          ) : (
            <p className="text-meta text-muted">
              No active events. New reports appear here as they arrive.
            </p>
          ))}
        <ol className="grid gap-1" aria-live="polite" aria-relevant="additions">
          {events.map((event, index) => (
            <li key={event.id}>
              {/* Rows are sorted by priority: one heading per group replaces a label per row. */}
              {events[index - 1]?.priority !== event.priority && (
                <p
                  className={cn(heading({ priority: event.priority }), index > 0 && "mt-3")}
                  aria-hidden="true"
                >
                  <span className={mark({ priority: event.priority })} />
                  {PRIORITY_LABELS[event.priority]}
                  <span className="font-normal text-muted tabular-nums">
                    {events.filter((e) => e.priority === event.priority).length}
                  </span>
                </p>
              )}
              <details
                className={row({ priority: event.priority, selected: selectedId === event.id })}
              >
                <summary
                  className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2"
                  onClick={() => onSelect(event.id)}
                >
                  <span className="truncate text-body group-open:whitespace-normal">
                    <span className="sr-only">{PRIORITY_LABELS[event.priority]}: </span>
                    {event.summary}
                  </span>
                  <span className="text-meta text-muted tabular-nums">
                    {event.at ? <time dateTime={event.at}>{clock(event.at)}</time> : null}
                  </span>
                </summary>
                <div className="mt-1 grid gap-1 text-meta text-muted">
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
