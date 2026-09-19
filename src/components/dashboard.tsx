"use client";

import { useState } from "react";
import {
  crisisEventSchema,
  simulatePlan,
  type CrisisEvent,
  type Plan,
  type ActionStatus,
} from "@/lib/domain";
import { ScenarioPanel } from "./scenario-panel";

export type Entry = { event: CrisisEvent; plan: Plan; status: ActionStatus; note?: string };
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
      setError("Enter an event between 1 and 2000 characters.");
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
          <p className="eyebrow">HACKSPAIN 2026 / OPERATIONS CENTER</p>
          <h1>
            Butterfish<span>.</span>
          </h1>
          <p>Understand the situation. Coordinate the response.</p>
        </div>
        <span className="badge">LOCAL SIMULATION</span>
      </header>
      <aside>
        No external connections: temporary data in this browser, deterministic decisions, and
        simulated actions. The Sierra Bermeja fire scenario generates simulated alerts.
      </aside>
      <section className="metrics" aria-label="Simulation status">
        <article>
          <small>EVENTS RECEIVED</small>
          <strong>{entries.length}</strong>
        </article>
        <article>
          <small>CURRENT PRIORITY</small>
          <strong>{entries[0]?.plan.priority ?? "No events"}</strong>
        </article>
        <article>
          <small>HUMAN CONTROL</small>
          <strong>{paused ? "Paused" : "Active"}</strong>
        </article>
      </section>
      <div className="grid">
        <section className="panel">
          <h2>New event</h2>
          <p>Enter new information to review pending proposals.</p>
          <form onSubmit={injectEvent}>
            <label htmlFor="summary">What has changed?</label>
            <textarea
              id="summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              required
              placeholder="E.g.: access to the affected area has been cut off."
            />
            <label htmlFor="severity">Severity</label>
            <select
              id="severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as CrisisEvent["severity"])}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            {error && <p role="alert">{error}</p>}
            <button type="submit">Inject demo event</button>
          </form>
          <hr />
          <h2>Human intervention</h2>
          <p>Pausing blocks simulated execution. You can continue receiving events.</p>
          <button className="secondary" onClick={() => setPaused(!paused)}>
            {paused ? "Resume simulation" : "Pause simulation"}
          </button>
        </section>
        <section className="panel activity" aria-live="polite">
          <h2>Activity and decisions</h2>
          <p>New events supersede pending proposals.</p>
          {entries.length === 0 && (
            <div className="empty">
              Waiting for the first event.
              <br />
              Simulation activity will appear here.
            </div>
          )}
          {entries.map(({ event, plan, status, note }) => (
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
                    Simulate action
                  </button>
                  <button className="secondary" onClick={() => updateStatus(event.id, "cancelled")}>
                    Cancel
                  </button>
                </div>
              )}
              {note && <small>{note}</small>}
              {status === "simulated" && (
                <small>Simulation completed. No communication was sent.</small>
              )}
            </article>
          ))}
        </section>
      </div>
      <ScenarioPanel onAgentEntries={(fresh) => setEntries((current) => [...fresh, ...current])} />
      <footer>
        AI SDK · Workflow · Supabase · HappyRobot — live connections pending configuration
      </footer>
    </main>
  );
}
