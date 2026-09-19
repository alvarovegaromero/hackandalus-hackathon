import type { Location } from "../signals/schema";
import type { FactValue } from "./world";

// FNV-1a over the parts, so (seed, eventId) always maps to the same stream.
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\0")) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  }
  return h >>> 0;
}

// mulberry32
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)];
export const between = (r: () => number, [lo, hi]: readonly [number, number]) =>
  lo + r() * (hi - lo);

const DEG_PER_METER = 1 / 111_320;

export function jitter(r: () => number, at: Location, accuracyM: number): Location {
  const dLat = (r() * 2 - 1) * accuracyM * DEG_PER_METER;
  const dLon = ((r() * 2 - 1) * accuracyM * DEG_PER_METER) / Math.cos((at.lat * Math.PI) / 180);
  return { ...at, lat: +(at.lat + dLat).toFixed(6), lon: +(at.lon + dLon).toFixed(6), accuracyM };
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

// A source reports the truth with probability `reliability`. Otherwise it is wrong:
// stale (the previous value) or contradictory (a declared alternative).
export function chooseValue(
  r: () => number,
  reliability: number,
  truth: FactValue,
  previous: FactValue | undefined,
  alternatives: readonly FactValue[],
): { value: FactValue; wrong: boolean } {
  const wrongs = [
    ...new Set([...(previous === undefined ? [] : [previous]), ...alternatives]),
  ].filter((v) => v !== truth);
  if (r() < reliability || wrongs.length === 0) return { value: truth, wrong: false };
  return { value: pick(r, wrongs), wrong: true };
}
