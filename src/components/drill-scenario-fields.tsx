"use client";

import { DEFAULT_SCENARIO, type DrillScenario } from "@/lib/drill-scenario";
import styles from "./drill-learning.module.css";

const fields = [
  { key: "seed", label: "Deterministic seed", min: 0, max: 4294967295, step: 1 },
  { key: "careShare", label: "Care-quarter population share", min: 0.1, max: 0.4, step: 0.05 },
  { key: "careTravelMultiplier", label: "Care access multiplier", min: 1, max: 2, step: 0.25 },
  { key: "mainTravelMinutes", label: "Main travel (minutes)", min: 2, max: 4, step: 1 },
  {
    key: "alternativeTravelMinutes",
    label: "Alternative travel (minutes)",
    min: 4,
    max: 6,
    step: 1,
  },
  { key: "serviceMinutes", label: "Service occupation (minutes)", min: 0.5, max: 2, step: 0.125 },
] as const;

export default function DrillScenarioFields({
  value = DEFAULT_SCENARIO,
  onChange,
}: {
  value?: DrillScenario;
  onChange: (value: DrillScenario) => void;
}) {
  return (
    <details className={styles.configuration}>
      <summary>Ad hoc conditions & objectives</summary>
      <p>Scenario v1. Seed varies initial risk and travel delay; no live data.</p>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            required
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number.isNaN(value[field.key]) ? "" : value[field.key]}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.valueAsNumber })}
          />
        </label>
      ))}
      <p>
        Fixed visual milestones: road closure T+5; network loss T+10; aftershock / wind shift T+15.
      </p>
      <label>
        Unbriefed capacity after network loss
        <input
          required
          type="number"
          min={0.5}
          max={1}
          step={0.1}
          value={
            Number.isNaN(value.events.unbriefedCapacityMultiplier)
              ? ""
              : value.events.unbriefedCapacityMultiplier
          }
          onChange={(event) =>
            onChange({
              ...value,
              events: { ...value.events, unbriefedCapacityMultiplier: event.target.valueAsNumber },
            })
          }
        />
      </label>
      <label>
        Escalation risk increase
        <input
          required
          type="number"
          min={5}
          max={25}
          step={1}
          value={Number.isNaN(value.events.escalationRisk) ? "" : value.events.escalationRisk}
          onChange={(event) =>
            onChange({
              ...value,
              events: { ...value.events, escalationRisk: event.target.valueAsNumber },
            })
          }
        />
      </label>
      <label>
        Minimum coverage objective (%)
        <input
          required
          type="number"
          min={0}
          max={100}
          step={1}
          value={
            Number.isNaN(value.objectives.minimumCoverage) ? "" : value.objectives.minimumCoverage
          }
          onChange={(event) =>
            onChange({
              ...value,
              objectives: { ...value.objectives, minimumCoverage: event.target.valueAsNumber },
            })
          }
        />
      </label>
      <label>
        Maximum waiting exposure per person
        <input
          required
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={
            Number.isNaN(value.objectives.maximumExposurePerPerson)
              ? ""
              : value.objectives.maximumExposurePerPerson
          }
          onChange={(event) =>
            onChange({
              ...value,
              objectives: {
                ...value.objectives,
                maximumExposurePerPerson: event.target.valueAsNumber,
              },
            })
          }
        />
      </label>
    </details>
  );
}
