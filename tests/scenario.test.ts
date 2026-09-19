// OWNER: self-advancing scenario agent.
// Time is controlled by injecting `nowMs` or explicit ISO timestamps: no
// test actually waits, so the suite runs in milliseconds.

import { beforeEach, describe, expect, it } from "vitest";

import { POST as scenarioStartPost, GET as scenarioStartGet } from "@/app/api/scenario/start/route";
import { POST as scenarioStopPost } from "@/app/api/scenario/stop/route";
import { GET as scenarioTickGet, POST as scenarioTickPost } from "@/app/api/scenario/tick/route";
import {
  DEFAULT_SCRIPT_ID,
  configureScenario,
  createScenarioState,
  dueBeats,
  ensureHeartbeat,
  findScript,
  heartbeatStatus,
  listScenarioScripts,
  orderedBeats,
  parseSpeed,
  resetScenarioEngine,
  scenarioStatus,
  scriptSeconds,
  startScenario,
  stopScenario,
  withRuntime,
} from "@/lib/scenario";
import { resetSituation } from "@/lib/store";
import type { ScenarioBeat, ScenarioState } from "@/lib/types";

const T0 = Date.parse("2026-03-01T10:00:00.000Z");

/** Real timestamp, in ms, at `seconds` seconds from start. */
function at(seconds: number): number {
  return T0 + seconds * 1000;
}

function iso(seconds: number): string {
  return new Date(at(seconds)).toISOString();
}

function firedAt(scenario: ScenarioState, seconds: number): string[] {
  return dueBeats(scenario, at(seconds)).map((beat) => beat.id);
}

function runtimeOf(scenario: ScenarioState) {
  return withRuntime(scenario).runtime;
}

beforeEach(() => {
  resetScenarioEngine();
});

describe("scenario engine: time-based trigger", () => {
  it("triggers nothing before beat time and triggers upon reaching it", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    expect(firedAt(scenario, 10)).toEqual([]);
    expect(firedAt(scenario, 19)).toEqual([]);
    expect(firedAt(scenario, 21)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(21);
  });

  it("does not re-trigger an already triggered beat", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    expect(firedAt(scenario, 25)).toEqual(["beat-1"]);
    expect(firedAt(scenario, 26)).toEqual([]);
    expect(firedAt(scenario, 40)).toEqual([]);
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
  });

  it("does not advance if scenario is not running", () => {
    const scenario = createScenarioState();
    expect(firedAt(scenario, 500)).toEqual([]);
    expect(scenario.elapsedSeconds).toBe(0);
  });
});

describe("scenario engine: interrupted polling", () => {
  it("triggers at most one beat per tick even if multiple mature simultaneously", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // Nobody polls until second 95: beats 1, 2, and 3 mature.
    const primera = firedAt(scenario, 95);
    expect(primera).toHaveLength(1);
  });

  it("skips superseded beats and jumps to present crisis moment", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // Total silence for 200 seconds: all six script beats mature.
    const fired = firedAt(scenario, 200);

    // Beats older than 60s of script time are superseded by a later
    // already-matured beat, so they are marked skipped instead of replayed.
    expect(runtimeOf(scenario).skippedBeatIds).toEqual(["beat-1", "beat-2", "beat-3", "beat-4"]);
    expect(fired).toEqual(["beat-5"]);
    expect(scenario.running).toBe(true);

    // The last matured beat is never skipped: the next tick executes it.
    expect(firedAt(scenario, 203)).toEqual(["beat-6"]);
    expect(scenario.running).toBe(false);
  });

  it("drains short lag in order without skipping anything", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // 60 s silence: beat 1 (20 s) and 2 (55 s) mature; neither exceeds
    // obsolescence threshold relative to script clock.
    expect(firedAt(scenario, 60)).toEqual(["beat-1"]);
    expect(firedAt(scenario, 61)).toEqual(["beat-2"]);
    expect(runtimeOf(scenario).skippedBeatIds).toEqual([]);
  });
});

