import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { drillMinute, type DrillRun, type SectorId } from "@/lib/emergency-drills";

const districts = [
  { id: "residential", x: -31, z: -25, color: 0xe9c78c },
  { id: "care", x: 29, z: -25, color: 0x91c4d0 },
  { id: "central", x: -14, z: 25, color: 0xc8b4e5 },
] as const;
export type CameraView = "overview" | "street" | "top";

function noise(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function evacuationPath(id: SectorId, alternative: boolean): THREE.Vector3[] {
  const district = districts.find((site) => site.id === id)!;
  return alternative
    ? [
        new THREE.Vector3(district.x, 0.8, district.z),
        new THREE.Vector3(district.x < 0 ? -58 : 58, 0.8, district.z),
        new THREE.Vector3(district.x < 0 ? -58 : 58, 0.8, 48),
        new THREE.Vector3(39, 0.8, 48),
        new THREE.Vector3(39, 0.8, 28),
      ]
    : [
        new THREE.Vector3(district.x, 0.8, district.z),
        new THREE.Vector3(district.x, 0.8, 0),
        new THREE.Vector3(39, 0.8, 0),
        new THREE.Vector3(39, 0.8, 28),
      ];
}

function alongPath(points: THREE.Vector3[], progress: number): THREE.Vector3 {
  const lengths = points.slice(1).map((point, index) => point.distanceTo(points[index]));
  let distance =
    lengths.reduce((sum, length) => sum + length, 0) * THREE.MathUtils.clamp(progress, 0, 1);
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index])
      return points[index].clone().lerp(points[index + 1], distance / lengths[index]);
    distance -= lengths[index];
  }
  return points[points.length - 1].clone();
}

