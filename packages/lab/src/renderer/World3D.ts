import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, regionAt, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';
import { KIND_UNKNOWN, type FrameMessage, type ResourcePayload, type StructureUpdate } from './sim/protocol.js';

// Resource node → marker colour. Trees/rivers are skipped (decor + water cover them).
const RESOURCE_RGB: Record<string, [number, number, number]> = {
  berryBush: [0.25, 0.7, 0.25], foodPlant: [0.25, 0.7, 0.25], tuberPlant: [0.55, 0.62, 0.25],
  mushroomPatch: [0.78, 0.28, 0.2], fiberPlant: [0.74, 0.66, 0.42], nightshadePlant: [0.5, 0.25, 0.6],
  waterSource: [0.27, 0.56, 0.85], stoneDeposit: [0.55, 0.55, 0.58], clayDeposit: [0.62, 0.42, 0.25],
  saltFlat: [0.85, 0.85, 0.88], copperVein: [0.72, 0.45, 0.2], tinVein: [0.6, 0.62, 0.66],
  ironVein: [0.5, 0.44, 0.4], coalSeam: [0.13, 0.13, 0.15], silverVein: [0.8, 0.82, 0.88],
  goldVein: [0.83, 0.69, 0.22], gemVein: [0.31, 0.81, 0.75],
};
const ANIMAL_RGB: Record<string, THREE.Color> = {
  deer: new THREE.Color(0.55, 0.4, 0.26),
  hare: new THREE.Color(0.66, 0.62, 0.55),
  boar: new THREE.Color(0.28, 0.24, 0.22),
  fish: new THREE.Color(0.4, 0.6, 0.78),
  wolf: new THREE.Color(0.5, 0.5, 0.54), // predators
  bear: new THREE.Color(0.34, 0.22, 0.16),
  crocodile: new THREE.Color(0.2, 0.34, 0.2),
};
const ANIMAL_SIZE: Record<string, number> = { hare: 0.65, deer: 1, boar: 1.1, fish: 0.6, wolf: 1.15, bear: 1.6, crocodile: 1.5 };
const DEFAULT_ANIMAL_RGB = ANIMAL_RGB['deer']!;

const HSCALE = 9; // vertical exaggeration of the heightmap
const SEA = 0.85; // sea level in world-height units
const GRID = 200; // terrain resolution
const HALF = WORLD / 2;

const REGION_RGB: Record<Region, [number, number, number]> = {
  river: [0.2, 0.45, 0.34],
  coast: [0.72, 0.66, 0.43],
  lake: [0.16, 0.34, 0.42],
  wetland: [0.24, 0.36, 0.26],
  forest: [0.12, 0.32, 0.15],
  mountain: [0.42, 0.4, 0.44],
  hills: [0.4, 0.36, 0.22],
  plains: [0.3, 0.44, 0.21],
};

const STATE_RGB: THREE.Color[] = [
  new THREE.Color(0.26, 0.82, 0.54),
  new THREE.Color(0.88, 0.6, 0.23),
  new THREE.Color(0.36, 0.55, 0.82),
  new THREE.Color(0.88, 0.32, 0.3),
];

