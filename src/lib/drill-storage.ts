// OWNER: emergency drill sandbox.

import { z } from "zod";
import { drillRunSchema, type DrillRun } from "./emergency-drills";

export const DRILL_STORAGE_KEY = "faro.emergency-drills.v1";
export const drillNotebookSchema = z
  .object({
    version: z.literal(1),
    active: drillRunSchema.nullable(),
    history: z.array(drillRunSchema).max(20),
  })
  .refine(
    (notebook) =>
      (notebook.active === null || notebook.active.status === "running") &&
      notebook.history.every((run) => run.status === "completed") &&
      new Set(notebook.history.map((run) => run.id)).size === notebook.history.length,
  );
export type DrillNotebook = z.infer<typeof drillNotebookSchema>;
export const EMPTY_NOTEBOOK: DrillNotebook = { version: 1, active: null, history: [] };

export function readDrillNotebook(raw: string | null): DrillNotebook {
  return raw ? drillNotebookSchema.parse(JSON.parse(raw)) : EMPTY_NOTEBOOK;
}

export function storeDrillRun(notebook: DrillNotebook, run: DrillRun): DrillNotebook {
  if (run.status === "running") return { ...notebook, active: run };
  return {
    version: 1,
    active: notebook.active?.id === run.id ? null : notebook.active,
    history: [run, ...notebook.history.filter((previous) => previous.id !== run.id)]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, 20),
  };
}
