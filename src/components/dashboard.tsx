"use client";

import { useState } from "react";
import {
  crisisEventSchema,
  simulatePlan,
  type CrisisEvent,
  type Plan,
  type ActionStatus,
} from "@/lib/domain";

type Entry = { event: CrisisEvent; plan: Plan; status: ActionStatus };
const incidentId = "11111111-1111-4111-8111-111111111111";

export function Dashboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<CrisisEvent["severity"]>("medium");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");

  function injectEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = crisisEventSchema.safeParse({
      id: crypto.randomUUID(),
      incidentId,
      summary,
      severity,
      source: "operator",
    });
    if (!parsed.success) {
      setError("Escribe un evento de entre 1 y 2000 caracteres.");
      return;
    }
    setError("");
    setEntries((current) => [
      { event: parsed.data, plan: simulatePlan(parsed.data), status: "proposed" },
      ...current.map((entry): Entry =>
        entry.status === "proposed" ? { ...entry, status: "cancelled" } : entry,
      ),
    ]);
    setSummary("");
  }

  function updateStatus(id: string, status: ActionStatus) {
    setEntries((current) =>
      current.map((entry) => (entry.event.id === id ? { ...entry, status } : entry)),
    );
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">HACKSPAIN 2026 / CENTRO DE OPERACIONES</p>
          <h1>
            Butterfish<span>.</span>
          </h1>
          <p>Entender la situación. Coordinar la respuesta.</p>
        </div>
        <span className="badge">SIMULACIÓN LOCAL</span>
      </header>
      <aside>
        Sin conexiones externas: datos temporales en este navegador, decisiones deterministas y
        acciones simuladas. El escenario de crisis está pendiente de definir.
      </aside>
      <section className="metrics" aria-label="Estado de la simulación">
        <article>
          <small>EVENTOS RECIBIDOS</small>
          <strong>{entries.length}</strong>
        </article>
        <article>
          <small>PRIORIDAD ACTUAL</small>
          <strong>{entries[0]?.plan.priority ?? "Sin eventos"}</strong>
        </article>
        <article>
          <small>CONTROL HUMANO</small>
          <strong>{paused ? "En pausa" : "Activo"}</strong>
        </article>
      </section>
      <div className="grid">
        <section className="panel">
          <h2>Nuevo evento</h2>
          <p>Introduce información nueva para revisar las propuestas pendientes.</p>
          <form onSubmit={injectEvent}>
            <label htmlFor="summary">¿Qué ha cambiado?</label>
            <textarea
              id="summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              required
              placeholder="Ej.: se ha cortado el acceso a la zona afectada."
            />
            <label htmlFor="severity">Severidad</label>
            <select
              id="severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as CrisisEvent["severity"])}
            >
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </select>
            {error && <p role="alert">{error}</p>}
            <button type="submit">Inyectar evento de demo</button>
          </form>
          <hr />
          <h2>Intervención humana</h2>
          <p>La pausa bloquea la ejecución simulada. Puedes seguir recibiendo eventos.</p>
          <button className="secondary" onClick={() => setPaused(!paused)}>
            {paused ? "Reanudar simulación" : "Pausar simulación"}
          </button>
        </section>
        <section className="panel" aria-live="polite">
          <h2>Actividad y decisiones</h2>
          <p>Los nuevos eventos sustituyen las propuestas que siguen pendientes.</p>
          {entries.length === 0 && (
            <div className="empty">
              Esperando el primer evento.
              <br />
              La actividad de la simulación aparecerá aquí.
            </div>
          )}
          {entries.map(({ event, plan, status }) => (
            <article className="entry" key={event.id}>
              <div className="entry-heading">
                <span className="badge">{plan.priority}</span>
                <small>{status}</small>
              </div>
              <h3>{event.summary}</h3>
              <p>{plan.rationale}</p>
              <p>{plan.actions[0].description}</p>
              {status === "proposed" && (
                <div className="buttons">
                  <button disabled={paused} onClick={() => updateStatus(event.id, "simulated")}>
                    Simular acción
                  </button>
                  <button className="secondary" onClick={() => updateStatus(event.id, "cancelled")}>
                    Cancelar
                  </button>
                </div>
              )}
              {status === "simulated" && (
                <small>Simulación completada. No se ha enviado ninguna comunicación.</small>
              )}
            </article>
          ))}
        </section>
      </div>
      <footer>
        AI SDK · Workflow · Supabase · HappyRobot — conexiones reales pendientes de configurar
      </footer>
    </main>
  );
}
