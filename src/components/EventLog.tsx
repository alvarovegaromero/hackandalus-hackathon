"use client";

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
          {status} · {events.length} events
        </span>
      </div>
      <ol
        className="flex flex-col gap-1 flex-1 min-h-0 max-h-[480px] overflow-y-auto rounded-[16px] border border-line p-2 text-[12px] font-mono"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {events.length === 0 ? (
          <li className="p-2 text-blueprint-light">
            Waiting for events… run <code>npm run mock:events</code>
          </li>
        ) : null}
        {events.map((event) => (
          <li key={event.id} className={`rounded-md border p-2 ${event.tone}`}>
            <div className="flex flex-wrap gap-x-2">
              <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
              <span className="sr-only">{event.label}</span>
            </div>
            <p className="break-words">{event.title}</p>
            {priorities.find((item) => item.eventId === event.id)?.priority ? (
              <p
                className="mt-1 font-semibold"
                title={priorities.find((item) => item.eventId === event.id)?.rationale ?? undefined}
              >
                Priority: {priorities.find((item) => item.eventId === event.id)?.priority}
              </p>
            ) : null}
            {event.detail ? (
              <details className="mt-1">
                <summary className="cursor-pointer">Filter details</summary>
                <p className="mt-1 break-words">{event.detail}</p>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