describe("scenario engine: pause and resume", () => {
  it("preserves elapsed script time when paused and resumed", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    expect(firedAt(scenario, 30)).toEqual(["beat-1"]);

    stopScenario(scenario, at(30));
    expect(scenario.running).toBe(false);
    expect(scenario.elapsedSeconds).toBe(30);
    expect(runtimeOf(scenario).paused).toBe(true);

    // Ten minutes of real pause: script clock does not move.
    expect(scriptSeconds(scenario, at(630))).toBe(30);

    startScenario(scenario, iso(630));
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
    expect(runtimeOf(scenario).paused).toBe(false);

    // Resumed: the 55s beat has 25s of script time left, not 55.
    expect(firedAt(scenario, 640)).toEqual([]);
    expect(firedAt(scenario, 656)).toEqual(["beat-2"]);
  });

  it("keeps UI timer consistent after a long pause", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);
    stopScenario(scenario, at(30));
    startScenario(scenario, iso(630));
    firedAt(scenario, 640);

    // UI displays (now - startedAt): must show 40s of script time,
    // not the ten-plus minutes of pause.
    const pintadoEnPantalla = (at(640) - Date.parse(scenario.startedAt!)) / 1000;
    expect(pintadoEnPantalla).toBeCloseTo(40, 3);
    expect(runtimeOf(scenario).startedAtReal).toBe(iso(0));
  });

  it("starting again does not reset clock unless restart requested", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);

    stopScenario(scenario, at(30));
    configureScenario({ restart: true });
    startScenario(scenario, iso(100));

    expect(scenario.firedBeatIds).toEqual([]);
    expect(scenario.elapsedSeconds).toBe(0);
    expect(scenario.startedAt).toBe(iso(100));
    expect(firedAt(scenario, 110)).toEqual([]);
    expect(firedAt(scenario, 121)).toEqual(["beat-1"]);
  });

  it("does not lose current segment if started while already running", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);

    startScenario(scenario, iso(30));
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
    expect(scriptSeconds(scenario, at(30))).toBeCloseTo(30, 5);
  });
});

describe("scenario engine: speed multiplier", () => {
  it("triggers earlier with higher speed", () => {
    const scenario = createScenarioState();
    configureScenario({ speed: 4 });
    startScenario(scenario, iso(0));

    expect(runtimeOf(scenario).speed).toBe(4);
    expect(firedAt(scenario, 4)).toEqual([]);
    expect(firedAt(scenario, 6)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(24);
  });

  it("changes speed on the fly without losing already elapsed time", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    expect(firedAt(scenario, 10)).toEqual([]);

    configureScenario({ speed: 5 });
    // New speed is applied on next tick, which closes segment at 1x
    // (12s script time) and opens fast segment: no free time given.
    expect(firedAt(scenario, 12)).toEqual([]);
    expect(scenario.elapsedSeconds).toBe(12);
    expect(runtimeOf(scenario).speed).toBe(5);

    // 12s script + 2s real at 5x = 22s script: beat 1 matures.
    expect(firedAt(scenario, 14)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(22);
  });

  it("rejects out-of-range multipliers", () => {
    expect(parseSpeed(1)).toBe(1);
    expect(parseSpeed(0.25)).toBe(0.25);
    expect(parseSpeed(0)).toBeNull();
    expect(parseSpeed(50)).toBeNull();
    expect(parseSpeed(Number.NaN)).toBeNull();
    expect(parseSpeed("4")).toBeNull();

    const scenario = createScenarioState();
    configureScenario({ speed: 999 });
    startScenario(scenario, iso(0));
    expect(runtimeOf(scenario).speed).toBe(1);
  });
});

describe("scenario engine: deterministic order", () => {
  const empate: ScenarioBeat[] = [
    { id: "tie-b", atSeconds: 30, label: "Segundo del empate" },
    { id: "tie-a", atSeconds: 30, label: "Primero del empate" },
    { id: "tie-early", atSeconds: 10, label: "El más temprano" },
  ];

  it("sorts by timestamp and, on tie, by position in script", () => {
    const scenario = createScenarioState();
    scenario.beats = empate.map((beat) => ({ ...beat }));

    expect(orderedBeats(scenario).map((beat) => beat.id)).toEqual(["tie-early", "tie-b", "tie-a"]);
  });

  it("triggers tied beats always in the same order", () => {
    const secuencia = () => {
      const scenario = createScenarioState();
      scenario.beats = empate.map((beat) => ({ ...beat }));
      startScenario(scenario, iso(0));
      return [firedAt(scenario, 11), firedAt(scenario, 31), firedAt(scenario, 32)].flat();
    };

    expect(secuencia()).toEqual(["tie-early", "tie-b", "tie-a"]);
    expect(secuencia()).toEqual(["tie-early", "tie-b", "tie-a"]);
  });
});

describe("scenario engine: end of script", () => {
  it("stops automatically when nothing left to trigger", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    const disparados: string[] = [];
    for (let segundo = 0; segundo <= 260; segundo += 3) {
      disparados.push(...firedAt(scenario, segundo));
    }

    expect(disparados).toEqual(["beat-1", "beat-2", "beat-3", "beat-4", "beat-5", "beat-6"]);
    expect(scenario.running).toBe(false);

    const estado = scenarioStatus(scenario, at(300));
    expect(estado.finished).toBe(true);
    expect(estado.remainingBeats).toBe(0);
    expect(estado.skippedBeats).toBe(0);
    expect(estado.nextBeat).toBeNull();

    // Finished: triggers no more and starting again begins from scratch.
    expect(firedAt(scenario, 400)).toEqual([]);
    startScenario(scenario, iso(400));
    expect(scenario.firedBeatIds).toEqual([]);
    expect(scenario.running).toBe(true);
  });
});

