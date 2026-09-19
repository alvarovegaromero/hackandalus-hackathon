import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { drillMinute, type DrillRun, type SectorId } from "@/lib/emergency-drills";
import {
  alongPath,
  damageLevel,
  districts,
  evacuationPath,
  fireFront,
  missionPath,
  noise,
  pathHeading,
  point,
} from "./drill-scene-layout";
import { createWorld } from "./drill-scene-world";

export type CameraView = "overview" | "street" | "top";

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
  renderer.shadowMap.enabled = host.clientWidth >= 600;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "Synthetic training city. Select sectors with the buttons below. Drag to orbit; use camera and zoom buttons for keyboard control.",
  );
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x193440);
  const world = createWorld(initial.config);
  scene.add(world.root);
  const { materials, geometries, textures } = world;
  const camera = new THREE.PerspectiveCamera(39, 1, 0.5, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 28;
  controls.maxDistance = 560;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minPolarAngle = 0.01;
  scene.add(new THREE.HemisphereLight(0xe1f0ff, 0x536850, 2.6));
  const sun = new THREE.DirectionalLight(0xffead0, 3);
  sun.position.set(-50, 90, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 95, bottom: -95, far: 240 });
  sun.shadow.normalBias = 0.15;
  scene.add(sun);
  const dummy = new THREE.Object3D();

  function basic(color: number, opacity = 1) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
      side: THREE.DoubleSide,
    });
    materials.add(mat);
    return mat;
  }
  function standard(color: number) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    materials.add(mat);
    return mat;
  }
  function instances(geometry: THREE.BufferGeometry, mat: THREE.Material, count: number) {
    geometries.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, mat, count);
    mesh.frustumCulled = false;
    world.root.add(mesh);
    return mesh;
  }
  function setInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    position: THREE.Vector3,
    scale = 1,
    angle = 0,
    height = scale,
  ) {
    dummy.position.copy(position);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.set(scale, height, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  function line(points: THREE.Vector3[], color: number, closed = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color });
    materials.add(mat);
    geometries.add(geometry);
    const result = closed ? new THREE.LineLoop(geometry, mat) : new THREE.Line(geometry, mat);
    world.root.add(result);
    return result;
  }
  const pads = new Map<SectorId, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  const perimeters = new Map<SectorId, THREE.Line>();
  for (const site of districts) {
    const geometry = new THREE.PlaneGeometry(site.id === "central" ? 61 : 48, 38);
    geometries.add(geometry);
    const pad = new THREE.Mesh(geometry, basic(site.color, 0.12));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.x, 0.31, site.z);
    world.root.add(pad);
    pads.set(site.id, pad);
    perimeters.set(
      site.id,
      line(
        [
          point(site.x - 23, site.z - 19),
          point(site.x + 23, site.z - 19),
          point(site.x + 23, site.z + 19),
          point(site.x - 23, site.z + 19),
        ],
        0x73e4cb,
        true,
      ),
    );
  }
  const routeMaterial = basic(0x79d5ff);
  const routeSegments = instances(new THREE.BoxGeometry(0.7, 0.06, 1), routeMaterial, 180);
  const arrowGeometry = new THREE.ConeGeometry(0.9, 2.1, 3);
  arrowGeometry.rotateX(Math.PI / 2);
  const routeArrows = instances(arrowGeometry, routeMaterial, 28);
  const barricade = instances(new THREE.BoxGeometry(0.8, 1.1, 1.1), standard(0xffffff), 7);
  for (let i = 0; i < 7; i++) {
    setInstance(barricade, i, point(10, -3 + i, 0.75));
    barricade.setColorAt(i, new THREE.Color(i % 2 ? 0xffae66 : 0x625349));
  }
  const closureLabel = world.label("Main road closed", 10, 2);
  const rubble = instances(new THREE.DodecahedronGeometry(0.7, 0), standard(0x877c68), 210);
  const cracks = instances(
    new THREE.BoxGeometry(0.1, 1, 0.1),
    basic(0x50463f),
    world.buildings.length * 2,
  );
  const flames = instances(new THREE.ConeGeometry(0.9, 4, 5), basic(0xff822d), 120);
  const cores = instances(new THREE.ConeGeometry(0.5, 2.4, 5), basic(0xffd471), 120);
  const smoke = instances(new THREE.IcosahedronGeometry(1, 1), basic(0x929d9c, 0.24), 90);
  const burn = instances(new THREE.PlaneGeometry(1, 1), basic(0x433f30, 0.65), 32);
  const front = line(
    Array.from({ length: 33 }, () => point(0, 0)),
    0xffbb55,
  );
  const wind = new THREE.ArrowHelper(
    point(1, 0, 0).normalize(),
    point(-73, 53, 9),
    16,
    0xcce8e9,
    4,
    2,
  );
  world.root.add(wind);
  for (const object of [wind.line, wind.cone])
    for (const mat of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(mat);
  const windLabel = world.label("Wind", -72, 56);
  const waves = [0, 1, 2].map(() => {
    const geometry = new THREE.RingGeometry(1, 1.035, 64);
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, basic(0xf7c78d, 0.45));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-32, 0.8, -25);
    world.root.add(mesh);
    return mesh;
  });
  const people = instances(new THREE.CapsuleGeometry(0.3, 0.7, 2, 4), standard(0xffffff), 600);
  const heads = instances(new THREE.SphereGeometry(0.28, 5, 4), standard(0xfce9b8), 600);
  const vehicles = instances(new THREE.BoxGeometry(1.5, 1, 2.7), standard(0x63bce1), 120);
  const cabs = instances(new THREE.BoxGeometry(1.2, 0.65, 1.1), standard(0xe7f2ed), 120);
  const vehicleWindows = instances(new THREE.BoxGeometry(1, 0.4, 0.08), basic(0x294654), 120);

  let run = initial;
  let selected: SectorId = "care";
  let reducedMotion = false;
  let orbit = false;
  let disposed = false;
  let failed = false;
  let frame = 0;
  let dirty = true;
  let lastRender = 0;
  let lastDamage = "";
  let lastShadowPhase = "";
  let cameraView: CameraView = "overview";
  let statsStart = 0;
  let statsFrames = 0;
  let statsDuration = 0;

  function positionCamera(mode: CameraView) {
    cameraView = mode;
    camera.up.set(0, 1, 0);
    const site = districts.find((district) => district.id === selected)!;
    const target = mode === "street" ? point(site.x, site.z, 2) : point(-7, 0, 0);
    const offset =
      mode === "street"
        ? new THREE.Vector3(28, 25, 40)
        : mode === "top"
          ? new THREE.Vector3(0, 185, 0.1)
          : new THREE.Vector3(112, 125, 142);
    offset.multiplyScalar(Math.max(1, 1.5 / camera.aspect));
    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.update();
    dirty = true;
  }
  controls.addEventListener("change", () => {
    dirty = true;
  });
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
  const onLost = (event: Event) => {
    event.preventDefault();
    failed = true;
    cancelAnimationFrame(frame);
    onFailure();
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 600 ? 1 : 1.5));
    renderer.shadowMap.enabled = width >= 600;
    renderer.shadowMap.needsUpdate = true;
    renderer.setSize(width, height);
    positionCamera(cameraView);
  });
  resize.observe(host);

  function updateRoutes() {
    const mission = run.missions.find(
      (item) => item.sectorId === selected && item.arrivedAt === null,
    );
    const alternative = mission ? mission.route === "alternative" : run.phase >= 1 && run.routeOpen;
    const path = mission ? missionPath(mission) : evacuationPath(selected, alternative);
    let count = 0;
    let arrowCount = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      const length = a.distanceTo(b);
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      const pieces = Math.ceil(length / 2.5);
      for (let j = 0; j < pieces; j++) {
        if (count >= 180) break;
        const position = a.clone().lerp(b, (j + 0.5) / pieces);
        setInstance(routeSegments, count++, position, 1, angle, 1);
        dummy.scale.set(1, 1, (length / pieces) * (alternative ? 0.7 : 0.95));
        dummy.updateMatrix();
        routeSegments.setMatrixAt(count - 1, dummy.matrix);
      }
      if (length > 3 && arrowCount < 28)
        setInstance(routeArrows, arrowCount++, a.clone().lerp(b, 0.5), 1, angle);
    }
    routeSegments.count = count;
    routeArrows.count = arrowCount;
    routeSegments.instanceMatrix.needsUpdate = true;
    routeArrows.instanceMatrix.needsUpdate = true;
    routeMaterial.color.set(!run.routeOpen ? 0xffaf69 : alternative ? 0x73e4cb : 0x79d5ff);
  }

  function updateHazards(clock: number) {
    const quake = run.config.hazard === "earthquake";
    const aftershock = clock >= 15;
    const impulse = Math.max(0, 1 - (aftershock ? clock - 15 : clock) / (aftershock ? 1 : 1.5));
    const shake = quake && !reducedMotion ? Math.sin(clock * 28) * impulse * 0.004 : 0;
    const damageKey = `${quake}-${run.config.severity}-${aftershock}-${shake}`;
    const shadowPhase = `${quake}-${run.config.severity}-${aftershock}`;
    if (damageKey !== lastDamage) {
      world.updateDamage(run.config.severity, quake, aftershock, shake);
      if (shadowPhase !== lastShadowPhase) renderer.shadowMap.needsUpdate = true;
      lastDamage = damageKey;
      lastShadowPhase = shadowPhase;
    }
    let debrisCount = 0,
      crackCount = 0;
    for (const b of world.buildings) {
      const level = quake ? damageLevel(b.seed, run.config.severity, aftershock) : 0;
      if (!level) continue;
      for (let j = 0; j < level * 3; j++)
        setInstance(
          rubble,
          debrisCount++,
          point(b.x + (noise(b.seed + j) - 0.5) * 9, b.z + 4 + noise(b.seed + j + 10) * 2, 0.6),
          0.5 + noise(b.seed + j + 20),
          j,
        );
      for (let j = 0; j < 2; j++)
        setInstance(
          cracks,
          crackCount++,
          point(b.x + j * 1.5, b.z + b.depth / 2 + 0.12, b.height * 0.4),
          1,
          j * 0.7,
          b.height * 0.45,
        );
    }
    if (quake && clock >= 5)
      for (let i = 0; i < 12; i++)
        setInstance(
          rubble,
          debrisCount++,
          point(9 + noise(i) * 2, -3 + noise(i + 8) * 6, 0.6),
          0.8,
          i,
        );
    rubble.count = debrisCount;
    cracks.count = crackCount;
    rubble.instanceMatrix.needsUpdate = true;
    cracks.instanceMatrix.needsUpdate = true;
    barricade.visible = clock >= 5;
    if (closureLabel) closureLabel.visible = clock >= 5 && cameraView !== "street";
    for (const [i, wave] of waves.entries()) {
      wave.visible = quake && impulse > 0;
      wave.material.color.set(aftershock ? 0xf7a176 : 0xf7c78d);
      const radius = 7 + (((reducedMotion ? 0 : clock * 28) + i * 16) % 58);
      wave.scale.setScalar(radius);
      wave.material.opacity = impulse * 0.35 * (1 - radius / 75);
    }
    flames.visible = !quake;
    cores.visible = !quake;
    burn.visible = !quake;
    front.visible = !quake;
    wind.visible = !quake;
    if (windLabel) windLabel.visible = !quake && cameraView !== "street";
    wind.setDirection(point(aftershock ? 0.7 : 1, aftershock ? -0.7 : 0.25, 0).normalize());
    const positions = front.geometry.getAttribute("position");
    let flameCount = 0,
      smokeCount = 0;
    for (let i = 0; i < 33; i++) {
      const z = -57 + i * 3.5;
      const x = fireFront(z, clock, run.config.severity);
      positions.setXYZ(i, x, 0.8, z);
      if (i < 32) {
        const start = -95;
        dummy.position.set((x + start) / 2, 0.29, z + 1.75);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(Math.max(0, x - start), 3.6, 1);
        dummy.updateMatrix();
        burn.setMatrixAt(i, dummy.matrix);
      }
      if (quake) continue;
      for (let j = 0; j < 3; j++) {
        const px = x - j * 2.1,
          pz = z + noise(i * 11 + j) * 2;
        const scale = 0.7 + noise(i * 5 + j) * 0.6;
        const height = scale * (1 + Math.sin(clock * 13 + i + j) * (reducedMotion ? 0 : 0.15));
        setInstance(
          flames,
          flameCount,
          point(px, pz, height * 2),
          scale,
          (reducedMotion ? 0 : clock) + i,
          height,
        );
        setInstance(cores, flameCount++, point(px + 0.25, pz, height), scale, 0, height);
      }
      if (i % 2 === 0)
        for (let j = 0; j < 4; j++) {
          const rise = 2 + j * 3 + noise(i) * 2;
          const driftX = rise * (aftershock ? 0.7 : 1);
          const driftZ = rise * (aftershock ? -0.7 : 0.25);
          setInstance(
            smoke,
            smokeCount++,
            point(x + driftX, z + driftZ, rise + 2),
            1.8 + rise * 0.18,
            i,
            2 + rise * 0.16,
          );
        }
    }
    if (!quake && clock >= 5)
      for (let i = 0; i < 7; i++) {
        setInstance(flames, flameCount, point(10, -3 + i, 1.8), 0.9);
        setInstance(cores, flameCount++, point(10.2, -3 + i, 1), 0.7);
      }
    if (quake && impulse > 0)
      world.buildings.forEach((b) => {
        if (damageLevel(b.seed, run.config.severity, aftershock) && smokeCount < 90)
          setInstance(
            smoke,
            smokeCount++,
            point(b.x, b.z, 2 + (1 - impulse) * 4),
            2 + (1 - impulse) * 2,
          );
      });
    smoke.visible = smokeCount > 0;
    smoke.count = smokeCount;
    flames.count = flameCount;
    cores.count = flameCount;
    for (const mesh of [smoke, flames, cores, burn]) mesh.instanceMatrix.needsUpdate = true;
    positions.needsUpdate = true;
    front.geometry.computeBoundingSphere();
    const green = new THREE.Color(0x3f7255),
      charred = new THREE.Color(0x51493a);
    world.trees.forEach((tree, index) => {
      const scorched = !quake && tree.x < fireFront(tree.z, clock, run.config.severity) - 2;
      world.leaves.setColorAt(index, scorched ? charred : green);
    });
    if (world.leaves.instanceColor) world.leaves.instanceColor.needsUpdate = true;
  }

  function updatePeople() {
    let count = 0,
      teamCount = 0,
      cohortStart = 0;
    const peopleScale = run.config.population / 110;
    const person = (position: THREE.Vector3, angle: number, safe: boolean) => {
      if (count >= 600) return;
      position.y = 1.05;
      setInstance(people, count, position, 1, angle);
      people.setColorAt(count, new THREE.Color(safe ? 0x83f0c8 : 0xffdc8b));
      const head = position.clone();
      head.y += 0.65;
      setInstance(heads, count++, head, 1, angle);
    };
    const team = (position: THREE.Vector3, angle: number) => {
      if (teamCount >= 120) return;
      position.y = 0.85;
      setInstance(vehicles, teamCount, position, 1, angle);
      const cab = position.clone();
      cab.y = 1.65;
      setInstance(cabs, teamCount, cab, 1, angle);
      cab.x += Math.sin(angle) * 0.57;
      cab.z += Math.cos(angle) * 0.57;
      setInstance(vehicleWindows, teamCount++, cab, 1, angle);
    };
    for (const [siteIndex, site] of districts.entries()) {
      const sector = run.sectors.find((s) => s.id === site.id)!;
      const inTransit = run.missions
        .filter((m) => m.sectorId === site.id && m.arrivedAt === null)
        .reduce((total, m) => total + m.people, 0);
      const waiting = Math.ceil((sector.population - sector.evacuated - inTransit) / peopleScale);
      for (let i = 0; i < waiting; i++)
        person(
          point(site.x + ((i % 5) - 2) * 0.8, site.z - 3 + Math.floor(i / 5) * 0.6),
          Math.PI,
          false,
        );
      if (run.modelVersion === 1)
        for (let i = 0; i < Math.ceil(sector.evacuated / peopleScale); i++)
          person(point(28 + (i % 9), 28 + siteIndex * 3 + Math.floor(i / 9)), 0, true);
    }
    for (const mission of run.missions) {
      const path = missionPath(mission);
      const center = alongPath(path, mission.progress);
      const angle = pathHeading(path, mission.progress);
      const members = Math.max(1, Math.ceil(mission.people / peopleScale));
      const originProgress = mission.reroutedFrom ?? 0;
      const journeyProgress = originProgress + (1 - originProgress) * mission.progress;
      const gather = Math.max(0, (journeyProgress - 0.88) / 0.12);
      for (let i = 0; i < members; i++) {
        const index = cohortStart + i;
        const position = center.clone();
        position.x += THREE.MathUtils.lerp(((i % 3) - 1) * 0.8, ((index % 15) - 7) * 0.8, gather);
        position.z += THREE.MathUtils.lerp(
          (Math.floor(i / 3) - 1) * 0.6,
          Math.floor(index / 15) * 0.8,
          gather,
        );
        person(position, angle, mission.arrivedAt !== null);
      }
      cohortStart += members;
      if (mission.arrivedAt === null) team(center.clone().add(point(1.5, 0, 0)), angle);
    }
    for (const entry of run.log) {
      if (
        entry.kind !== "decision" ||
        !entry.sectorId ||
        entry.action === "evacuate" ||
        (run.modelVersion === 3
          ? !run.reservations?.some((reservation) => reservation.decisionId === entry.id)
          : entry.minute < run.phase * 5)
      )
        continue;
      const site = districts.find((s) => s.id === entry.sectorId)!;
      if (entry.action === "assess" || entry.action === "protect")
        team(point(site.x + 3, site.z - 3), 0);
    }
    people.count = count;
    heads.count = count;
    vehicles.count = teamCount;
    cabs.count = teamCount;
    vehicleWindows.count = teamCount;
    for (const mesh of [people, heads, vehicles, cabs, vehicleWindows])
      mesh.instanceMatrix.needsUpdate = true;
    if (people.instanceColor) people.instanceColor.needsUpdate = true;
  }

  function render(now: number) {
    if (disposed || failed) return;
    frame = requestAnimationFrame(render);
    if (document.hidden || now - lastRender < 32) return;
    if (!dirty && !(orbit && !reducedMotion)) return;
    lastRender = now;
    const started = performance.now();
    if (dirty) {
      const clock = drillMinute(run);
      updateRoutes();
      updateHazards(clock);
      updatePeople();
      for (const [id, pad] of pads) {
        pad.material.opacity = id === selected ? 0.2 : 0.05;
        perimeters.get(id)!.visible = run.sectors.find((sector) => sector.id === id)!.protected;
      }
      world.labels.forEach((label, index) => {
        if (label) label.visible = cameraView !== "street" || districts[index]?.id === selected;
      });
      host.dataset.drillMinute = String(clock);
      host.dataset.drillMissions = JSON.stringify(
        run.missions.map((mission) => ({
          progress: mission.progress,
          route: mission.route,
          arrivedAt: mission.arrivedAt,
          position: alongPath(missionPath(mission), mission.progress).toArray(),
        })),
      );
    }
    controls.autoRotate = orbit && !reducedMotion;
    controls.autoRotateSpeed = 0.4;
    controls.update();
    renderer.render(scene, camera);
    dirty = false;
    if (!statsStart) statsStart = now;
    statsFrames++;
    statsDuration += performance.now() - started;
    host.dataset.drillRenderer = JSON.stringify({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      pixelRatio: renderer.getPixelRatio(),
      shadows: renderer.shadowMap.enabled,
      frames: statsFrames,
      elapsedMs: Math.round(now - statsStart),
      averageCpuMs: Math.round((statsDuration / statsFrames) * 100) / 100,
    });
  }
  frame = requestAnimationFrame(render);
  return {
    update(next: DrillRun, sector: SectorId, animate: boolean, reduce: boolean) {
      const changedSector = selected !== sector;
      run = next;
      selected = sector;
      host.dataset.drillPlaying = String(animate);
      reducedMotion = reduce;
      dirty = true;
      if (changedSector && cameraView === "street") positionCamera("street");
    },
    view(mode: CameraView) {
      positionCamera(mode);
    },
    setOrbit(value: boolean) {
      orbit = value;
      dirty = true;
    },
    zoom(direction: number) {
      const offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar(direction > 0 ? 0.85 : 1.15);
      offset.setLength(
        THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance),
      );
      camera.position.copy(controls.target).add(offset);
      controls.update();
      dirty = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
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
      delete host.dataset.drillRenderer;
      delete host.dataset.drillMissions;
      delete host.dataset.drillMinute;
      delete host.dataset.drillPlaying;
    },
  };
}

export type DrillScene = ReturnType<typeof createDrillScene>;