function hash2(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Instance capacity for `n` things — grown with headroom, never shrunk. */
function capacityFor(n: number): number {
  return Math.max(64, Math.ceil(n * 1.5));
}

/**
 * A 3D view of the same continent the sim runs on (terrain from the engine's
 * heightAt/regionAt), ringed by a boundary wall. Beings are instanced capsules
 * on the surface; built structures appear as huts/walls/containers; clicking a
 * being selects it.
 *
 * It consumes frames from the sim worker as typed arrays and writes them
 * straight into instance matrices — no per-frame maps, no arrays of objects,
 * and the instance capacity grows with the population, so a being is never
 * silently dropped from the view.
 */
export class World3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private agents: THREE.InstancedMesh | null = null;
  private instanceIds = new Int32Array(0);
  /** Scene-space centre of each drawn being, for the selection probe. */
  private instancePos = new Float32Array(0);
  private instanceCount = 0;
  private resourceMesh: THREE.InstancedMesh | null = null;
  private animalMesh: THREE.InstancedMesh | null = null;
  /** Animal kind names by wire code, extended as the worker assigns them. */
  private animalKinds: string[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly structureGroup = new THREE.Group();
  private readonly seenStructures = new Set<number>();
  private selectionMarker: THREE.Mesh;
  private selectedId: number | null = null;
  private ro: ResizeObserver | null = null;
  private downX = 0;
  private downY = 0;
  /** Alive in the sim but not drawn by this view. Expected to stay 0. */
  private hiddenBeings = 0;
  private hiddenWildlife = 0;
  private readonly probe = new THREE.Vector3();
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect?: (id: number | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color('#0a0e12');
    this.scene.fog = new THREE.Fog('#0a0e12', WORLD * 0.5, WORLD * 1.3);

    this.camera = new THREE.PerspectiveCamera(48, 1, 1, WORLD * 6);
    this.camera.position.set(-WORLD * 0.42, WORLD * 0.42, WORLD * 0.55);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 120;
    this.controls.maxDistance = WORLD * 2;
    this.controls.target.set(0, 10, 0);

    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x2a2a1f, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
    sun.position.set(WORLD * 0.3, WORLD * 0.6, WORLD * 0.2);
    this.scene.add(sun);

    this.buildTerrain();
    this.buildWater();
    this.buildWall();
    this.buildTrees();
    this.buildRocks();
    this.scene.add(this.structureGroup);

    // A bright beam marks the selected Gahallian.
    this.selectionMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 60, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.7 }),
    );
    this.selectionMarker.visible = false;
    this.scene.add(this.selectionMarker);

    this.onPointerDown = (e: PointerEvent): void => {
      this.downX = e.clientX;
      this.downY = e.clientY;
    };
    this.onPointerUp = (e: PointerEvent): void => this.handleClick(e);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  private buildTerrain(): void {
    const n = GRID;
    const step = WORLD / n;
    const positions = new Float32Array((n + 1) * (n + 1) * 3);
    const colors = new Float32Array((n + 1) * (n + 1) * 3);
    let p = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const wx = i * step;
        const wy = j * step;
        const h = heightAt(wx, wy);
        positions[p] = wx - HALF;
        positions[p + 1] = h * HSCALE;
        positions[p + 2] = wy - HALF;
        const [r, g, b] = REGION_RGB[regionAt(wx, wy)];
        const shade = 0.78 + Math.min(0.5, h / 18) * 0.5;
        colors[p] = r * shade;
        colors[p + 1] = g * shade;
        colors[p + 2] = b * shade;
        p += 3;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        indices.push(a, a + (n + 1), a + 1, a + 1, a + (n + 1), a + (n + 1) + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 })));
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2b6c8f, transparent: true, opacity: 0.55, roughness: 0.3 }));
    mesh.position.y = SEA * HSCALE;
    this.scene.add(mesh);
  }

  // The world wall — a stone boundary ringing the map; nobody leaves.
  private buildWall(): void {
    const H = 70;
    const TH = 14;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 1 });
    const make = (w: number, d: number, x: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), mat);
      m.position.set(x, H / 2 - 6, z);
      this.scene.add(m);
    };
    make(WORLD + TH, TH, 0, -HALF); // north
    make(WORLD + TH, TH, 0, HALF); // south
    make(TH, WORLD + TH, -HALF, 0); // west
    make(TH, WORLD + TH, HALF, 0); // east
  }

  private buildTrees(): void {
    const step = 22;
    const places: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        const region = regionAt(wx, wy);
        const density = region === 'forest' ? 0.8 : region === 'hills' ? 0.12 : 0;
        if (density === 0) continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i, j) > density) continue;
        places.push({ x: wx + (hash2(i + 7, j) - 0.5) * step, y: wy + (hash2(i, j + 7) - 0.5) * step, s: 1 + hash2(i + 3, j + 3) * 1.2 });
        if (places.length >= 6000) break;
      }
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.9, 5, 5), new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 }), places.length);
    const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 11, 7), new THREE.MeshStandardMaterial({ color: 0x2f6b2c, roughness: 0.85 }), places.length);
    places.forEach((pl, k) => {
      const base = heightAt(pl.x, pl.y) * HSCALE;
      const px = pl.x - HALF;
      const pz = pl.y - HALF;
      this.dummy.scale.set(pl.s, pl.s, pl.s);
      this.dummy.rotation.set(0, hash2(k, k) * Math.PI, 0);
      this.dummy.position.set(px, base + 2.5 * pl.s, pz);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(k, this.dummy.matrix);
      this.dummy.position.set(px, base + 10 * pl.s, pz);
      this.dummy.updateMatrix();
      foliage.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.scene.add(trunks, foliage);
  }

  private buildRocks(): void {
    const step = 36;
    const places: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        if (regionAt(wx, wy) !== 'mountain') continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i + 11, j + 5) > 0.4) continue;
        places.push({ x: wx, y: wy, s: 3 + hash2(i, j + 2) * 6 });
        if (places.length >= 1400) break;
      }
    }
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: 0x6b6b73, roughness: 1, flatShading: true }), Math.max(1, places.length));
    places.forEach((pl, k) => {
      this.dummy.scale.set(pl.s, pl.s * 0.8, pl.s);
      this.dummy.rotation.set(hash2(k, 1), hash2(k, 2) * Math.PI, hash2(k, 3));
      this.dummy.position.set(pl.x - HALF, heightAt(pl.x, pl.y) * HSCALE + pl.s * 0.6, pl.y - HALF);
      this.dummy.updateMatrix();
      rocks.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.dummy.rotation.set(0, 0, 0);
    this.scene.add(rocks);
  }

  // Body capsule + a forward-pointing nose, so an agent visibly FACES the way
  // it walks (a plain capsule is radially symmetric and can't show heading).
  private static agentGeometry(): THREE.BufferGeometry {
    const body = new THREE.CapsuleGeometry(3.2, 5, 4, 8);
    const nose = new THREE.ConeGeometry(1.7, 4.5, 6);
    nose.rotateX(Math.PI / 2); // point +Z
    nose.translate(0, 1.8, 3.6);
    return mergeGeometries([body, nose]) ?? body;
  }

  /** Forget the previous world's beings and buildings (a new world was created). */
  resetWorld(): void {
    if (this.agents) {
      this.agents.count = 0;
      this.agents.boundingSphere = null;
    }
    if (this.animalMesh) this.animalMesh.count = 0;
    this.instanceCount = 0;
    this.hiddenBeings = 0;
    this.hiddenWildlife = 0;
    this.selectedId = null;
    this.selectionMarker.visible = false;
    for (const child of [...this.structureGroup.children]) {
      this.structureGroup.remove(child);
      disposeObject(child);
    }
    this.seenStructures.clear();
  }

  private ensureAgentCapacity(n: number): THREE.InstancedMesh {
    const existing = this.agents;
    if (existing && existing.instanceMatrix.count >= n) return existing;
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
    }
    const mesh = new THREE.InstancedMesh(World3D.agentGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6 }), capacityFor(n));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    this.agents = mesh;
    if (this.instanceIds.length < mesh.instanceMatrix.count) {
      this.instanceIds = new Int32Array(mesh.instanceMatrix.count);
      this.instancePos = new Float32Array(mesh.instanceMatrix.count * 3);
    }
    return mesh;
  }

  private ensureAnimalCapacity(n: number): THREE.InstancedMesh {
    const existing = this.animalMesh;
    if (existing && existing.instanceMatrix.count >= n) return existing;
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 4, 7), new THREE.MeshStandardMaterial({ roughness: 0.8 }), capacityFor(n));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    this.animalMesh = mesh;
    return mesh;
  }

  /** Build the static resource-node markers (call once per world). */
  setResources(res: ResourcePayload): void {
    if (this.resourceMesh) {
      this.scene.remove(this.resourceMesh);
      this.resourceMesh.geometry.dispose();
      (this.resourceMesh.material as THREE.Material).dispose();
      this.resourceMesh = null;
    }
    const rgbByCode = res.kinds.map((k) => RESOURCE_RGB[k]);
    let shown = 0;
    for (let i = 0; i < res.count; i++) if (rgbByCode[res.kind[i]!]) shown++;
    if (shown === 0) return;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 0), new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), shown);
    const c = new THREE.Color();
    this.dummy.scale.set(1, 1, 1);
    this.dummy.rotation.set(0, 0, 0);
    let at = 0;
    for (let i = 0; i < res.count; i++) {
      const rgb = rgbByCode[res.kind[i]!];
      if (!rgb) continue;
      const x = res.pos[i * 2]!;
      const y = res.pos[i * 2 + 1]!;
      this.dummy.position.set(x - HALF, heightAt(x, y) * HSCALE + 3, y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      mesh.setColorAt(at, c.setRGB(rgb[0], rgb[1], rgb[2]));
      at++;
    }
    mesh.instanceColor!.needsUpdate = true;
    this.scene.add(mesh);
    this.resourceMesh = mesh;
  }

  /**
   * Draw one frame from the worker. The arrays are transferred and go straight
   * back, so everything needed later (the ids behind a click) is copied here.
   */
  applyFrame(f: FrameMessage): void {
    if (f.animalKinds.length) this.animalKinds = this.animalKinds.concat(f.animalKinds);
    if (f.structures.length) this.addStructures(f.structures);

    const mesh = this.ensureAgentCapacity(f.beings);
    this.dummy.scale.set(1, 1, 1);
    for (let i = 0; i < f.beings; i++) {
      const x = f.arrays.pos[i * 2]!;
      const y = f.arrays.pos[i * 2 + 1]!;
      const id = f.arrays.ids[i]!;
      const surface = heightAt(x, y) * HSCALE;
      this.dummy.rotation.set(0, f.arrays.heading[i]!, 0);
      this.dummy.position.set(x - HALF, surface + 5, y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, STATE_RGB[f.arrays.state[i]!] ?? STATE_RGB[0]!);
      this.instanceIds[i] = id;
      this.instancePos[i * 3] = x - HALF;
      this.instancePos[i * 3 + 1] = surface + 5;
      this.instancePos[i * 3 + 2] = y - HALF;
      if (id === this.selectedId) {
        this.selectionMarker.position.set(x - HALF, surface + 35, y - HALF);
        this.selectionMarker.visible = true;
      }
    }
    this.instanceCount = f.beings;
    mesh.count = f.beings;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Every instance moved, so the cached sphere `InstancedMesh.raycast` culls
    // against is stale — and three only ever computes it when it is null. Left
    // alone it is whatever the first frame happened to contain (after a
    // `resetWorld()`, an empty sphere of radius −1), and clicks stop hitting.
    mesh.boundingSphere = null;
    if (this.selectedId === null || !this.drawsId(this.selectedId)) this.selectionMarker.visible = false;
    this.hiddenBeings = Math.max(0, f.beingsAlive - f.beings);
    this.hiddenWildlife = Math.max(0, f.wildlifeTotal - f.wildlife);

    const animals = this.ensureAnimalCapacity(f.wildlife);
    this.dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < f.wildlife; i++) {
      const code = f.arrays.wildKind[i]!;
      const name = code === KIND_UNKNOWN ? undefined : this.animalKinds[code];
      const sz = (name === undefined ? undefined : ANIMAL_SIZE[name]) ?? 1;
      const rgb = (name === undefined ? undefined : ANIMAL_RGB[name]) ?? DEFAULT_ANIMAL_RGB;
      const x = f.arrays.wildPos[i * 2]!;
      const y = f.arrays.wildPos[i * 2 + 1]!;
      this.dummy.scale.set(sz, sz, sz);
      this.dummy.position.set(x - HALF, heightAt(x, y) * HSCALE + 3 * sz, y - HALF);
      this.dummy.updateMatrix();
      animals.setMatrixAt(i, this.dummy.matrix);
      animals.setColorAt(i, rgb);
    }
    animals.count = f.wildlife;
    animals.instanceMatrix.needsUpdate = true;
    if (animals.instanceColor) animals.instanceColor.needsUpdate = true;
  }

  /** What this view failed to draw — 0/0 unless something is wrong. */
  get notDrawn(): { beings: number; wildlife: number } {
    return { beings: this.hiddenBeings, wildlife: this.hiddenWildlife };
  }

  /** The ids this view is currently drawing, in instance order. */
  drawnIds(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.instanceCount; i++) out.push(this.instanceIds[i]!);
    return out;
  }

  /**
   * Where a given being currently is on screen, in client coordinates, or null
   * if it is not drawn or is behind the camera.
   *
   * A Gahallian is a couple of pixels at the default camera (audit 02, item 1),
   * which makes clicking one by guesswork hopeless — a hostile reviewer missed
   * on 384 tries. This is the deterministic way in: a driver asks where a known
   * being is and clicks exactly there, so selection is something that can be
   * proven rather than assumed.
   */
  screenPositionOf(id: number): { x: number; y: number } | null {
    for (let i = 0; i < this.instanceCount; i++) {
      if (this.instanceIds[i] !== id) continue;
      this.probe.set(this.instancePos[i * 3]!, this.instancePos[i * 3 + 1]!, this.instancePos[i * 3 + 2]!);
      this.probe.project(this.camera);
      if (this.probe.z > 1) return null; // behind the camera
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: rect.left + ((this.probe.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - this.probe.y) / 2) * rect.height,
      };
    }
    return null;
  }

  private drawsId(id: number): boolean {
    for (let i = 0; i < this.instanceCount; i++) if (this.instanceIds[i] === id) return true;
    return false;
  }

  /** Add meshes for newly-built structures (they're static once built). */
  private addStructures(list: StructureUpdate[]): void {
    for (const s of list) {
      if (this.seenStructures.has(s.id)) continue;
      this.seenStructures.add(s.id);
      this.structureGroup.add(this.makeStructure(s));
    }
  }

  private makeStructure(s: StructureUpdate): THREE.Object3D {
    const base = heightAt(s.x, s.y) * HSCALE;
    const g = new THREE.Group();
    if (s.kind === 'shelter') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 }));
      body.position.y = 4;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 7, 4), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }));
      roof.position.y = 11.5;
      roof.rotation.y = Math.PI / 4;
      g.add(body, roof);
    } else if (s.kind === 'wall') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7a7a82, roughness: 1 }));
      m.position.y = 6;
      g.add(m);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), new THREE.MeshStandardMaterial({ color: 0xb89b6a, roughness: 0.8 }));
      m.position.y = 2.5;
      g.add(m);
    }
    g.position.set(s.x - HALF, base, s.y - HALF);
    return g;
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    if (id === null) this.selectionMarker.visible = false;
  }

  private handleClick(e: PointerEvent): void {
    // Ignore drags (orbit); only near-stationary taps are clicks.
    if (Math.abs(e.clientX - this.downX) > 5 || Math.abs(e.clientY - this.downY) > 5) return;
    const mesh = this.agents;
    if (!mesh) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(mesh);
    const inst = hits[0]?.instanceId;
    if (inst !== undefined && inst < this.instanceCount) {
      const id = this.instanceIds[inst]!;
      this.setSelected(id);
      this.onSelect?.(id);
    } else {
      this.setSelected(null);
      this.onSelect?.(null);
    }
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden — keep the last good size
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.ro?.disconnect();
    this.ro = null;
    this.controls.dispose();
    // Everything this view created hangs off the scene: terrain, water, wall,
    // 6000 trees, rocks, resources, animals, beings, structures, the marker.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        geometries.add(obj.geometry);
        if (Array.isArray(obj.material)) for (const m of obj.material) materials.add(m);
        else materials.add(obj.material);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) disposeMaterial(m);
    this.scene.clear();
    this.agents = null;
    this.animalMesh = null;
    this.resourceMesh = null;
    this.instanceIds = new Int32Array(0);
    this.instancePos = new Float32Array(0);
    this.instanceCount = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) (value as THREE.Texture).dispose();
  }
  m.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    if (Array.isArray(obj.material)) for (const m of obj.material) disposeMaterial(m);
    else disposeMaterial(obj.material);
  });
}