describe("available scripts", () => {
  it("offers multiple storylines and wildfire remains default", () => {
    const guiones = listScenarioScripts();
    expect(guiones.length).toBeGreaterThanOrEqual(3);
    expect(new Set(guiones.map((guion) => guion.id)).size).toBe(guiones.length);
    expect(DEFAULT_SCRIPT_ID).toBe("wildfire-andalucia");

    const porDefecto = createScenarioState();
    expect(porDefecto.id).toBe("wildfire-andalucia");
    expect(porDefecto.beats.map((beat) => beat.atSeconds)).toEqual([20, 55, 90, 125, 160, 200]);
  });

  it("alternative scripts are narrative and with accents", () => {
    for (const id of ["blackout-guadalquivir", "flood-guadalquivir"]) {
      const guion = findScript(id);
      expect(guion).toBeDefined();
      expect(guion!.beats.length).toBeGreaterThanOrEqual(5);

      for (const beat of guion!.beats) {
        expect(beat.label.length).toBeGreaterThan(20);
        expect(Boolean(beat.event) !== Boolean(beat.demoKind)).toBe(true);
      }
      // At least part of narrative contains accents: presented to an evaluation panel.
      expect(guion!.beats.some((beat) => /[áéíóúñÁÉÍÓÚÑ]/.test(beat.label))).toBe(true);
    }
  });

  it("switching script restarts narrative with new beats", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);

    configureScenario({ scriptId: "blackout-guadalquivir" });
    startScenario(scenario, iso(60));

    expect(scenario.id).toBe("blackout-guadalquivir");
    expect(scenario.firedBeatIds).toEqual([]);
    expect(scenario.beats[0]!.id).toBe("blackout-1");
    expect(firedAt(scenario, 81)).toEqual(["blackout-1"]);
  });

  it("does not switch script if identifier does not exist", () => {
    const scenario = createScenarioState();
    configureScenario({ scriptId: "guion-inventado" });
    startScenario(scenario, iso(0));
    expect(scenario.id).toBe(DEFAULT_SCRIPT_ID);
  });
});

describe("server heartbeat", () => {
  it("is disabled in tests and leaves no active timers", () => {
    expect(ensureHeartbeat(() => true)).toBe("disabled");
    expect(heartbeatStatus().running).toBe(false);
  });
});

describe("scenario HTTP routes", () => {
  beforeEach(() => {
    process.env.ACTION_EXECUTION_MODE = "mock";
    resetSituation();
  });

  function post(body?: unknown) {
    return new Request("http://localhost/api/scenario/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("starts scenario without body", async () => {
    const response = await scenarioStartPost(post());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.running).toBe(true);
    expect(body.scenario.id).toBe(DEFAULT_SCRIPT_ID);
  });

  it("accepts script and speed", async () => {
    const response = await scenarioStartPost(post({ scriptId: "flood-guadalquivir", speed: 3 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.id).toBe("flood-guadalquivir");
    expect(body.scenario.runtime.speed).toBe(3);
  });

  it("rejects invalid speeds and scripts", async () => {
    const velocidad = await scenarioStartPost(post({ speed: 100 }));
    expect(velocidad.status).toBe(400);

    const guion = await scenarioStartPost(post({ scriptId: "no-existe" }));
    expect(guion.status).toBe(400);
    expect((await guion.json()).code).toBe("referencia_desconocida");

    const campo = await scenarioStartPost(post({ velocidad: 2 }));
    expect(campo.status).toBe(400);

    const roto = await scenarioStartPost(
      new Request("http://localhost/api/scenario/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{no json",
      }),
    );
    expect(roto.status).toBe(400);
  });

  it("stops scenario preserving elapsed time", async () => {
    await scenarioStartPost(post());
    const response = await scenarioStopPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.running).toBe(false);
    expect(body.scenario.runtime.paused).toBe(true);
  });

  it("advances with manual tick and exposes script status", async () => {
    await scenarioStartPost(post());

    const tick = await scenarioTickPost();
    expect(tick.status).toBe(200);
    expect((await tick.json()).scenario.running).toBe(true);

    const estado = await scenarioTickGet();
    expect((await estado.json()).id).toBe(DEFAULT_SCRIPT_ID);
  });

  it("rejects disallowed methods", async () => {
    const response = await scenarioStartGet();
    expect(response.status).toBe(405);
  });
});
