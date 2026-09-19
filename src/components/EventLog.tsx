"use client";

import { TextSkeleton } from "./Skeleton";
import { filterResultSchema } from "@/lib/contracts/filter";
import type { TelemetryRecord } from "@/lib/event-pipeline";

import type { CoordinatorState } from "@/lib/contracts/coordinator";

type EventRow = {
  id: string;
  at: string;
  title: string;
  label: string;
  tone: string;
  detail?: string;
  completed: boolean;
};

/** Fold newest-first SSE activity into one row per ingress event. */
export default function EventLog({
  records,
  status,
  priorities = [],
}: {
  records: TelemetryRecord[];
  status: string;
  priorities?: CoordinatorState["events"];
}) {
  const rows = new Map<string, EventRow>();
  for (const record of records) {
    if (
      !["event.accepted", "filtering.pending", "filtering.completed", "filtering.failed"].includes(
        record.type,
      )
    )
      continue;
    const row = rows.get(record.eventId) ?? {
      id: record.eventId,
      at: record.at,
      title: "Event",
      label: "Filtering…",
      tone: "border-neutral-200 bg-neutral-50 text-neutral-700",
      completed: false,
    };
    if (typeof record.payload.title === "string") row.title = record.payload.title;
    else if (typeof record.payload.description === "string" && row.title === "Event")
      row.title = record.payload.description;
    if (record.type === "event.accepted") row.at = record.at;
    // Pending/receipt frames never overwrite a terminal decision during replay.
    if (
      !row.completed &&
      (record.type === "filtering.completed" || record.type === "filtering.failed")
    ) {
      row.completed = true;
      const parsed = filterResultSchema.safeParse(record.payload.result);
      const result = parsed.success ? parsed.data : undefined;
      if (record.type === "filtering.failed" || !result || result.status === "unavailable") {
        row.label = "Filtering unavailable";
        row.tone = "border-amber-300 bg-amber-50 text-amber-900";
        row.detail =
          result?.failure?.message ??
          "Filtering could not complete. Check the server configuration and logs.";
      } else {
        const rejected = result.decision === "irrelevant";
        row.label = rejected ? "Rejected" : "Accepted";
        row.tone = rejected
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-emerald-300 bg-emerald-50 text-emerald-900";
        const probability = result.relevanceProbability;
        row.detail = `${probability === null ? "" : `Relevance: ${Math.round(probability * 100)}%. `}${result.decision === "uncertain" ? "Uncertain; passed for further assessment. " : ""}${result.summary}`;
      }
    }
    rows.set(record.eventId, row);
  }
  const events = [...rows.values()];
  return (
    <section aria-label="Event" className="flex flex-col gap-2 w-full h-[480px]">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[13px] font-medium">Event</h2>
        <span role="status" className="text-[12px] text-blueprint-light">
          {status !== "Live" ? `${status} · ` : ""}
          {events.length} events
        </span>
      </div>
      <ol
        className="flex flex-col gap-1 flex-1 min-h-0 max-h-[480px] overflow-y-auto text-[12px] font-mono"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {events.length === 0 && ["Connecting…", "Loading…"].includes(status) ? (
          <li>
            <TextSkeleton />
          </li>
        ) : events.length === 0 && status !== "Live" ? (
          <li className="p-2">{status}</li>
        ) : events.length === 0 ? (
          <li className="p-2 text-blueprint-light">
            Waiting for events… run <code>npm run mock:events</code>
          </li>
        ) : null}
        {events.map((event) => {
          const assessment = priorities.find((item) => item.eventId === event.id);
          const content = (
            <>
              <time className="shrink-0 tabular-nums opacity-70" dateTime={event.at}>
                {new Date(event.at).toLocaleTimeString()}
              </time>
              <span className="min-w-0 flex-1 truncate" title={event.title}>
                {event.title}
              </span>
              <span className="sr-only">{event.label}</span>
              {assessment?.priority && (
                <span
                  className="shrink-0 text-[10px] font-semibold"
                  title={assessment.rationale ?? undefined}
                >
                  {assessment.priority}
                </span>
              )}
            </>
          );
          return (
            <li key={event.id} className={`relative rounded-md border px-2 py-1.5 ${event.tone}`}>
              {event.detail ? (
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    {content}
                  </summary>
                  <p className="mt-2 break-words">{event.title}</p>
                  <p className="mt-1 break-words opacity-80">{event.detail}</p>
                </details>
              ) : (
                <div className="flex items-center gap-2">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
