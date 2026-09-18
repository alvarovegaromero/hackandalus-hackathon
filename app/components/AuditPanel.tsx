"use client";

// Registro cronológico: quién hizo qué, cuándo y sobre qué versión del plan.

import type { AuditEntry, Lesson } from "@/lib/types";
import { actorLabels, timeLabel } from "./shared";

interface Props {
  audit: AuditEntry[];
  /** Lecciones propuestas por ejecuciones anteriores, si el store ya las emite. */
  lessons: Lesson[] | undefined;
}

const lessonStatusLabels: Record<Lesson["status"], string> = {
  proposed: "Pendiente de validar",
  accepted: "Aceptada",
  rejected: "Descartada"
};

export default function AuditPanel({ audit, lessons }: Props) {
  const pending = lessons ?? [];

  return (
    <>
      {pending.length > 0 ? (
        <section className="lessons-box">
          <h3 className="section-head">Lecciones de ejecuciones anteriores ({pending.length})</h3>
          <ul className="mini-list">
            {pending.map((lesson) => (
              <li key={lesson.id} className="mini-row">
                <div>
                  <strong>{lesson.change}</strong>
                  <small>
                    {lesson.pattern} · {lesson.metric}
                  </small>
                </div>
                <span className={lesson.status === "accepted" ? "pill zone-stable" : "pill"}>
                  {lessonStatusLabels[lesson.status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted-note">
            Validar o descartar una lección todavía no tiene ruta en la API: aquí se muestran tal como llegan.
          </p>
        </section>
      ) : null}

      <div className="audit-list" role="log" aria-live="polite" aria-relevant="additions">
        {audit.length === 0 ? <p className="muted-note">Todavía no hay nada registrado.</p> : null}
        {audit.map((entry) => (
          <article key={entry.id} className={`audit-row actor-${entry.actor}`}>
            <span className="audit-time">{timeLabel(entry.at)}</span>
            <span className={`pill actor actor-${entry.actor}`}>{actorLabels[entry.actor]}</span>
            <div>
              <strong>{entry.summary}</strong>
              <small>
                {entry.kind} · plan v{entry.planVersion}
                {entry.ref ? ` · ${entry.ref}` : ""}
              </small>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
