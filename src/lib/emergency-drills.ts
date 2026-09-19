// OWNER: emergency drill sandbox.

import { z } from "zod";
import { DEFAULT_SCENARIO, drillScenarioSchema, scenarioVariation } from "./drill-scenario";

export const drillConfigSchema = z.object({
  hazard: z.enum(["earthquake", "wildfire"]),
  locality: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  severity: z.enum(["moderate", "severe", "extreme"]),
  population: z.number().int().min(50).max(10000),
  teams: z.number().int().min(2).max(20),
  scenario: drillScenarioSchema.optional(),
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
  minute: z.number().min(0).max(20),
  kind: z.enum(["event", "decision"]),
  text: z.string().max(500),
  action: z.enum(actionIds).optional(),
  sectorId: z.enum(sectorIds).optional(),
  teams: count.max(20).optional(),
  moved: count.max(10000).optional(),
  observation: z
    .object({
      minute: z.number().min(0).max(20),
      hazard: z.enum(["earthquake", "wildfire"]),
      severity: z.enum(["moderate", "severe", "extreme"]),
      teamsAvailable: count.max(20),
      routeOpen: z.boolean(),
      communicationsDown: z.boolean(),
      warned: z.boolean(),
      sectors: z.array(sectorSchema.extend({ waiting: count })).length(3),
      inTransit: count,
      eventIds: z.array(z.string()),
    })
    .optional(),
});

const missionSchema = z.object({
  id: z.string(),
  sectorId: z.enum(sectorIds),
  people: count,
  progress: z.number().min(0).max(1),
  startedAt: z.number().min(0).max(20),
  arrivedAt: z.number().min(0).max(20).nullable(),
  route: z.enum(["main", "alternative"]),
  reroutedFrom: z.number().min(0).max(1).optional(),
  teamsReserved: count.max(20).optional(),
  travelMinutes: z.number().positive().optional(),
});
export type DrillMission = z.infer<typeof missionSchema>;

export const drillRunSchema = z
  .object({
    id: z.string().uuid(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    config: drillConfigSchema,
    phase: count.max(4),
    modelVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    policyVersion: z.string().max(100).optional(),
    learningReview: z
      .array(
        z.strictObject({
          lessonId: z.string().max(80),
          verdict: z.enum(["approved", "rejected"]),
          reviewedAt: z.iso.datetime(),
          reviewer: z.enum(["local-facilitator", "synthetic-review-fixture"]),
        }),
      )
      .max(20)
      .optional(),
    teamBusyMinutes: z.number().nonnegative().optional(),
    reservations: z
      .array(
        z.object({
          decisionId: z.string(),
          teams: count.max(20),
          until: z.number().min(0).max(22),
        }),
      )
      .max(200)
      .optional(),
    minute: z.number().min(0).max(20).optional(),
    missions: z.array(missionSchema).max(200).default([]),
    exposure: z.number().nonnegative().default(0),
    status: z.enum(["running", "completed"]),
    teamsAvailable: count.max(20),
    routeOpen: z.boolean(),
    communicationsDown: z.boolean(),
    warned: z.boolean(),
    sectors: z.array(sectorSchema).length(3),
    log: z.array(entrySchema).max(1000),
    notes: z.string().max(2000),
  })
  .refine(
    (run) =>
      run.sectors.reduce((sum, sector) => sum + sector.population, 0) === run.config.population &&
      run.sectors.every(
        (sector) =>
          sector.evacuated +
            run.missions
              .filter((mission) => mission.sectorId === sector.id && mission.arrivedAt === null)
              .reduce((sum, mission) => sum + mission.people, 0) <=
          sector.population,
      ) &&
      new Set(run.sectors.map((sector) => sector.id)).size === 3 &&
      new Set(run.missions.map((mission) => mission.id)).size === run.missions.length &&
      (run.minute === undefined
        ? run.modelVersion === 1
        : Math.floor(run.minute / 5) === run.phase) &&
      run.missions.every(
        (mission) =>
          mission.startedAt <= (run.minute ?? run.phase * 5) &&
          (mission.arrivedAt === null ||
            (mission.arrivedAt >= mission.startedAt &&
              mission.arrivedAt <= (run.minute ?? run.phase * 5) &&
              mission.progress === 1)),
      ) &&
      run.teamsAvailable <= run.config.teams &&
      (run.modelVersion !== 3 ||
        (run.config.scenario !== undefined &&
          run.policyVersion !== undefined &&
          run.teamBusyMinutes !== undefined &&
          run.reservations !== undefined &&
          run.teamsAvailable +
            run.reservations.reduce((sum, reservation) => sum + reservation.teams, 0) +
            run.missions
              .filter((mission) => mission.arrivedAt === null)
              .reduce((sum, mission) => sum + (mission.teamsReserved ?? 0), 0) ===
            run.config.teams &&
          run.reservations.every((reservation) => reservation.until > (run.minute ?? 0)) &&
          run.missions.every(
            (mission) => mission.teamsReserved === 2 && mission.travelMinutes !== undefined,
          ) &&
          run.log.every(
            (entry) => entry.kind !== "decision" || entry.observation !== undefined,
          ))) &&
      (run.status === "completed"
        ? run.phase === 4 && run.completedAt !== null
        : run.phase < 4 && run.completedAt === null),
  );

export type DrillRun = z.infer<typeof drillRunSchema>;
export type DrillObservation = NonNullable<DrillRun["log"][number]["observation"]>;

export function observeDrill(run: DrillRun): DrillObservation {
  return {
    minute: drillMinute(run),
    hazard: run.config.hazard,
    severity: run.config.severity,
    teamsAvailable: run.teamsAvailable,
    routeOpen: run.routeOpen,
    communicationsDown: run.communicationsDown,
    warned: run.warned,
    sectors: run.sectors.map((sector) => ({
      ...sector,
      waiting:
        sector.population -
        sector.evacuated -
        run.missions
          .filter((mission) => mission.sectorId === sector.id && mission.arrivedAt === null)
          .reduce((sum, mission) => sum + mission.people, 0),
    })),
    inTransit: run.missions
      .filter((mission) => mission.arrivedAt === null)
      .reduce((sum, mission) => sum + mission.people, 0),
    eventIds: run.log.filter((entry) => entry.kind === "event").map((entry) => entry.id),
  };
}
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
    log: [...run.log, { ...entry, id: `${run.id}-${run.log.length}`, minute: drillMinute(run) }],
  };
}

