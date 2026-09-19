"use client";

import { useState } from "react";
import type { DrillRun } from "@/lib/emergency-drills";
import {
  drillMarkdown,
  drillObjectives,
  traceJsonl,
  trainingCandidates,
} from "@/lib/drill-learning";
import styles from "./drill-learning.module.css";

export function downloadDrillArtifact(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DrillLearningExports({ run }: { run: DrillRun }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (run.modelVersion !== 3)
    return (
      <p>
        Historical models retain their original JSON report. Rehearse again for audited model 3
        outputs.
      </p>
    );
  const objectives = drillObjectives(run);
  async function exportArtifact(
    kind: "markdown" | "trace" | "candidates" | "context" | "evaluation",
  ) {
    setError(null);
    setBusy(true);
    try {
      const stem = `faro-drill-${run.id}`;
      if (kind === "markdown")
        downloadDrillArtifact(`${stem}.md`, drillMarkdown(run), "text/markdown");
      if (kind === "trace")
        downloadDrillArtifact(`${stem}-traces.jsonl`, traceJsonl(run), "application/x-ndjson");
      if (kind === "candidates")
        downloadDrillArtifact(
          `${stem}-candidates.jsonl`,
          trainingCandidates(run)
            .map((row) => JSON.stringify(row))
            .join("\n") + "\n",
          "application/x-ndjson",
        );
      if (kind === "context") {
        const { reviewedDrillContext } = await import("@/lib/drill-agent-context");
        const records = reviewedDrillContext(run);
        if (!records.length)
          throw new Error("Approve at least one lesson after reviewing its evidence.");
        downloadDrillArtifact(
          `${stem}-reviewed-context.json`,
          JSON.stringify(records, null, 2),
          "application/json",
        );
      }
      if (kind === "evaluation") {
        const { evaluateDrillPolicies } = await import("@/lib/drill-evaluation");
        downloadDrillArtifact(
          `faro-${run.config.hazard}-policy-evaluation.json`,
          JSON.stringify(evaluateDrillPolicies(run.config.hazard), null, 2),
          "application/json",
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.exports} aria-label="Learning outputs">
      <h3>Auditable learning outputs</h3>
      <p>
        Model 3 · seed {run.config.scenario?.seed} · policy {run.policyVersion}. Objectives (
        {objectives.status}): coverage {objectives.coverageMet ? "met" : "not met"}; waiting
        exposure {objectives.exposureMet ? "met" : "not met"}. Occupied team-minutes:{" "}
        {objectives.teamBusyMinutes?.toFixed(2)}.
      </p>
      <div className={styles.buttons}>
        <button type="button" disabled={busy} onClick={() => void exportArtifact("markdown")}>
          Markdown debrief
        </button>
        <button type="button" disabled={busy} onClick={() => void exportArtifact("trace")}>
          Decision traces JSONL
        </button>
        <button type="button" disabled={busy} onClick={() => void exportArtifact("candidates")}>
          Candidate examples JSONL
        </button>
        <button
          type="button"
          disabled={busy || run.status !== "completed"}
          onClick={() => void exportArtifact("context")}
        >
          Reviewed context JSON
        </button>
        <button type="button" disabled={busy} onClick={() => void exportArtifact("evaluation")}>
          Reserved wildfire evaluation
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        Exports are synthetic reference data. Candidate decisions remain unreviewed. The evaluation
        uses fixed, separate scenario families; it does not score this manual run or prove
        real-world improvement. No model training or operational calls.
      </p>
    </section>
  );
}
