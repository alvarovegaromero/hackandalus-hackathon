"use client";

import { useEffect, useReducer, useState } from "react";
import type { Channel, Signal } from "@/lib/signals/schema";
import { crisisMinutes } from "@/lib/scenario/clock";
import { advance, createState, factValue, fire, type EngineState } from "@/lib/scenario/engine";
import type { Effect, ScenarioEvent } from "@/lib/scenario/events";
import { sierraBermeja as pack } from "@/lib/scenario/packs/sierra-bermeja";

// Fixed seed so the demo can be rehearsed with the exact same signals.
const SEED = 2026;
const TICK_MS = 1000;

const channelNames: Record<Channel, string> = {
  citizen_call: "Llamada",
  sms: "SMS",
  sensor: "Sensor",
  verification: "Verificación",
};
const reportingSources = pack.sources.filter((s) => s.channel !== "verification");

type LogEntry = { id: string; label: string; atMin: number; manual: boolean };
type Sim = {
  engine: EngineState;
  elapsedMs: number;
  running: boolean;
  feed: Signal[];
  log: LogEntry[];
  error: string;
};
type Action =
  | { type: "tick" }
  | { type: "toggle" }
  | { type: "reset" }
  | { type: "fire"; event: string | ScenarioEvent };

const initial = (): Sim => ({
  engine: createState(pack, SEED),
  elapsedMs: 0,
  running: false,
  feed: [],
  log: [],
  error: "",
});

const labelOf = (id: string) => pack.events.find((e) => e.id === id)?.label ?? id;

function reduce(sim: Sim, action: Action): Sim {
  if (action.type === "toggle") return { ...sim, running: !sim.running };
  if (action.type === "reset") return initial();
  if (action.type === "tick") {
    const elapsedMs = sim.elapsedMs + TICK_MS;
    const step = advance(pack, sim.engine, crisisMinutes(elapsedMs));
    return {
      ...sim,
      elapsedMs,
      engine: step.state,
      feed: [...step.emitted.map((l) => l.signal).reverse(), ...sim.feed],
      log: [
        ...step.fired.map((id) => ({
          id,
          label: labelOf(id),
          atMin: pack.events.find((e) => e.id === id)!.atMin,
          manual: false,
        })),
        ...sim.log,
      ],
    };
  }
  try {
    const step = fire(pack, sim.engine, action.event);
    if (step.fired.length === 0) return { ...sim, error: "Ese evento ya se ha lanzado." };
    const label = typeof action.event === "string" ? labelOf(action.event) : action.event.label;
    return {
      ...sim,
      engine: step.state,
      feed: [...step.emitted.map((l) => l.signal).reverse(), ...sim.feed],
      log: [{ id: step.fired[0], label, atMin: sim.engine.nowMin, manual: true }, ...sim.log],
      error: "",
    };
  } catch {
    return { ...sim, error: "El evento no es válido para este escenario." };
  }
}

const minute = (m: number) => `T+${m.toFixed(1)}`;

function describe(signal: Signal) {
  const { body } = signal;
  if (body.type === "text") return body.text;
  return `${body.metric}: ${body.value}${body.unit ? ` ${body.unit}` : ""}`;
}