export function drillMinute(run: DrillRun): number {
  return run.minute ?? run.phase * 5;
}

export function formatDrillTime(minute: number): string {
  const seconds = Math.round(minute * 60);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function createDrill(
  config: DrillConfig,
  id: string,
  now: string,
  modelVersion: 1 | 2 | 3 = 3,
): DrillRun {
  const validated = drillConfigSchema.parse(
    modelVersion === 3 ? { ...config, scenario: config.scenario ?? DEFAULT_SCENARIO } : config,
  );
  const scenario = validated.scenario ?? DEFAULT_SCENARIO;
  const careShare = modelVersion === 3 ? scenario.careShare : 0.2;
  const residential = Math.floor(validated.population * (0.75 - careShare));
  const care = Math.floor(validated.population * careShare);
  const populations = [residential, care, validated.population - residential - care];
  const names = ["Residential quarter", "Care & school quarter", "Town centre"];
  const run: DrillRun = {
    id,
    startedAt: now,
    completedAt: null,
    config: validated,
    phase: 0,
    modelVersion,
    ...(modelVersion === 3
      ? { policyVersion: "manual-v1", reservations: [], teamBusyMinutes: 0 }
      : {}),
    minute: 0,
    missions: [],
    exposure: 0,
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
      risk: Math.min(
        100,
        severityRisk[validated.severity] +
          (index === 1 ? 12 : index * 4) +
          (modelVersion === 3 ? Math.floor(scenarioVariation(scenario.seed, index) * 9) - 4 : 0),
      ),
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
    return run.modelVersion === 3
      ? "Teams are occupied. Wait for an arrival or service completion."
      : "Not enough available teams in this phase.";
  const repeated = run.log.some(
    (entry) =>
      entry.kind === "decision" &&
      entry.action === action &&
      Math.floor(entry.minute / 5) === run.phase &&
      (action === "notify" || action === "reroute" || entry.sectorId === sectorId),
  );
  if (repeated && !(run.modelVersion === 3 && action === "evacuate"))
    return "Already practiced in this phase.";
  if (action === "assess" && sector.assessed) return "Sector already assessed.";
  if (action === "protect" && sector.protected) return "Safety perimeter already established.";
  if (action === "reroute" && run.routeOpen) return "The exercise route is open.";
  if (action === "evacuate") {
    if (!run.routeOpen) return "Open an alternative route first.";
    if (run.config.hazard === "earthquake" && !sector.assessed)
      return "Assess building safety first.";
    const traveling = run.missions
      .filter((mission) => mission.sectorId === sectorId && mission.arrivedAt === null)
      .reduce((sum, mission) => sum + mission.people, 0);
    if (sector.evacuated + traveling === sector.population)
      return "Everyone in this sector is safe or already traveling.";
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
  const scenario = run.config.scenario ?? DEFAULT_SCENARIO;
  const capacityMultiplier =
    run.modelVersion === 3 && run.communicationsDown && !run.warned
      ? scenario.events.unbriefedCapacityMultiplier
      : 1;
  let moved = 0;
  const traveling = run.missions
    .filter((mission) => mission.sectorId === sectorId && mission.arrivedAt === null)
    .reduce((sum, mission) => sum + mission.people, 0);
  const sectors = run.sectors.map((sector) => {
    if (sector.id !== sectorId) return sector;
    moved =
      action === "evacuate"
        ? Math.min(
            sector.population - sector.evacuated - traveling,
            Math.floor((capacity + (run.warned ? 20 : 0)) * capacityMultiplier),
          )
        : 0;
    return {
      ...sector,
      assessed: sector.assessed || action === "assess",
      protected: sector.protected || action === "protect",
      evacuated: sector.evacuated + (run.modelVersion === 1 ? moved : 0),
      risk: Math.max(0, sector.risk - (action === "protect" ? 20 : 0)),
    };
  });
  const sectorName = sectors.find((sector) => sector.id === sectorId)?.name;
  const detail =
    action === "evacuate"
      ? run.modelVersion === 1
        ? `${moved} simulated people reached the assembly point.`
        : `${moved} people dispatched from ${sectorName}; arrival depends on route access.`
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
      ...(run.modelVersion === 3
        ? {
            reservations: [
              ...(run.reservations ?? []),
              ...(action !== "evacuate" && ACTIONS[action].teams > 0
                ? [
                    {
                      decisionId: `${run.id}-${run.log.length}`,
                      teams: ACTIONS[action].teams,
                      until: drillMinute(run) + scenario.serviceMinutes,
                    },
                  ]
                : []),
            ],
          }
        : {}),
      routeOpen: run.routeOpen || action === "reroute",
      warned: run.warned || action === "notify",
      missions:
        action === "evacuate" && run.modelVersion >= 2
          ? [
              ...run.missions,
              {
                id: `${run.id}-mission-${run.missions.length}`,
                sectorId,
                people: moved,
                progress: 0,
                startedAt: drillMinute(run),
                arrivedAt: null,
                route: run.phase >= 1 ? "alternative" : "main",
                ...(run.modelVersion === 3
                  ? {
                      teamsReserved: ACTIONS.evacuate.teams,
                      travelMinutes:
                        (run.phase >= 1
                          ? scenario.alternativeTravelMinutes
                          : scenario.mainTravelMinutes) *
                          (sectorId === "care" ? scenario.careTravelMultiplier : 1) +
                        Math.floor(scenarioVariation(scenario.seed, run.missions.length + 3) * 5) *
                          0.125,
                    }
                  : {}),
              },
            ]
          : action === "reroute"
            ? run.missions.map((mission) =>
                mission.arrivedAt === null
                  ? {
                      ...mission,
                      route: "alternative" as const,
                      reroutedFrom: mission.progress,
                      progress: 0,
                      ...(run.modelVersion === 3
                        ? {
                            travelMinutes:
                              scenario.alternativeTravelMinutes *
                              (mission.sectorId === "care" ? scenario.careTravelMultiplier : 1),
                          }
                        : {}),
                    }
                  : mission,
              )
            : run.missions,
    },
    {
      kind: "decision",
      action,
      sectorId,
      teams: ACTIONS[action].teams,
      moved,
      text: `${ACTIONS[action].label}: ${detail}`,
      ...(run.modelVersion === 3 ? { observation: observeDrill(run) } : {}),
    },
  );
}

function advancePhase(run: DrillRun, now: string): DrillRun {
  if (run.status !== "running") return run;
  const phase = run.phase + 1;
  if (phase === 4) {
    return addEntry(
      { ...run, phase, minute: 20, status: "completed", completedAt: now },
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
      minute: phase * 5,
      teamsAvailable: run.modelVersion === 3 ? run.teamsAvailable : run.config.teams,
      routeOpen: phase === 1 ? false : run.routeOpen,
      communicationsDown: phase >= 2,
      warned: phase === 2 ? false : run.warned,
      sectors: run.sectors.map((sector) => ({
        ...sector,
        assessed: phase === 3 && run.config.hazard === "earthquake" ? false : sector.assessed,
        risk: Math.min(
          100,
          sector.risk +
            (phase === 3 && run.modelVersion === 3
              ? Math.round(
                  (run.config.scenario?.events.escalationRisk ?? 10) * (sector.protected ? 0.3 : 1),
                )
              : sector.protected
                ? 3
                : 10) +
            (run.config.severity === "extreme" ? 5 : 0),
        ),
      })),
    },
    { kind: "event", text },
  );
}

export function tickDrill(run: DrillRun, minutes: number, now: string): DrillRun {
  if (run.status !== "running" || minutes <= 0) return run;
  const requested = Math.min(20, drillMinute(run) + minutes);
  const target = run.modelVersion === 3 ? Math.floor(requested * 8 + 1e-9) / 8 : requested;
  let current = run;
  while (drillMinute(current) < target && current.status === "running") {
    const before = drillMinute(current);
    const minute = Math.min(target, before + 0.125, (current.phase + 1) * 5);
    const delta = minute - before;
    const missions = current.missions.map((mission) => {
      if (mission.arrivedAt !== null || !current.routeOpen) return mission;
      const duration =
        mission.travelMinutes ??
        (mission.route === "alternative" ? 3 : 2) * (mission.sectorId === "care" ? 1.25 : 1);
      const progress = Math.min(1, mission.progress + delta / duration);
      const arrived = progress >= 1 - 1e-9;
      return { ...mission, progress: arrived ? 1 : progress, arrivedAt: arrived ? minute : null };
    });
    const arrivals = missions.filter(
      (mission, index) => mission.arrivedAt !== null && current.missions[index].arrivedAt === null,
    );
    const exposure = current.sectors.reduce((sum, sector) => {
      const inTransit = current.missions
        .filter((mission) => mission.sectorId === sector.id && mission.arrivedAt === null)
        .reduce((count, mission) => count + mission.people, 0);
      return sum + ((sector.population - sector.evacuated - inTransit) * sector.risk) / 100;
    }, 0);
    const released = (current.reservations ?? []).filter(
      (reservation) => reservation.until <= minute,
    );
    current = {
      ...current,
      minute,
      missions,
      exposure: current.exposure + (current.modelVersion >= 2 ? exposure * delta : 0),
      ...(current.modelVersion === 3
        ? {
            teamBusyMinutes:
              (current.teamBusyMinutes ?? 0) +
              (current.config.teams - current.teamsAvailable) * delta,
            teamsAvailable:
              current.teamsAvailable +
              arrivals.reduce((sum, mission) => sum + (mission.teamsReserved ?? 0), 0) +
              (current.reservations ?? [])
                .filter((reservation) => reservation.until <= minute)
                .reduce((sum, reservation) => sum + reservation.teams, 0),
            reservations: (current.reservations ?? []).filter(
              (reservation) => reservation.until > minute,
            ),
          }
        : {}),
      sectors: current.sectors.map((sector) => ({
        ...sector,
        evacuated:
          sector.evacuated +
          arrivals
            .filter((mission) => mission.sectorId === sector.id)
            .reduce((sum, mission) => sum + mission.people, 0),
      })),
    };
    for (const reservation of released) {
      current = addEntry(current, {
        kind: "event",
        teams: reservation.teams,
        text: `${reservation.teams} team(s) released after service for decision ${reservation.decisionId}.`,
      });
    }
    for (const mission of arrivals) {
      current = addEntry(current, {
        kind: "event",
        sectorId: mission.sectorId,
        moved: mission.people,
        text: `${mission.people} people from ${current.sectors.find((sector) => sector.id === mission.sectorId)?.name} arrived at the assembly point.`,
      });
    }
    if (minute >= (current.phase + 1) * 5) current = advancePhase(current, now);
  }
  return current;
}

export function advanceDrill(run: DrillRun, now: string): DrillRun {
  return tickDrill(run, (run.phase + 1) * 5 - drillMinute(run), now);
}

export function replayDrill(
  run: DrillRun,
  minute: number,
  decisions = true,
  throughIndex = Infinity,
): DrillRun {
  const target = Math.max(0, Math.min(drillMinute(run), minute));
  let replay = createDrill(run.config, run.id, run.startedAt, run.modelVersion);
  if (run.policyVersion) replay = { ...replay, policyVersion: run.policyVersion };
  for (const [index, entry] of run.log.entries()) {
    if (
      !decisions ||
      entry.kind !== "decision" ||
      !entry.action ||
      !entry.sectorId ||
      entry.minute > target ||
      index > throughIndex
    )
      continue;
    replay = tickDrill(
      replay,
      entry.minute - drillMinute(replay),
      run.completedAt ?? run.startedAt,
    );
    replay = applyDrillAction(replay, entry.action, entry.sectorId);
  }
  return tickDrill(replay, target - drillMinute(replay), run.completedAt ?? run.startedAt);
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
    inTransit: run.missions
      .filter((mission) => mission.arrivedAt === null)
      .reduce((sum, mission) => sum + mission.people, 0),
    exposure: Math.round(run.exposure),
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
        route && route.minute < 6
          ? "Alternative access restored promptly"
          : "Prepare an alternative access route",
      evidence: route
        ? `Road closed at T+05:00; route action recorded at T+${formatDrillTime(route.minute)}.`
        : "Road closed at T+5; no alternative route was recorded.",
      recommendation: "Reserve one team for alternative access when the road closes.",
      action: "reroute",
    },
    {
      id: "communications",
      title:
        fallback && fallback.minute < 11
          ? "Radio fallback practiced on time"
          : "Rehearse communications fallback",
      evidence: fallback
        ? `Network lost at T+10:00; radio briefing at T+${formatDrillTime(fallback.minute)}.`
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
      (entry) => entry.action === "assess" && entry.minute >= 15,
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
  if (run.modelVersion >= 2) {
    const baseline = replayDrill(run, 20, false);
    lessons.push({
      id: "consequences",
      title: "Connect decisions to modeled exposure",
      evidence: `${Math.round(run.exposure)} risk-weighted person-minutes with your decisions; ${Math.round(baseline.exposure)} without intervention under identical rules.`,
      recommendation:
        "Replay the road closure and compare early evacuation with perimeter protection. This is a model comparison, not a causal prediction.",
      action: "protect",
    });
    if (metrics.inTransit)
      lessons.push({
        id: "travel",
        title: "Allow time for arrivals",
        evidence: `${metrics.inTransit} people were still traveling or waiting on a blocked route when the exercise ended.`,
        recommendation:
          "Dispatch earlier and restore access promptly; assigning a team does not complete an evacuation.",
        action: "evacuate",
      });
  }
  return lessons;
}

export function comparableDrills(
  config: DrillConfig,
  history: DrillRun[],
  modelVersion: 1 | 2 | 3 = 3,
): DrillRun[] {
  const scenario = drillScenarioSchema.safeParse(config.scenario ?? DEFAULT_SCENARIO);
  if (modelVersion === 3 && !scenario.success) return [];
  return history.filter(
    (run) =>
      run.status === "completed" &&
      run.modelVersion === modelVersion &&
      run.config.hazard === config.hazard &&
      run.config.locality.toLocaleLowerCase() === config.locality.toLocaleLowerCase() &&
      run.config.latitude === config.latitude &&
      run.config.longitude === config.longitude &&
      run.config.severity === config.severity &&
      run.config.population === config.population &&
      run.config.teams === config.teams &&
      (modelVersion !== 3 ||
        JSON.stringify(drillScenarioSchema.parse(run.config.scenario)) ===
          JSON.stringify(scenario.data)),
  );
}

export function drillReport(run: DrillRun) {
  return {
    schemaVersion: run.modelVersion === 3 ? 3 : 2,
    model: `faro-training-v${run.modelVersion}`,
    mode: "simulation",
    geography:
      "Schematic sectors at operator-supplied coordinates; no surveyed buildings or terrain.",
    limitations:
      "Deterministic training rules, not physical hazard predictions or operational advice. No live actions.",
    run,
    metrics: drillMetrics(run),
    lessons: run.status === "completed" ? drillLessons(run) : [],
    withoutIntervention:
      run.modelVersion >= 2 ? drillMetrics(replayDrill(run, drillMinute(run), false)) : null,
  };
}