export function createDrillScene(
  host: HTMLDivElement,
  initial: DrillRun,
  onSelect: (sector: SectorId) => void,
  onFailure: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D training city. Drag to orbit; use the sector buttons for keyboard selection.",
  );
  renderer.domElement.setAttribute("role", "img");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x152936);
  scene.fog = new THREE.FogExp2(0x152936, 0.0022);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 700);
  camera.position.set(110, 100, 125);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 45;
  controls.maxDistance = 450;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = 0.08;
  controls.enablePan = false;
  scene.add(new THREE.HemisphereLight(0xd4ebff, 0x586258, 2.7));
  const sun = new THREE.DirectionalLight(0xffe4bf, 4);
  sun.position.set(-45, 95, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.camera.far = 230;
  sun.shadow.normalBias = 0.08;
  scene.add(sun);
  const city = new THREE.Group();
  scene.add(city);
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  function label(text: string, x: number, z: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#183c4b";
    context.fillRect(0, 0, 256, 80);
    context.strokeStyle = "#a9d2de";
    context.lineWidth = 4;
    context.strokeRect(2, 2, 252, 76);
    context.fillStyle = "#e6f4f6";
    context.font = "500 30px sans-serif";
    context.textAlign = "center";
    context.fillText(text, 128, 51);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    materials.add(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, 15, z);
    sprite.scale.set(15, 4.7, 1);
    sprite.renderOrder = 3;
    city.add(sprite);
  }
  function material(color: number, options: THREE.MeshStandardMaterialParameters = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...options });
    materials.add(result);
    return result;
  }
  const asphalt = material(0x384752);
  const concrete = material(0xa1a59b);
  const grass = material(0x68745c);
  const ivory = material(0xe1d6ba);
  const roof = material(0xa76248);
  const glass = material(0x375966, { metalness: 0.25, roughness: 0.35 });
  const white = material(0xe4e7df);
  const teal = material(0x73e4cb, { emissive: 0x277b69, emissiveIntensity: 0.4 });
  function box<M extends THREE.Material>(
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    mat: M,
    x: number,
    y: number,
    z: number,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  box(city, 144, 3, 120, material(0x414d49), 0, -2.2, 0);
  box(city, 142, 0.5, 118, grass, 0, -0.45, 0);
  box(city, 128, 0.2, 8, asphalt, 0, 0, 0);
  box(city, 7, 0.2, 105, asphalt, 0, 0, 0);
  box(city, 7, 0.22, 105, asphalt, -58, 0, 0);
  box(city, 7, 0.22, 105, asphalt, 58, 0, 0);
  box(city, 120, 0.22, 6, asphalt, 0, 0, 48);
  box(city, 120, 0.22, 6, asphalt, 0, 0, -48);
  box(city, 5, 0.22, 30, asphalt, 39, 0, 15);
  for (let i = -14; i <= 14; i++) {
    box(city, 2, 0.05, 0.15, white, i * 4, 0.15, 0);
    if (Math.abs(i) < 12) box(city, 0.15, 0.05, 2, white, 0, 0.15, i * 4);
  }
  for (let i = 0; i < 6; i++) {
    box(city, 0.65, 0.06, 6, white, 7 + i * 1.4, 0.15, 0);
  }
  const pads = new Map<SectorId, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  const perimeters = new Map<SectorId, THREE.LineLoop>();
  const buildings: {
    mesh: THREE.Group;
    id: SectorId;
    height: number;
    seed: number;
    x: number;
    z: number;
  }[] = [];
  const dummy = new THREE.Object3D();
  const coordinateSeed = Math.round(
    initial.config.latitude * 1000 + initial.config.longitude * 1000,
  );
  for (const [sectorIndex, site] of districts.entries()) {
    label(["A · Residential", "B · Care", "C · Centre"][sectorIndex], site.x, site.z);
    const pad = box(city, 42, 0.45, 33, material(site.color), site.x, 0, site.z);
    pad.material.transparent = true;
    pad.material.opacity = 0.28;
    pads.set(site.id, pad);
    const corners = [
      [-21, -17],
      [21, -17],
      [21, 17],
      [-21, 17],
    ].map(([x, z]) => new THREE.Vector3(site.x + x, 0.8, site.z + z));
    const boundaryMaterial = new THREE.LineBasicMaterial({ color: 0x83edd0 });
    materials.add(boundaryMaterial);
    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(corners),
      boundaryMaterial,
    );
    city.add(boundary);
    perimeters.set(site.id, boundary);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const seed = coordinateSeed + sectorIndex * 40 + row * 4 + col;
        const height = 3 + Math.floor(noise(seed) * 4) * 2.3;
        const x = site.x - 15 + col * 10;
        const z = site.z - 11 + row * 10.5;
        const group = new THREE.Group();
        group.position.set(x, 0.4, z);
        city.add(group);
        const facade = material(
          [0xd8cdb6, 0xc2c4b6, 0xe8d9bd, 0xb9c5c2][Math.floor(noise(seed + 1) * 4)],
        );
        box(group, 7, height, 6.8, facade, 0, height / 2, 0);
        box(group, 7.5, 0.65, 7.3, site.id === "care" ? white : roof, 0, height, 0);
        box(group, 1.7, 0.8, 1.7, concrete, 1.2, height + 0.6, -1);
        const windows: THREE.Matrix4[] = [];
        for (let level = 1.6; level < height; level += 2.3) {
          for (let column = -2.2; column <= 2.2; column += 2.2) {
            for (const side of [-1, 1]) {
              dummy.position.set(column, level, side * 3.42);
              dummy.scale.set(1.15, 1.25, 0.08);
              dummy.rotation.set(0, 0, 0);
              dummy.updateMatrix();
              windows.push(dummy.matrix.clone());
            }
          }
        }
        const panes = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          glass,
          windows.length,
        );
        windows.forEach((matrix, index) => panes.setMatrixAt(index, matrix));
        group.add(panes);
        if (site.id === "care" && row === 1 && col === 1) {
          box(group, 3.6, 0.15, 0.9, material(0xbc473d), 0, height + 0.5, 0);
          box(group, 0.9, 0.15, 3.6, material(0xbc473d), 0, height + 0.5, 0);
        }
        buildings.push({ mesh: group, id: site.id, height, seed, x, z });
      }
    }
  }
  const treeCount = 160;
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.35, 2, 5),
    material(0x675746),
    treeCount,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 6, 7),
    material(0x3f6757),
    treeCount,
  );
  for (let i = 0; i < treeCount; i++) {
    const forest = i < 115;
    const x = forest ? -83 + noise(i + 2) * 22 : -65 + noise(i + 22) * 130;
    const z = forest ? -53 + noise(i + 5) * 106 : i % 2 ? -55 : 55;
    dummy.rotation.set(0, noise(i) * 3, 0);
    dummy.scale.setScalar(0.7 + noise(i + 1) * 0.5);
    dummy.position.set(x, 1, z);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 4;
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  trunks.castShadow = true;
  leaves.castShadow = true;
  city.add(trunks, leaves);
  for (let i = 0; i < 7; i++) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(22 + noise(i) * 18, 10 + noise(i + 1) * 25, 6),
      material(0x445c58),
    );
    mountain.position.set(-100 + i * 35, -1, -87 - noise(i + 3) * 10);
    mountain.rotation.y = i;
    city.add(mountain);
  }
  box(city, 23, 0.25, 25, material(0x66837a), 39, 0.1, 30);
  for (let i = 0; i < 3; i++) {
    const tent = new THREE.Mesh(new THREE.ConeGeometry(3.7, 3.5, 4), ivory);
    tent.rotation.y = Math.PI / 4;
    tent.position.set(33 + i * 6, 2, 37);
    tent.castShadow = true;
    city.add(tent);
  }
  box(city, 5, 0.12, 0.9, teal, 39, 0.35, 25);
  box(city, 0.9, 0.12, 5, teal, 39, 0.35, 25);
  label("Assembly point", 39, 29);
  const routes = new THREE.Group();
  city.add(routes);
  for (const site of districts) {
    for (const alternative of [false, true]) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        evacuationPath(site.id, alternative),
      );
      const mat = new THREE.LineDashedMaterial({
        color: alternative ? 0x7de9c7 : 0x71c7ff,
        dashSize: 1.4,
        gapSize: 0.8,
      });
      materials.add(mat);
      const line = new THREE.Line(geometry, mat);
      line.name = `${site.id}-${alternative ? "alternative" : "main"}`;
      line.computeLineDistances();
      routes.add(line);
    }
  }
  const barricade = new THREE.Group();
  for (let i = 0; i < 5; i++)
    box(barricade, 1.1, 1.2, 0.65, material(i % 2 ? 0xe47c48 : 0xf8ddb0), i * 1.3 - 2.6, 0.6, 0);
  barricade.position.set(10, 0, 0);
  barricade.rotation.y = Math.PI / 2;
  city.add(barricade);
  const rubble = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.7, 0),
    material(0x958c7c),
    130,
  );
  city.add(rubble);
  for (let i = 0; i < 130; i++) {
    const b = buildings[i % buildings.length];
    dummy.position.set(b.x + 4 + noise(i) * 3, 0.6, b.z - 4 + noise(i + 4) * 8);
    dummy.rotation.set(noise(i) * 4, noise(i + 1) * 4, 0);
    dummy.scale.setScalar(0.3 + noise(i + 2));
    dummy.updateMatrix();
    rubble.setMatrixAt(i, dummy.matrix);
  }
  const flameMaterial = material(0xff7626, {
    emissive: 0xff6310,
    emissiveIntensity: 3,
    transparent: true,
    opacity: 0.9,
  });
  const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(1.2, 5, 5), flameMaterial, 80);
  const smokeMaterial = material(0x727a79, { transparent: true, opacity: 0.28, depthWrite: false });
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2, 1), smokeMaterial, 90);
  flames.frustumCulled = false;
  smoke.frustumCulled = false;
  city.add(flames, smoke);
  const fireLight = new THREE.PointLight(0xff7025, 150, 90, 1.8);
  fireLight.position.set(-55, 10, 0);
  city.add(fireLight);
  const waves = [0, 1, 2].map(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf2bb7a,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.add(mat);
    const wave = new THREE.Mesh(new THREE.RingGeometry(1, 1.025, 80), mat);
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(-30, 0.8, -20);
    city.add(wave);
    return wave;
  });
  const personGeometry = new THREE.CapsuleGeometry(0.25, 0.65, 2, 4);
  const people = new THREE.InstancedMesh(personGeometry, material(0xf2d899), 400);
  const teams = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 1.1, 3), material(0x80cdeb), 24);
  people.castShadow = true;
  teams.castShadow = true;
  people.frustumCulled = false;
  teams.frustumCulled = false;
  city.add(people, teams);
  const positions = new Map<string, number>();
  let run = initial;
  let selected: SectorId = "care";
  let moving = false;
  let reducedMotion = false;
  let orbit = false;
  let disposed = false;
  let frame = 0;
  let updateTime = performance.now();
  let lastRender = 0;
  let cameraView: CameraView = "overview";
  function positionCamera(mode: CameraView) {
    cameraView = mode;
    camera.position.set(
      ...((mode === "street" ? [82, 31, 90] : mode === "top" ? [0, 170, 0.1] : [110, 100, 125]) as [
        number,
        number,
        number,
      ]),
    );
    camera.position.multiplyScalar(Math.max(1, 1.15 / camera.aspect));
    controls.target.set(0, 0, 0);
    controls.update();
  }
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0 };
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...pads.values()])[0];
    const site = [...pads].find(([, pad]) => pad === hit?.object);
    if (site) onSelect(site[0]);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  const onLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    onFailure();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    positionCamera(cameraView);
    renderer.setSize(width, height);
  });
  resize.observe(host);
  const setInstance = (
    mesh: THREE.InstancedMesh,
    index: number,
    position: THREE.Vector3,
    scale = 1,
    angle = 0,
  ) => {
    dummy.position.copy(position);
    dummy.scale.setScalar(scale);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };
  function render(now: number) {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    if (document.hidden || now - lastRender < 32) return;
    lastRender = now;
    const clock = drillMinute(run);
    const time = clock + (moving && !reducedMotion ? Math.min(0.24, (now - updateTime) / 4000) : 0);
    const visual = reducedMotion ? clock : time;
    const quake = run.config.hazard === "earthquake";
    const impulse = Math.max(0, 1 - (visual >= 15 ? visual - 15 : visual) / 1.3);
    city.position.x = quake && moving && !reducedMotion ? Math.sin(now * 0.035) * impulse * 0.3 : 0;
    barricade.visible = !run.routeOpen;
    rubble.visible = quake;
    flames.visible = !quake;
    smoke.visible = !quake || clock >= 15;
    fireLight.visible = !quake;
    for (const [id, pad] of pads) {
      pad.material.opacity = id === selected ? 0.55 : 0.2;
      const sector = run.sectors.find((item) => item.id === id)!;
      perimeters.get(id)!.visible = sector.protected;
    }
    for (const b of buildings) {
      const damage =
        (run.config.severity === "extreme" ? 0.5 : run.config.severity === "severe" ? 0.35 : 0.23) +
        (run.phase >= 3 ? 0.2 : 0);
      const damaged = quake && noise(b.seed) < damage;
      b.mesh.rotation.z = damaged ? (noise(b.seed + 6) - 0.5) * 0.12 * (1 + run.phase / 4) : 0;
      b.mesh.position.y = damaged ? -b.height * (run.phase >= 3 ? 0.14 : 0.06) : 0.4;
    }
    for (const [index, wave] of waves.entries()) {
      wave.visible = quake && impulse > 0;
      const radius = 6 + ((visual * 40 + index * 18) % 60);
      wave.scale.setScalar(radius);
      wave.material.opacity = 0.6 * (1 - radius / 70);
    }
    for (let i = 0; i < 80; i++) {
      const district = districts[i % districts.length];
      const sector = run.sectors.find((item) => item.id === district.id)!;
      const reach =
        -70 +
        visual * (run.config.severity === "extreme" ? 2.8 : 2.1) +
        Math.max(0, visual - 15) * 1.1;
      const x = reach - noise(i + 3) * 16;
      const z = -47 + noise(i) * 94;
      const protectedArea = run.sectors.some((item) => {
        const site = districts.find((value) => value.id === item.id)!;
        return item.protected && Math.abs(x - site.x) < 23 && Math.abs(z - site.z) < 19;
      });
      const scale = protectedArea ? 0.05 : 0.8 + noise(i) * 0.7;
      dummy.position.set(x, 2 * scale, z);
      dummy.rotation.set(0, noise(i) * 6, Math.sin(visual * 12 + i) * 0.15);
      dummy.scale.set(scale, scale * (1.1 + Math.sin(visual * 18 + i) * 0.3), scale);
      dummy.updateMatrix();
      flames.setMatrixAt(i, dummy.matrix);
      const puff = (visual * 3 + i * 0.27) % 12;
      const smokeX = quake ? district.x + noise(i) * 10 : x + puff * (clock >= 15 ? 2.5 : 0.8);
      setInstance(
        smoke,
        i,
        new THREE.Vector3(smokeX, puff * 1.5 + 2, z + puff * (clock >= 15 ? -1.6 : 0.8)),
        (1 + puff * 0.13) * (quake ? sector.risk / 130 : 1),
      );
    }
    smoke.count = 80;
    flames.instanceMatrix.needsUpdate = true;
    smoke.instanceMatrix.needsUpdate = true;
    let personCount = 0;
    let teamCount = 0;
    for (const site of districts) {
      const sector = run.sectors.find((item) => item.id === site.id)!;
      const enRoute = run.missions
        .filter((mission) => mission.sectorId === site.id && mission.arrivedAt === null)
        .reduce((sum, mission) => sum + mission.people, 0);
      const waiting = Math.ceil(
        ((sector.population - sector.evacuated - enRoute) / run.config.population) * 120,
      );
      for (let i = 0; i < waiting; i++) {
        const x = site.x - 18 + noise(i + 52) * 36;
        const z = site.z + 15 + noise(i + 14) * 1.8;
        setInstance(people, personCount++, new THREE.Vector3(x, 1, z), 1.15);
      }
      const safe = Math.ceil((sector.evacuated / run.config.population) * 120);
      for (let i = 0; i < safe; i++) {
        setInstance(
          people,
          personCount++,
          new THREE.Vector3(31 + noise(i + site.x) * 16, 1, 18 + noise(i + site.z) * 13),
          1.15,
        );
      }
    }
    for (const mission of run.missions) {
      if (mission.arrivedAt !== null) continue;
      const positionKey = `${mission.id}-${mission.route}`;
      const old = positions.get(positionKey) ?? mission.progress;
      const progress =
        moving && !reducedMotion
          ? THREE.MathUtils.lerp(old, mission.progress, 0.24)
          : mission.progress;
      positions.set(positionKey, progress);
      const path = evacuationPath(mission.sectorId, mission.route === "alternative");
      if (mission.reroutedFrom !== undefined) {
        const origin = alongPath(evacuationPath(mission.sectorId, false), mission.reroutedFrom);
        path[0] = origin;
        path[1].z = origin.z;
      }
      const count = Math.max(3, Math.ceil((mission.people / run.config.population) * 120));
      for (let i = 0; i < count; i++) {
        const point = alongPath(path, Math.max(0, progress - i * 0.004));
        point.x += ((i % 3) - 1) * 0.75;
        point.y =
          1 + (moving && !reducedMotion && run.routeOpen ? Math.sin(now * 0.012 + i) * 0.08 : 0);
        setInstance(people, personCount++, point, 1.15);
      }
      const teamPoint = alongPath(path, Math.min(1, progress + 0.02));
      const next = alongPath(path, Math.min(1, progress + 0.03));
      if (teamCount < 24)
        setInstance(
          teams,
          teamCount++,
          teamPoint,
          1,
          Math.atan2(next.x - teamPoint.x, next.z - teamPoint.z),
        );
    }
    const deployments = run.log.filter(
      (entry) =>
        entry.kind === "decision" &&
        (entry.action === "assess" || entry.action === "protect" || entry.action === "reroute") &&
        entry.minute >= run.phase * 5,
    );
    for (const entry of deployments) {
      if (teamCount >= 24) break;
      const site = districts.find((item) => item.id === entry.sectorId)!;
      const progress = Math.min(1, (time - entry.minute) / 1.5);
      const path = evacuationPath(site.id, false).toReversed();
      setInstance(teams, teamCount++, alongPath(path, progress));
    }
    people.count = personCount;
    teams.count = teamCount;
    people.instanceMatrix.needsUpdate = true;
    teams.instanceMatrix.needsUpdate = true;
    for (const route of routes.children)
      route.visible =
        route.name === `${selected}-${run.phase >= 1 && run.routeOpen ? "alternative" : "main"}`;
    controls.autoRotate = orbit && !reducedMotion;
    controls.autoRotateSpeed = 0.4;
    controls.update();
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(render);
  return {
    update(next: DrillRun, sector: SectorId, animate: boolean, reduce: boolean) {
      if (next.id !== run.id || drillMinute(next) < drillMinute(run)) positions.clear();
      run = next;
      selected = sector;
      moving = animate;
      reducedMotion = reduce;
      updateTime = performance.now();
    },
    view(mode: CameraView) {
      positionCamera(mode);
    },
    setOrbit(value: boolean) {
      orbit = value;
    },
    zoom(direction: number) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(direction > 0 ? 0.85 : 1.15)
        .add(controls.target);
      controls.update();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line)
          geometries.add(object.geometry);
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((mat) => mat.dispose());
      textures.forEach((texture) => texture.dispose());
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export type DrillScene = ReturnType<typeof createDrillScene>;