export function ScenarioPanel() {
  const [sim, dispatch] = useReducer(reduce, undefined, initial);
  const [improvised, setImprovised] = useState(0);
  const [factId, setFactId] = useState(pack.facts[0].id);
  const [value, setValue] = useState(String(pack.facts[0].alternatives[0] ?? ""));
  const [sourceId, setSourceId] = useState(reportingSources[0].id);
  const [count, setCount] = useState(3);
  const [hoax, setHoax] = useState(false);

  useEffect(() => {
    if (!sim.running) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), TICK_MS);
    return () => clearInterval(timer);
  }, [sim.running]);

  const fact = pack.facts.find((f) => f.id === factId)!;
  const numeric = typeof fact.initial === "number";
  const options = [...new Set([fact.initial, ...fact.alternatives])];
  const current = factValue(sim.engine, fact.id, sim.engine.nowMin);

  function chooseFact(id: string) {
    const next = pack.facts.find((f) => f.id === id)!;
    const now = factValue(sim.engine, id, sim.engine.nowMin);
    setFactId(id);
    setValue(String([next.initial, ...next.alternatives].find((v) => v !== now) ?? now));
  }

  function improvise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = numeric ? Number(value) : options.find((o) => String(o) === value);
    if (typed === undefined || Number.isNaN(typed)) return;
    const sourceIds = [sourceId];
    const effects: Effect[] = hoax
      ? [
          {
            type: "hoax",
            kind: fact.kind,
            entityLabel: fact.entityLabel,
            value: typed,
            location: fact.location,
            count,
            sourceIds,
          },
        ]
      : [
          { type: "set_fact", factId: fact.id, value: typed },
          { type: "witness", factId: fact.id, count, sourceIds },
        ];
    const id = `live-${improvised + 1}`;
    setImprovised(improvised + 1);
    dispatch({
      type: "fire",
      event: {
        id,
        atMin: 0,
        kind: "chaos",
        label: `${hoax ? "Bulo" : "Cambio"}: ${fact.entityLabel} → ${typed}`,
        effects,
      },
    });
  }

  return (
    <section className="panel scenario" aria-labelledby="scenario-title">
      <div className="entry-heading">
        <h2 id="scenario-title">Escenario: {pack.name}</h2>
        <span className="badge">DATOS SIMULADOS</span>
      </div>
      <p>
        Genera avisos ruidosos (retrasos, duplicados, bulos) a partir de una realidad oculta. 1
        minuto real equivale a 10 minutos de crisis. Semilla {SEED}.
      </p>
      <div className="buttons">
        <strong className="clock" aria-live="polite">
          {minute(sim.engine.nowMin)} / {pack.durationMin} min
        </strong>
        <button onClick={() => dispatch({ type: "toggle" })}>
          {sim.running
            ? "Pausar escenario"
            : sim.elapsedMs
              ? "Reanudar escenario"
              : "Iniciar escenario"}
        </button>
        <button className="secondary" onClick={() => dispatch({ type: "reset" })}>
          Reiniciar
        </button>
      </div>

      <div className="grid">
        <div>
          <h3>Eventos del guion</h3>
          <p>Lánzalos ahora, antes de su minuto previsto.</p>
          <div className="script">
            {pack.events.map((e) => (
              <button
                key={e.id}
                className="secondary"
                disabled={sim.engine.fired.includes(e.id)}
                onClick={() => dispatch({ type: "fire", event: e.id })}
              >
                {e.label} <small>({minute(e.atMin)})</small>
              </button>
            ))}
          </div>

          <h3>Improvisar evento</h3>
          <form onSubmit={improvise}>
            <label htmlFor="scenario-fact">Hecho (ahora: {String(current)})</label>
            <select id="scenario-fact" value={factId} onChange={(e) => chooseFact(e.target.value)}>
              {pack.facts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.entityLabel} ({f.kind})
                </option>
              ))}
            </select>
            <label htmlFor="scenario-value">Nuevo valor</label>
            {numeric ? (
              <input
                id="scenario-value"
                type="number"
                min={0}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <select id="scenario-value" value={value} onChange={(e) => setValue(e.target.value)}>
                {options.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            )}
            <label htmlFor="scenario-source">Quién avisa</label>
            <select
              id="scenario-source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {reportingSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {channelNames[s.channel]} · {s.id}
                </option>
              ))}
            </select>
            <label htmlFor="scenario-count">Número de avisos</label>
            <input
              id="scenario-count"
              type="number"
              min={1}
              max={20}
              required
              value={count}
              onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
            <label className="check">
              <input type="checkbox" checked={hoax} onChange={(e) => setHoax(e.target.checked)} />
              Es un bulo (no cambia la realidad)
            </label>
            {sim.error && <p role="alert">{sim.error}</p>}
            <button type="submit">Lanzar evento improvisado</button>
          </form>

          <h3>Eventos lanzados</h3>
          {sim.log.length === 0 && <p>Todavía ninguno.</p>}
          <ul className="log">
            {sim.log.map((l) => (
              <li key={l.id}>
                <small>{minute(l.atMin)}</small> {l.label}
                {l.manual && <span className="badge">MANUAL</span>}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Avisos recibidos ({sim.feed.length})</h3>
          {sim.feed.length === 0 && (
            <div className="empty">Inicia el escenario para recibir avisos.</div>
          )}
          <ol className="feed">
            {sim.feed.map((s) => (
              <li key={s.id}>
                <small>
                  {minute(s.receivedAtMin)} · {channelNames[s.channel]} · {s.location.placeName}
                </small>
                <p>{describe(s)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
