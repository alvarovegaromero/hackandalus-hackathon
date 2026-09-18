// PROPIETARIO: agente del escenario que avanza solo.
// El tiempo se controla inyectando `nowMs` o instantes ISO explicitos: ningun
// test espera de verdad, asi que la suite tarda milisegundos.

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
  withRuntime
} from "@/lib/scenario";
import { resetSituation } from "@/lib/store";
import type { ScenarioBeat, ScenarioState } from "@/lib/types";

const T0 = Date.parse("2026-03-01T10:00:00.000Z");

/** Instante real, en ms, a `seconds` segundos del arranque. */
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

describe("motor del escenario: disparo por tiempo", () => {
  it("no dispara nada antes del instante del beat y dispara al llegar", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    expect(firedAt(scenario, 10)).toEqual([]);
    expect(firedAt(scenario, 19)).toEqual([]);
    expect(firedAt(scenario, 21)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(21);
  });

  it("no vuelve a disparar un beat ya disparado", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    expect(firedAt(scenario, 25)).toEqual(["beat-1"]);
    expect(firedAt(scenario, 26)).toEqual([]);
    expect(firedAt(scenario, 40)).toEqual([]);
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
  });

  it("no avanza si el escenario no esta en marcha", () => {
    const scenario = createScenarioState();
    expect(firedAt(scenario, 500)).toEqual([]);
    expect(scenario.elapsedSeconds).toBe(0);
  });
});

describe("motor del escenario: sondeo interrumpido", () => {
  it("dispara como mucho un beat por tick aunque venzan varios a la vez", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // Nadie sondea hasta el segundo 95: vencen los beats 1, 2 y 3.
    const primera = firedAt(scenario, 95);
    expect(primera).toHaveLength(1);
  });

  it("omite los beats superados y salta al presente de la crisis", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // Silencio total durante 200 segundos: vencen los seis beats del guion.
    const fired = firedAt(scenario, 200);

    // Los beats de hace mas de 60 s de guion quedan superados por otro
    // posterior ya vencido, asi que se marcan omitidos en vez de reproducirse.
    expect(runtimeOf(scenario).skippedBeatIds).toEqual(["beat-1", "beat-2", "beat-3", "beat-4"]);
    expect(fired).toEqual(["beat-5"]);
    expect(scenario.running).toBe(true);

    // El ultimo beat vencido nunca se omite: el siguiente tick lo ejecuta.
    expect(firedAt(scenario, 203)).toEqual(["beat-6"]);
    expect(scenario.running).toBe(false);
  });

  it("drena en orden el atraso corto sin omitir nada", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));

    // 60 s de silencio: vencen el beat 1 (20 s) y el 2 (55 s); ninguno supera
    // el umbral de obsolescencia respecto al reloj de guion.
    expect(firedAt(scenario, 60)).toEqual(["beat-1"]);
    expect(firedAt(scenario, 61)).toEqual(["beat-2"]);
    expect(runtimeOf(scenario).skippedBeatIds).toEqual([]);
  });
});

describe("motor del escenario: pausa y reanudacion", () => {
  it("conserva el tiempo de guion consumido al pausar y reanudar", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    expect(firedAt(scenario, 30)).toEqual(["beat-1"]);

    stopScenario(scenario, at(30));
    expect(scenario.running).toBe(false);
    expect(scenario.elapsedSeconds).toBe(30);
    expect(runtimeOf(scenario).paused).toBe(true);

    // Diez minutos de pausa real: el reloj de guion no se mueve.
    expect(scriptSeconds(scenario, at(630))).toBe(30);

    startScenario(scenario, iso(630));
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
    expect(runtimeOf(scenario).paused).toBe(false);

    // Reanudado: al beat de los 55 s le quedan 25 s de guion, no 55.
    expect(firedAt(scenario, 640)).toEqual([]);
    expect(firedAt(scenario, 656)).toEqual(["beat-2"]);
  });

  it("deja cuadrado el cronometro de la interfaz tras una pausa larga", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);
    stopScenario(scenario, at(30));
    startScenario(scenario, iso(630));
    firedAt(scenario, 640);

    // La interfaz pinta (ahora - startedAt): tiene que dar los 40 s de guion,
    // no los diez minutos largos que hubo de pausa.
    const pintadoEnPantalla = (at(640) - Date.parse(scenario.startedAt!)) / 1000;
    expect(pintadoEnPantalla).toBeCloseTo(40, 3);
    expect(runtimeOf(scenario).startedAtReal).toBe(iso(0));
  });

  it("arrancar de nuevo no reinicia el reloj salvo que se pida restart", () => {
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

  it("no pierde el tramo en curso si se arranca estando ya en marcha", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    firedAt(scenario, 30);

    startScenario(scenario, iso(30));
    expect(scenario.firedBeatIds).toEqual(["beat-1"]);
    expect(scriptSeconds(scenario, at(30))).toBeCloseTo(30, 5);
  });
});

