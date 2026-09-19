"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TelemetryRecord } from "@/lib/event-pipeline";

export default function TelemetryPage() {
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [status, setStatus] = useState("Conectando…");
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    let cursor: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Replay recent history on each page load. A cursor alone in localStorage
    // would skip the history that the page no longer has in memory.
    const connect = async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        setStatus("Conectando…");
        const response = await fetch("/api/telemetry", {
          signal: abort.signal,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(cursor ? { "Last-Event-ID": cursor } : {}),
          },
        });
        if (!response.ok || !response.body) {
          setStatus(`Conexión rechazada (HTTP ${response.status}). Revisa el token.`);
          return;
        }
        setStatus("En directo");
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!abort.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.startsWith("event: reset")) {
              cursor = undefined;
              setRecords([]);
              continue;
            }
            const data = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            const record = JSON.parse(data.slice(6)) as TelemetryRecord;
            cursor = record.id;
            setRecords((previous) =>
              previous.some((item) => item.id === record.id)
                ? previous
                : [...previous, record].slice(-500),
            );
          }
        }
      } catch {
        if (abort.signal.aborted) return;
      } finally {
        await reader?.cancel().catch(() => undefined);
      }
      if (!abort.signal.aborted) {
        setStatus("Reconectando…");
        timer = setTimeout(connect, 1500);
      }
    };
    void connect();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [token]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FARO · Telemetría de entrada</p>
          <h1>Registro de eventos</h1>
        </div>
        <Link href="/">Centro de mando</Link>
      </header>
      <p role="status">
        {status} · {records.length} registros visibles
      </p>
      <p className="banner warning">
        Almacenamiento en memoria. Supabase y filtrado pendientes; no se ha ejecutado ningún LLM en
        este flujo.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (draftToken !== token) setRecords([]);
          setToken(draftToken);
        }}
        style={{ marginBlock: 16 }}
      >
        <label htmlFor="telemetry-token">Token de API (solo si está configurado)</label>{" "}
        <input
          id="telemetry-token"
          type="password"
          autoComplete="off"
          value={draftToken}
          onChange={(event) => setDraftToken(event.target.value)}
        />{" "}
        <button type="submit">Conectar</button>
      </form>
      <p>
        Envía eventos con <code>npm run mock:events</code>. Esta pantalla solo lee el SSE.
      </p>
      <section aria-label="Registros de telemetría">
        {records.length === 0 ? <p>Esperando eventos…</p> : null}
        {records.map((record) => (
          <article className="panel" key={record.id} style={{ marginBlock: 12, padding: 16 }}>
            <strong>{record.type}</strong>
            {" · "}
            <time dateTime={record.at}>{record.at}</time>
            <p>
              Evento: <code>{record.eventId}</code>
            </p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          </article>
        ))}
      </section>
    </main>
  );
}
