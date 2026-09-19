"use client";

import { useEffect, useState } from "react";
import type { TelemetryRecord } from "@/lib/event-pipeline";

const MAX_RECORDS = 400;

/** One read-only SSE subscription to GET /api/telemetry; newest records first. */
export function useTelemetry() {
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [status, setStatus] = useState("Connecting…");

  useEffect(() => {
    // EventSource reconnects on its own and resends the last event ID.
    const source = new EventSource("/api/telemetry");
    source.onopen = () => setStatus("Loading…");
    source.addEventListener("ready", () => setStatus("Live"));
    source.addEventListener("unavailable", () => setStatus("Unavailable · retrying…"));
    source.onerror = () => setStatus("Reconnecting…");
    source.onmessage = (message) => {
      const record = JSON.parse(message.data) as TelemetryRecord;
      setRecords((previous) =>
        previous.some((item) => item.id === record.id)
          ? previous
          : [record, ...previous].slice(0, MAX_RECORDS),
      );
    };
    source.addEventListener("reset", () => {
      setRecords([]);
      setStatus("Loading…");
    });
    return () => source.close();
  }, []);

  return { records, status };
}