describe("motor del escenario: multiplicador de velocidad", () => {
  it("dispara antes con velocidad alta", () => {
    const scenario = createScenarioState();
    configureScenario({ speed: 4 });
    startScenario(scenario, iso(0));

    expect(runtimeOf(scenario).speed).toBe(4);
    expect(firedAt(scenario, 4)).toEqual([]);
    expect(firedAt(scenario, 6)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(24);
  });

  it("cambia de velocidad en caliente sin perder el tiempo ya consumido", () => {
    const scenario = createScenarioState();
    startScenario(scenario, iso(0));
    expect(firedAt(scenario, 10)).toEqual([]);

    configureScenario({ speed: 5 });
    // La velocidad nueva se aplica en el tick siguiente, que cierra el tramo a
    // 1x (12 s de guion) y abre el tramo rapido: nada de tiempo regalado.
    expect(firedAt(scenario, 12)).toEqual([]);
    expect(scenario.elapsedSeconds).toBe(12);
    expect(runtimeOf(scenario).speed).toBe(5);

    // 12 s de guion + 2 s reales a 5x = 22 s de guion: vence el beat 1.
    expect(firedAt(scenario, 14)).toEqual(["beat-1"]);
    expect(scenario.elapsedSeconds).toBe(22);
  });

  it("rechaza multiplicadores fuera de rango", () => {
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

describe("motor del escenario: orden determinista", () => {
  const empate: ScenarioBeat[] = [
    { id: "tie-b", atSeconds: 30, label: "Segundo del empate" },
    { id: "tie-a", atSeconds: 30, label: "Primero del empate" },
    { id: "tie-early", atSeconds: 10, label: "El más temprano" }
  ];

  it("ordena por instante y, ante empate, por posicion en el guion", () => {
    const scenario = createScenarioState();
    scenario.beats = empate.map((beat) => ({ ...beat }));

    expect(orderedBeats(scenario).map((beat) => beat.id)).toEqual(["tie-early", "tie-b", "tie-a"]);
  });

  it("dispara los beats empatados siempre en el mismo orden", () => {
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

describe("motor del escenario: fin del guion", () => {
  it("se detiene solo cuando no queda nada por disparar", () => {
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

    // Terminado: no dispara mas y arrancar de nuevo empieza de cero.
    expect(firedAt(scenario, 400)).toEqual([]);
    startScenario(scenario, iso(400));
    expect(scenario.firedBeatIds).toEqual([]);
    expect(scenario.running).toBe(true);
  });
});

describe("guiones disponibles", () => {
  it("ofrece varios relatos y el incendio sigue siendo el predeterminado", () => {
    const guiones = listScenarioScripts();
    expect(guiones.length).toBeGreaterThanOrEqual(3);
    expect(new Set(guiones.map((guion) => guion.id)).size).toBe(guiones.length);
    expect(DEFAULT_SCRIPT_ID).toBe("wildfire-andalucia");

    const porDefecto = createScenarioState();
    expect(porDefecto.id).toBe("wildfire-andalucia");
    expect(porDefecto.beats.map((beat) => beat.atSeconds)).toEqual([20, 55, 90, 125, 160, 200]);
  });

  it("los guiones alternativos son narrativos y con acentos", () => {
    for (const id of ["blackout-guadalquivir", "flood-guadalquivir"]) {
      const guion = findScript(id);
      expect(guion).toBeDefined();
      expect(guion!.beats.length).toBeGreaterThanOrEqual(5);

      for (const beat of guion!.beats) {
        expect(beat.label.length).toBeGreaterThan(20);
        expect(Boolean(beat.event) !== Boolean(beat.demoKind)).toBe(true);
      }
      // Al menos parte del relato lleva acentos: se muestra a un jurado.
      expect(guion!.beats.some((beat) => /[áéíóúñÁÉÍÓÚÑ]/.test(beat.label))).toBe(true);
    }
  });

  it("cambiar de guion reinicia el relato con los beats nuevos", () => {
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

  it("no cambia de guion si el identificador no existe", () => {
    const scenario = createScenarioState();
    configureScenario({ scriptId: "guion-inventado" });
    startScenario(scenario, iso(0));
    expect(scenario.id).toBe(DEFAULT_SCRIPT_ID);
  });
});

describe("latido de servidor", () => {
  it("queda desactivado en los tests y no deja temporizadores vivos", () => {
    expect(ensureHeartbeat(() => true)).toBe("disabled");
    expect(heartbeatStatus().running).toBe(false);
  });
});

describe("rutas HTTP del escenario", () => {
  beforeEach(() => {
    process.env.ACTION_EXECUTION_MODE = "mock";
    resetSituation();
  });

  function post(body?: unknown) {
    return new Request("http://localhost/api/scenario/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  it("arranca el escenario sin cuerpo", async () => {
    const response = await scenarioStartPost(post());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.running).toBe(true);
    expect(body.scenario.id).toBe(DEFAULT_SCRIPT_ID);
  });

  it("acepta guion y velocidad", async () => {
    const response = await scenarioStartPost(post({ scriptId: "flood-guadalquivir", speed: 3 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.id).toBe("flood-guadalquivir");
    expect(body.scenario.runtime.speed).toBe(3);
  });

  it("rechaza velocidades y guiones invalidos", async () => {
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
        body: "{no json"
      })
    );
    expect(roto.status).toBe(400);
  });

  it("para el escenario conservando el tiempo consumido", async () => {
    await scenarioStartPost(post());
    const response = await scenarioStopPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scenario.running).toBe(false);
    expect(body.scenario.runtime.paused).toBe(true);
  });

  it("avanza con un tick manual y expone el estado del guion", async () => {
    await scenarioStartPost(post());

    const tick = await scenarioTickPost();
    expect(tick.status).toBe(200);
    expect((await tick.json()).scenario.running).toBe(true);

    const estado = await scenarioTickGet();
    expect((await estado.json()).id).toBe(DEFAULT_SCRIPT_ID);
  });

  it("rechaza metodos no permitidos", async () => {
    const response = await scenarioStartGet();
    expect(response.status).toBe(405);
  });
});
