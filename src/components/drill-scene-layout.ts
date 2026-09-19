import * as THREE from "three";
import type { DrillConfig, DrillMission, SectorId } from "@/lib/emergency-drills";

export const districts = [
  { id: "residential", x: -32, z: -25, color: 0xe9c78c, label: "A · Homes" },
  { id: "care", x: 29, z: -25, color: 0x91c4d0, label: "B · Care centre" },
  { id: "central", x: -22, z: 25, color: 0xc8b4e5, label: "C · Town square" },
] as const;

export const assembly = { x: 37, z: 30 };

export function localityKey(config: DrillConfig) {
  return `${config.locality.trim().toLowerCase()}|${config.latitude}|${config.longitude}`;
}

export function localitySeed(config: DrillConfig) {
  let seed = 2166136261;
  for (const char of localityKey(config)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function noise(seed: number) {
  let value = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function point(x: number, z: number, y = 0.65) {
  return new THREE.Vector3(x, y, z);
}

export function evacuationPath(id: SectorId, alternative: boolean) {
  const site = districts.find((district) => district.id === id)!;
  return alternative
    ? [
        point(site.x, site.z),
        point(site.x < 0 ? -59 : 59, site.z),
        point(site.x < 0 ? -59 : 59, 49),
        point(assembly.x, 49),
        point(assembly.x, assembly.z),
      ]
    : [
        point(site.x, site.z),
        point(site.x, 0),
        point(assembly.x, 0),
        point(assembly.x, assembly.z),
      ];
}

export function alongPath(points: THREE.Vector3[], progress: number) {
  const lengths = points.slice(1).map((end, index) => end.distanceTo(points[index]));
  let distance =
    lengths.reduce((sum, length) => sum + length, 0) * THREE.MathUtils.clamp(progress, 0, 1);
  for (let index = 0; index < lengths.length; index++) {
    if (lengths[index] > 0 && distance <= lengths[index])
      return points[index].clone().lerp(points[index + 1], distance / lengths[index]);
    distance -= lengths[index];
  }
  return points[points.length - 1].clone();
}

export function missionPath(mission: DrillMission) {
  const path = evacuationPath(mission.sectorId, mission.route === "alternative");
  if (mission.reroutedFrom === undefined) return path;
  const origin = alongPath(evacuationPath(mission.sectorId, false), mission.reroutedFrom);
  const junction = [-25, 0, 25].reduce((nearest, z) =>
    Math.abs(z - origin.z) < Math.abs(nearest - origin.z) ? z : nearest,
  );
  const side = origin.x < 10 ? -59 : 59;
  return [
    origin,
    point(origin.x, junction),
    point(side, junction),
    point(side, 49),
    point(assembly.x, 49),
    point(assembly.x, assembly.z),
  ];
}

export function pathHeading(path: THREE.Vector3[], progress: number) {
  const a = alongPath(path, Math.max(0, progress - 0.0001));
  const b = alongPath(path, Math.min(1, progress + 0.0001));
  return Math.atan2(b.x - a.x, b.z - a.z);
}

export function fireFront(z: number, minute: number, severity: DrillConfig["severity"]) {
  const speed = severity === "extreme" ? 4 : severity === "severe" ? 3.5 : 3;
  const shift = Math.max(0, minute - 15);
  return -77 + minute * speed + Math.sin(z * 0.07) * 3 + shift * (1.7 - z * 0.035);
}

export function damageLevel(seed: number, severity: DrillConfig["severity"], aftershock: boolean) {
  const threshold = { moderate: 0.2, severe: 0.38, extreme: 0.55 }[severity];
  const value = noise(seed);
  return value < threshold ? (aftershock ? 2 : 1) : aftershock && value < threshold + 0.2 ? 1 : 0;
}
