import * as THREE from "three";
import type { DrillConfig } from "@/lib/emergency-drills";
import { assembly, damageLevel, districts, localitySeed, noise, point } from "./drill-scene-layout";

interface Building {
  x: number;
  z: number;
  seed: number;
  height: number;
  depth: number;
}
interface Part {
  matrix: THREE.Matrix4;
  building?: number;
}

export function createWorld(config: DrillConfig) {
  const root = new THREE.Group();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  const seed = localitySeed(config);
  const dummy = new THREE.Object3D();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(cube);
  const buildings: Building[] = [];
  const batches = new Map<THREE.Material, Part[]>();
  const materialCache = new Map<number, THREE.MeshStandardMaterial>();

  function material(color: number) {
    let mat = materialCache.get(color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
      materialCache.set(color, mat);
      materials.add(mat);
    }
    return mat;
  }

  function box(
    color: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    building?: number,
    rotation = 0,
  ) {
    const mat = material(color);
    const parts = batches.get(mat) ?? [];
    dummy.position.set(x, y, z);
    dummy.scale.set(width, height, depth);
    dummy.rotation.set(0, rotation, 0);
    dummy.updateMatrix();
    parts.push({ matrix: dummy.matrix.clone(), building });
    batches.set(mat, parts);
  }

  function label(text: string, x: number, z: number, color = "#d8e9ec") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#17323b";
    context.fillRect(0, 0, 512, 100);
    context.fillStyle = color;
    context.fillRect(0, 0, 8, 100);
    context.font = "600 36px system-ui";
    context.textAlign = "center";
    context.fillText(text, 256, 63);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      sizeAttenuation: false,
    });
    materials.add(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, 14, z);
    sprite.scale.set(0.17, 0.033, 1);
    sprite.renderOrder = 10;
    root.add(sprite);
    return sprite;
  }

  box(0x536a61, -6, -2, 0, 178, 4, 132);
  box(0x829575, -6, -0.08, 0, 177, 0.2, 131);
  // Routes and the visible road network share these junctions.
  const streets = [
    [-59, 0, 7, 106],
    [59, 0, 7, 106],
    [0, 0, 125, 7],
    [0, -49, 125, 6],
    [0, 49, 125, 6],
    [-32, -24.5, 6, 49],
    [29, -24.5, 6, 49],
    [-22, 24.5, 6, 49],
    [37, 24.5, 6, 49],
    [0, -25, 125, 5],
    [0, 25, 125, 5],
  ];
  for (const [x, z, w, d] of streets) {
    box(0xb7b9a1, x, 0.02, z, w + 1.6, 0.22, d + 1.6);
    box(0x475862, x, 0.16, z, w, 0.12, d);
    const count = Math.floor(Math.max(w, d) / 5);
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 5;
      box(
        0xd7d9c5,
        x + (w > d ? offset : 0),
        0.235,
        z + (d > w ? offset : 0),
        w > d ? 2 : 0.15,
        0.02,
        d > w ? 2 : 0.15,
      );
    }
  }
  for (const x of [-32, 29, 37]) {
    for (let i = 0; i < 5; i++) box(0xe5e4d3, x - 2 + i, 0.25, x === 37 ? 20 : -6, 0.5, 0.025, 2.6);
  }

  const facades = [0xd9d1b9, 0xc7cabc, 0xe5dfc7, 0xbac6be];
  function building(
    x: number,
    z: number,
    width: number,
    depth: number,
    floors: number,
    style: "home" | "care" | "town",
    index: number,
  ) {
    const height = floors * 2.8;
    const id = buildings.length;
    buildings.push({ x, z, seed: seed + index * 71, height, depth });
    const facade = style === "care" ? 0xe5dfc7 : facades[Math.floor(noise(seed + index) * 4)];
    box(0xb7b9a1, x, 0.15, z, width + 1.4, 0.3, depth + 1.4);
    box(facade, 0, height / 2, 0, width, height, depth, id);
    box(
      style === "care" ? 0x74bbc6 : 0xb57652,
      0,
      height + 0.35,
      0,
      width + 0.65,
      0.7,
      depth + 0.65,
      id,
    );
    if (style === "home") {
      box(0x9f6248, 0, height + 0.8, 0, width * 0.72, 0.5, depth + 0.4, id);
      box(0xd9d1b9, width / 3, height + 1.2, -depth / 4, 0.8, 1.4, 0.8, id);
    } else {
      box(0x475862, -width / 4, height + 0.78, 0, width / 3, 0.12, depth / 2, id);
    }
    for (let level = 0; level < floors; level++) {
      for (let col = -width / 2 + 1.2; col < width / 2 - 0.5; col += 2.2) {
        for (const side of [-1, 1]) {
          box(0x355a69, col, 1.6 + level * 2.8, side * (depth / 2 + 0.04), 1.05, 1.2, 0.1, id);
        }
      }
    }
    box(0x355a69, 0, 1, depth / 2 + 0.08, 1.2, 2, 0.12, id);
    if (style === "care") {
      box(0x74bbc6, 0, 2.7, depth / 2 + 0.9, width * 0.7, 0.25, 2, id);
      box(0x74bbc6, 0, height + 0.8, 0, 3.5, 0.15, 1, id);
      box(0x74bbc6, 0, height + 0.82, 0, 1, 0.15, 3.5, id);
    }
  }
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const x = [-49, -40, -22, -11][col];
      const z = [-41, -33, -17, -9][row];
      building(
        x,
        z,
        5.5 + noise(seed + i) * 1.2,
        5.4,
        1 + Math.floor(noise(seed + i + 30) * 2),
        "home",
        i,
      );
    }
  }
  building(13, -35, 17, 15, 2, "care", 20);
  building(44, -35, 17, 14, 2, "care", 21);
  building(13, -12, 16, 12, 1, "care", 22);
  box(0x74bbc6, 29, 4.8, -35, 15, 0.8, 3);
  box(0x6c886a, 45, 0.1, -12, 17, 0.25, 13);
  for (let i = 0; i < 4; i++) box(0xb57652, 40 + i * 3, 0.6, -16, 2, 0.4, 0.8);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      building(
        [-48, -36, -9][col],
        [12, 38][row],
        8,
        9,
        2 + Math.floor(noise(seed + i + 81) * 3),
        "town",
        30 + i,
      );
    }
  }
  box(0xd0c5a7, -5, 0.18, 25, 19, 0.25, 22);
  box(0x8ba5a2, -3, 0.65, 34, 4, 1, 4);
  box(0x6baabd, -3, 1.18, 34, 3, 0.08, 3);
  building(10, 39, 12, 10, 3, "town", 40);
  box(0xd9d1b9, 10, 12.5, 39, 4, 8, 4);
  box(0xb57652, 10, 16.7, 39, 5, 0.6, 5);

  box(0x507e71, assembly.x, 0.3, 34, 29, 0.35, 24);
  for (const x of [26, 48]) {
    box(0xe5dfc7, x, 1.2, 39, 5, 2, 7);
    box(0x74bbc6, x, 2.5, 39, 5.5, 0.8, 7.5);
  }
  box(0x73e4cb, assembly.x, 0.51, 36, 5, 0.03, 0.9);
  box(0x73e4cb, assembly.x, 0.53, 36, 0.9, 0.03, 5);
  box(0xe5dfc7, 51, 4, 25, 0.25, 8, 0.25);
  box(0x73e4cb, 53, 7, 25, 4, 2, 0.1);
  const labels = districts.map((site) => label(site.label, site.x, site.z - 20));
  labels.push(label("Assembly", 42, 50, "#73e4cb"));
  labels.push(label("Synthetic terrain", -72, -57));

  const buildingMatrices = buildings.map(() => new THREE.Matrix4());
  const meshes = [...batches].map(([mat, parts]) => {
    const mesh = new THREE.InstancedMesh(cube, mat, parts.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, parts };
  });
  const matrix = new THREE.Matrix4();
  function updateDamage(
    severity: DrillConfig["severity"],
    quake: boolean,
    aftershock: boolean,
    shake = 0,
  ) {
    buildings.forEach((b, index) => {
      const level = quake ? damageLevel(b.seed, severity, aftershock) : 0;
      dummy.position.set(b.x, 0.3, b.z);
      dummy.rotation.set(0, 0, level * (noise(b.seed + 9) > 0.5 ? 0.06 : -0.06) + shake);
      dummy.scale.set(1, 1 - level * 0.17, 1);
      dummy.updateMatrix();
      buildingMatrices[index].copy(dummy.matrix);
    });
    for (const { mesh, parts } of meshes) {
      parts.forEach((part, index) => {
        matrix.copy(part.matrix);
        if (part.building !== undefined) matrix.premultiply(buildingMatrices[part.building]);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  updateDamage(config.severity, config.hazard === "earthquake", false);

  const treeGeometry = new THREE.ConeGeometry(1.7, 5, 6);
  const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.35, 2.2, 5);
  geometries.add(treeGeometry);
  geometries.add(trunkGeometry);
  const trees = Array.from({ length: 185 }, (_, i) => {
    const forest = i < 140;
    return {
      x: forest ? -91 + noise(seed + i * 11) * 25 : -51 + noise(seed + i * 11) * 101,
      z: forest ? -57 + noise(seed + i * 13) * 112 : i % 2 ? -58 : 58,
      scale: 0.7 + noise(seed + i * 17) * 0.65,
    };
  });
  const leaves = new THREE.InstancedMesh(treeGeometry, material(0xffffff), trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeometry, material(0x65594c), trees.length);
  trees.forEach((tree, index) => {
    dummy.position.copy(point(tree.x, tree.z, 1.1 * tree.scale));
    dummy.scale.setScalar(tree.scale);
    dummy.rotation.set(0, noise(seed + index) * 6, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 4 * tree.scale;
    dummy.updateMatrix();
    leaves.setMatrixAt(index, dummy.matrix);
    leaves.setColorAt(index, new THREE.Color(0x3f7255));
  });
  trunks.castShadow = true;
  leaves.castShadow = true;
  root.add(trunks, leaves);
  const hillGeometry = new THREE.IcosahedronGeometry(1, 1);
  geometries.add(hillGeometry);
  const hills = new THREE.InstancedMesh(hillGeometry, material(0x668578), 9);
  for (let i = 0; i < 9; i++) {
    dummy.position.set(-84 + i * 20, -4, -72);
    dummy.scale.set(20, 7 + noise(seed + i) * 8, 13);
    dummy.rotation.set(0, noise(seed + i) * 3, 0);
    dummy.updateMatrix();
    hills.setMatrixAt(i, dummy.matrix);
  }
  root.add(hills);
  return {
    root,
    materials,
    geometries,
    textures,
    buildings,
    trees,
    leaves,
    labels,
    updateDamage,
    label,
  };
}
