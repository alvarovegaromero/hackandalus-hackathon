// OWNER: emergency drill sandbox.

import { z } from "zod";

export const drillConfigSchema = z.object({
  hazard: z.enum(["earthquake", "wildfire"]),
  locality: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  severity: z.enum(["moderate", "severe", "extreme"]),
  population: z.number().int().min(50).max(10000),
  teams: z.number().int().min(2).max(20),
});

export type DrillConfig = z.infer<typeof drillConfigSchema>;
export type Hazard = DrillConfig["hazard"];
export const actionIds = ["assess", "protect", "evacuate", "reroute", "notify"] as const;
export type DrillAction = (typeof actionIds)[number];
export const sectorIds = ["residential", "care", "central"] as const;
export type SectorId = (typeof sectorIds)[number];

export const LOCALITIES = [
  { name: "Granada", latitude: 37.1773, longitude: -3.5986 },
  { name: "Lorca", latitude: 37.6712, longitude: -1.7017 },
  { name: "Estepona", latitude: 36.4276, longitude: -5.1459 },
] as const;

export const DEFAULT_DRILL: DrillConfig = {
  hazard: "earthquake",
  locality: "Granada",
  latitude: 37.1773,
  longitude: -3.5986,
  severity: "severe",
  population: 600,
  teams: 6,
};

export const ACTIONS: Record<DrillAction, { label: string; teams: number; description: string }> = {
  assess: {
    label: "Assess buildings",
    teams: 1,
    description: "Inspect this sector. Required before earthquake evacuation.",
  },
  protect: {
    label: "Secure the sector",
    teams: 2,
    description: "Establish a safety perimeter; reduce this sector's exercise risk.",
  },
  evacuate: {
    label: "Move to assembly point",
    teams: 2,
    description: "Simulate assisted evacuation using the available route.",
  },
  reroute: {
    label: "Open an alternative route",
    teams: 1,
    description: "Restore exercise access after a blocked road.",
  },
  notify: {
    label: "Brief the community",
    teams: 0,
    description: "Practice a warning, or switch to radio after the network outage.",
  },
};

const count = z.number().int().nonnegative();
const sectorSchema = z.object({
  id: z.enum(sectorIds),
  name: z.string().max(80),
  population: count.max(10000),
  evacuated: count.max(10000),
  risk: count.max(100),
  assessed: z.boolean(),
  protected: z.boolean(),
});
export type DrillSector = z.infer<typeof sectorSchema>;

const entrySchema = z.object({
  id: z.string().max(100),
  minute: count.max(20),
  kind: z.enum(["event", "decision"]),
  text: z.string().max(500),
  action: z.enum(actionIds).optional(),
  sectorId: z.enum(sectorIds).optional(),
  teams: count.max(20).optional(),
  moved: count.max(10000).optional(),
});

