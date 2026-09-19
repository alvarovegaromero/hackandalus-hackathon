"use client";

import { useEffect, useState } from "react";
import type { TelemetryRecord } from "@/lib/event-pipeline";

const MAX_ROWS = 200;

/** Live log of accepted events, streamed from GET /api/telemetry (read-only SSE). */
export default function EventLog() {
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [status, setStatus] = useState("Connecting…");

  useEffect(() => {
    // EventSource reconnects on its own and resends the last event ID.
    const source = new EventSource("/api/telemetry");
    source.onopen = () => setStatus("Live");
    source.onerror = () => setStatus("Reconnecting…");
    source.onmessage = (message) => {
      const record = JSON.parse(message.data) as TelemetryRecord;
      setRecords((previous) =>
        previous.some((item) => item.id === record.id)
          ? previous
          : [record, ...previous].slice(0, MAX_ROWS),
      );
    };
    source.addEventListener("reset", () => setRecords([]));
    return () => source.close();
  }, []);

  return (
    <section aria-label="Event log" className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[13px] font-medium">Event log</h2>
        <span role="status" className="text-[12px] text-blueprint-light">
          {status} · {records.length} records
        </span>
      </div>
      <ol className="flex flex-col gap-1 max-h-[480px] overflow-y-auto rounded-[16px] border border-line p-2 text-[12px] font-mono">
        {records.length === 0 ? (
          <li className="p-2 text-blueprint-light">
            Waiting for events… run <code>npm run mock:events</code>
          </li>
        ) : null}
        {records.map((record) => (
          <li key={record.id} className="rounded-md bg-neutral-50 p-2">
            <div className="flex flex-wrap gap-x-2">
              <time dateTime={record.at}>{new Date(record.at).toLocaleTimeString()}</time>
              <strong>{record.type}</strong>
              <span className="text-blueprint-light">{record.eventId.slice(0, 8)}</span>
            </div>
            <div className="break-words">
              {[
                record.payload.title,
                record.payload.severity,
                record.payload.zoneId,
                record.payload.reason,
              ]
                .filter((value): value is string => typeof value === "string")
                .join(" · ")}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
