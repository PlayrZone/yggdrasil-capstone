import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt, regionAt, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';

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

export interface Agent3D {
  id: number;
  x: number;
  y: number;
  state: number;
}

export interface Structure3D {
  id: number;
  x: number;
  y: number;
  kind: string;
}

/**
 * A 3D view of the same continent the sim runs on (terrain from the engine's
 * heightAt/regionAt), ringed by a boundary wall. Agents are instanced capsules
 * on the surface; built structures appear as huts/walls/containers; clicking an
 * agent selects it.
 */
export class World3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private agents: THREE.InstancedMesh | null = null;
  private instanceIds: number[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly structureGroup = new THREE.Group();
  private readonly seenStructures = new Set<number>();
  private selectionMarker: THREE.Mesh;
  private selectedId: number | null = null;
  private ro: ResizeObserver | null = null;
  private downX = 0;
  private downY = 0;

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

    canvas.addEventListener('pointerdown', (e) => {
      this.downX = e.clientX;
      this.downY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => this.handleClick(e));

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

  setPopulation(count: number): void {
    if (this.agents) {
      this.scene.remove(this.agents);
      this.agents.geometry.dispose();
      (this.agents.material as THREE.Material).dispose();
    }
    const mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(3.2, 5, 4, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    this.agents = mesh;
    // New world → forget old structures so they rebuild.
    for (const child of [...this.structureGroup.children]) this.structureGroup.remove(child);
    this.seenStructures.clear();
  }

  update(agents: Agent3D[]): void {
    const mesh = this.agents;
    if (!mesh) return;
    const n = Math.min(agents.length, mesh.instanceMatrix.count);
    this.instanceIds.length = 0;
    for (let i = 0; i < n; i++) {
      const a = agents[i]!;
      const surface = heightAt(a.x, a.y) * HSCALE;
      this.dummy.scale.set(1, 1, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.position.set(a.x - HALF, surface + 5, a.y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, STATE_RGB[a.state] ?? STATE_RGB[0]!);
      this.instanceIds.push(a.id);
      if (a.id === this.selectedId) {
        this.selectionMarker.position.set(a.x - HALF, surface + 35, a.y - HALF);
        this.selectionMarker.visible = true;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (this.selectedId === null || !this.instanceIds.includes(this.selectedId)) this.selectionMarker.visible = false;
  }

  /** Add meshes for any newly-built structures (they're static once built). */
  updateStructures(list: Structure3D[]): void {
    for (const s of list) {
      if (this.seenStructures.has(s.id)) continue;
      this.seenStructures.add(s.id);
      this.structureGroup.add(this.makeStructure(s));
    }
  }

  private makeStructure(s: Structure3D): THREE.Object3D {
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
    if (inst !== undefined && inst < this.instanceIds.length) {
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
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.ro?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