export const drillRunSchema = z
  .object({
    id: z.string().uuid(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    config: drillConfigSchema,
    phase: count.max(4),
    status: z.enum(["running", "completed"]),
    teamsAvailable: count.max(20),
    routeOpen: z.boolean(),
    communicationsDown: z.boolean(),
    warned: z.boolean(),
    sectors: z.array(sectorSchema).length(3),
    log: z.array(entrySchema).max(100),
    notes: z.string().max(2000),
  })
  .refine(
    (run) =>
      run.sectors.reduce((sum, sector) => sum + sector.population, 0) === run.config.population &&
      run.sectors.every((sector) => sector.evacuated <= sector.population) &&
      new Set(run.sectors.map((sector) => sector.id)).size === 3 &&
      run.teamsAvailable <= run.config.teams &&
      (run.status === "completed"
        ? run.phase === 4 && run.completedAt !== null
        : run.phase < 4 && run.completedAt === null),
  );

export type DrillRun = z.infer<typeof drillRunSchema>;
export interface DrillLesson {
  id: string;
  title: string;
  evidence: string;
  recommendation: string;
  action: DrillAction;
}

export const PHASE_NAMES = [
  "Initial impact",
  "Access disrupted",
  "Communications lost",
  "Escalation",
  "Debrief",
];
const severityRisk = { moderate: 30, severe: 50, extreme: 70 };

function addEntry(run: DrillRun, entry: Omit<DrillRun["log"][number], "id" | "minute">): DrillRun {
  return {
    ...run,
    log: [...run.log, { ...entry, id: `${run.id}-${run.log.length}`, minute: run.phase * 5 }],
  };
}

export function createDrill(config: DrillConfig, id: string, now: string): DrillRun {
  const validated = drillConfigSchema.parse(config);
  const residential = Math.floor(validated.population * 0.55);
  const care = Math.floor(validated.population * 0.2);
  const populations = [residential, care, validated.population - residential - care];
  const names = ["Residential quarter", "Care & school quarter", "Town centre"];
  const run: DrillRun = {
    id,
    startedAt: now,
    completedAt: null,
    config: validated,
    phase: 0,
    status: "running",
    teamsAvailable: validated.teams,
    routeOpen: true,
    communicationsDown: false,
    warned: false,
    sectors: sectorIds.map((sectorId, index) => ({
      id: sectorId,
      name: names[index],
      population: populations[index],
      evacuated: 0,
      risk: Math.min(100, severityRisk[validated.severity] + (index === 1 ? 12 : index * 4)),
      assessed: false,
      protected: false,
    })),
    log: [],
    notes: "",
  };
  return drillRunSchema.parse(
    addEntry(run, {
      kind: "event",
      text:
        validated.hazard === "earthquake"
          ? `Simulated earthquake in ${validated.locality}. Building safety is unverified.`
          : `Simulated wildfire approaches ${validated.locality}. Smoke threatens the residential edge.`,
    }),
  );
}

export function actionUnavailable(
  run: DrillRun,
  action: DrillAction,
  sectorId: SectorId,
): string | null {
  if (run.status !== "running") return "This exercise has ended.";
  const sector = run.sectors.find((item) => item.id === sectorId);
  if (!sector) return "Select a sector.";
  if (run.teamsAvailable < ACTIONS[action].teams)
    return "Not enough available teams in this phase.";
  const repeated = run.log.some(
    (entry) =>
      entry.kind === "decision" &&
      entry.action === action &&
      entry.minute === run.phase * 5 &&
      (action === "notify" || action === "reroute" || entry.sectorId === sectorId),
  );
  if (repeated) return "Already practiced in this phase.";
  if (action === "assess" && sector.assessed) return "Sector already assessed.";
  if (action === "protect" && sector.protected) return "Safety perimeter already established.";
  if (action === "reroute" && run.routeOpen) return "The exercise route is open.";
  if (action === "evacuate") {
    if (!run.routeOpen) return "Open an alternative route first.";
    if (run.config.hazard === "earthquake" && !sector.assessed)
      return "Assess building safety first.";
    if (sector.evacuated === sector.population)
      return "Everyone in this sector is at the assembly point.";
  }
  if (action === "notify" && run.warned)
    return "The current communications channel is already briefed.";
  return null;
}

export function applyDrillAction(run: DrillRun, action: DrillAction, sectorId: SectorId): DrillRun {
  const reason = actionUnavailable(run, action, sectorId);
  if (reason) throw new Error(reason);
  const capacity =
    run.config.severity === "extreme" ? 50 : run.config.severity === "severe" ? 70 : 90;
  let moved = 0;
  const sectors = run.sectors.map((sector) => {
    if (sector.id !== sectorId) return sector;
    moved =
      action === "evacuate"
        ? Math.min(sector.population - sector.evacuated, capacity + (run.warned ? 20 : 0))
        : 0;
    return {
      ...sector,
      assessed: sector.assessed || action === "assess",
      protected: sector.protected || action === "protect",
      evacuated: sector.evacuated + moved,
      risk: Math.max(0, sector.risk - (action === "protect" ? 20 : 0)),
    };
  });
  const sectorName = sectors.find((sector) => sector.id === sectorId)?.name;
  const detail =
    action === "evacuate"
      ? `${moved} simulated people reached the assembly point.`
      : action === "notify"
        ? run.communicationsDown
          ? "Radio fallback practiced."
          : "Exercise warning practiced."
        : action === "reroute"
          ? "Exercise access restored."
          : `${sectorName}.`;
  return addEntry(
    {
      ...run,
      sectors,
      teamsAvailable: run.teamsAvailable - ACTIONS[action].teams,
      routeOpen: run.routeOpen || action === "reroute",
      warned: run.warned || action === "notify",
    },
    {
      kind: "decision",
      action,
      sectorId,
      teams: ACTIONS[action].teams,
      moved,
      text: `${ACTIONS[action].label}: ${detail}`,
    },
  );
}

export function advanceDrill(run: DrillRun, now: string): DrillRun {
  if (run.status !== "running") return run;
  const phase = run.phase + 1;
  if (phase === 4) {
    return addEntry(
      { ...run, phase, status: "completed", completedAt: now },
      {
        kind: "event",
        text: "Exercise completed. Review decisions and lessons before the next rehearsal.",
      },
    );
  }
  const text =
    phase === 1
      ? run.config.hazard === "earthquake"
        ? "Debris blocks the main access road. Practice an alternative route."
        : "The fire crosses the main access road. Practice an alternative route."
      : phase === 2
        ? "Mobile network unavailable. Previous warnings need a radio fallback."
        : run.config.hazard === "earthquake"
          ? "An aftershock invalidates building assessments. Reassess before moving people."
          : "A wind shift increases exposure. Recheck the remaining population.";
  return addEntry(
    {
      ...run,
      phase,
      teamsAvailable: run.config.teams,
      routeOpen: phase === 1 ? false : run.routeOpen,
      communicationsDown: phase >= 2,
      warned: phase === 2 ? false : run.warned,
      sectors: run.sectors.map((sector) => ({
        ...sector,
        assessed: phase === 3 && run.config.hazard === "earthquake" ? false : sector.assessed,
        risk: Math.min(
          100,
          sector.risk + (sector.protected ? 3 : 10) + (run.config.severity === "extreme" ? 5 : 0),
        ),
      })),
    },
    { kind: "event", text },
  );
}

export function drillMetrics(run: DrillRun) {
  const evacuated = run.sectors.reduce((sum, sector) => sum + sector.evacuated, 0);
  const firstDecision = run.log.find((entry) => entry.kind === "decision");
  return {
    evacuated,
    remaining: run.config.population - evacuated,
    coverage: Math.round((evacuated / run.config.population) * 100),
    decisions: run.log.filter((entry) => entry.kind === "decision").length,
    firstDecisionMinute: firstDecision?.minute ?? null,
  };
}

export function drillLessons(run: DrillRun): DrillLesson[] {
  const decisions = run.log.filter((entry) => entry.kind === "decision");
  const metrics = drillMetrics(run);
  const route = decisions.find((entry) => entry.action === "reroute" && entry.minute >= 5);
  const fallback = decisions.find((entry) => entry.action === "notify" && entry.minute >= 10);
  const lessons: DrillLesson[] = [
    {
      id: "access",
      title:
        route?.minute === 5
          ? "Alternative access restored promptly"
          : "Prepare an alternative access route",
      evidence: route
        ? `Road closed at T+5; route action recorded at T+${route.minute}.`
        : "Road closed at T+5; no alternative route was recorded.",
      recommendation: "Reserve one team for alternative access when the road closes.",
      action: "reroute",
    },
    {
      id: "communications",
      title:
        fallback?.minute === 10
          ? "Radio fallback practiced on time"
          : "Rehearse communications fallback",
      evidence: fallback
        ? `Network lost at T+10; radio briefing at T+${fallback.minute}.`
        : "Network lost at T+10; no radio briefing was recorded.",
      recommendation: "Repeat the community briefing over radio after a network outage.",
      action: "notify",
    },
    {
      id: "coverage",
      title: metrics.remaining
        ? "Revisit assisted evacuation capacity"
        : "Assembly-point coverage completed",
      evidence: `${metrics.evacuated} of ${run.config.population} simulated people reached the assembly point.`,
      recommendation: "Prioritize the care quarter and compare team capacity in another rehearsal.",
      action: "evacuate",
    },
  ];
  if (run.config.hazard === "earthquake") {
    const reassessed = decisions.filter(
      (entry) => entry.action === "assess" && entry.minute === 15,
    ).length;
    lessons.push({
      id: "reassessment",
      title: "Reassess after an aftershock",
      evidence: `${reassessed} of 3 sectors reassessed after the T+15 aftershock.`,
      recommendation: "Reserve assessment capacity before resuming assisted evacuation.",
      action: "assess",
    });
  } else {
    const protectedCount = run.sectors.filter((sector) => sector.protected).length;
    lessons.push({
      id: "perimeters",
      title: "Prepare for a wind shift",
      evidence: `${protectedCount} of 3 sectors had a safety perimeter at the end of the exercise.`,
      recommendation: "Practice securing exposed sectors before the T+15 wind shift.",
      action: "protect",
    });
  }
  return lessons;
}

export function comparableDrills(config: DrillConfig, history: DrillRun[]): DrillRun[] {
  return history.filter(
    (run) =>
      run.status === "completed" &&
      run.config.hazard === config.hazard &&
      run.config.locality.toLocaleLowerCase() === config.locality.toLocaleLowerCase() &&
      run.config.latitude === config.latitude &&
      run.config.longitude === config.longitude &&
      run.config.severity === config.severity &&
      run.config.population === config.population &&
      run.config.teams === config.teams,
  );
}

export function drillReport(run: DrillRun) {
  return {
    schemaVersion: 1,
    model: "faro-training-v1",
    mode: "simulation",
    geography:
      "Schematic sectors at operator-supplied coordinates; no surveyed buildings or terrain.",
    limitations:
      "Deterministic training rules, not physical hazard predictions or operational advice. No live actions.",
    run,
    metrics: drillMetrics(run),
    lessons: run.status === "completed" ? drillLessons(run) : [],
  };
}
