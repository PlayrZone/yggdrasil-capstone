import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt, regionAt, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';

const HSCALE = 7; // vertical exaggeration of the heightmap
const SEA = 0.85; // sea level in world-height units
const GRID = 140; // terrain resolution
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

// Deterministic 0..1 hash for scattering decor — same trees every run.
function hash2(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Agent state → colour (0 ok, 1 hungry, 2 sleeping, 3 sick).
const STATE_RGB: THREE.Color[] = [
  new THREE.Color(0.26, 0.82, 0.54),
  new THREE.Color(0.88, 0.6, 0.23),
  new THREE.Color(0.36, 0.55, 0.82),
  new THREE.Color(0.88, 0.32, 0.3),
];

export interface Agent3D {
  x: number;
  y: number;
  state: number;
}

/**
 * A real 3D view of the same continent the sim runs on: the terrain mesh is
 * built directly from the engine's `heightAt`/`regionAt`, so what you see is
 * literally the world the Gahallians inhabit. Agents are instanced capsules
 * standing on the surface, coloured by their state and moved every frame.
 */
export class World3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private agents: THREE.InstancedMesh | null = null;
  private readonly dummy = new THREE.Object3D();
  private ro: ResizeObserver | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color('#0a0e12');
    this.scene.fog = new THREE.Fog('#0a0e12', 380, 900);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
    this.camera.position.set(-380, 380, 520);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // don't go under the ground
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1800;
    this.controls.target.set(0, 10, 0);

    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x2a2a1f, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
    sun.position.set(300, 520, 200);
    this.scene.add(sun);

    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildRocks();
    this.resize();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  private buildTerrain(): void {
    const n = GRID;
    const step = WORLD / n;
    const verts = (n + 1) * (n + 1);
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
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
        // Subtle height shading so relief reads even within one region.
        const shade = 0.78 + Math.min(0.5, h / 16) * 0.5;
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
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: false });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b6c8f, transparent: true, opacity: 0.55, roughness: 0.3, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = SEA * HSCALE;
    this.scene.add(mesh);
  }

  // Scatter trees across forest regions (deterministic — same forest each run).
  private buildTrees(): void {
    const step = 16;
    const placements: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        const region = regionAt(wx, wy);
        const density = region === 'forest' ? 0.78 : region === 'hills' ? 0.12 : 0;
        if (density === 0) continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i, j) > density) continue;
        const jx = wx + (hash2(i + 7, j) - 0.5) * step;
        const jy = wy + (hash2(i, j + 7) - 0.5) * step;
        placements.push({ x: jx, y: jy, s: 0.8 + hash2(i + 3, j + 3) * 0.8 });
        if (placements.length >= 2600) break;
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.75, 4, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 });
    const foliageGeo = new THREE.ConeGeometry(3, 8, 7);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2c, roughness: 0.85 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placements.length);
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, placements.length);
    placements.forEach((p, k) => {
      const base = heightAt(p.x, p.y) * HSCALE;
      const px = p.x - HALF;
      const pz = p.y - HALF;
      this.dummy.scale.set(p.s, p.s, p.s);
      this.dummy.position.set(px, base + 2 * p.s, pz);
      this.dummy.rotation.set(0, hash2(k, k) * Math.PI, 0);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(k, this.dummy.matrix);
      this.dummy.position.set(px, base + (4 + 4) * p.s, pz);
      this.dummy.updateMatrix();
      foliage.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.scene.add(trunks, foliage);
  }

  // A few boulders on the mountains so the highlands read as rocky.
  private buildRocks(): void {
    const step = 26;
    const placements: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        if (regionAt(wx, wy) !== 'mountain') continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i + 11, j + 5) > 0.4) continue;
        placements.push({ x: wx, y: wy, s: 1.5 + hash2(i, j + 2) * 3 });
        if (placements.length >= 900) break;
      }
    }
    const geo = new THREE.IcosahedronGeometry(2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6b73, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(geo, mat, Math.max(1, placements.length));
    placements.forEach((p, k) => {
      const base = heightAt(p.x, p.y) * HSCALE;
      this.dummy.scale.set(p.s, p.s * 0.8, p.s);
      this.dummy.position.set(p.x - HALF, base + p.s * 0.6, p.y - HALF);
      this.dummy.rotation.set(hash2(k, 1), hash2(k, 2) * Math.PI, hash2(k, 3));
      this.dummy.updateMatrix();
      rocks.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.dummy.rotation.set(0, 0, 0);
    this.scene.add(rocks);
  }

  /** (Re)create the instanced agent mesh for a population size. */
  setPopulation(count: number): void {
    if (this.agents) {
      this.scene.remove(this.agents);
      this.agents.geometry.dispose();
      (this.agents.material as THREE.Material).dispose();
      this.agents = null;
    }
    const geo = new THREE.CapsuleGeometry(1.8, 3, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    this.agents = mesh;
  }

  /** Place agents on the surface this frame (positions already interpolated). */
  update(agents: Agent3D[]): void {
    const mesh = this.agents;
    if (!mesh) return;
    const n = Math.min(agents.length, mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const a = agents[i]!;
      const surface = heightAt(a.x, a.y) * HSCALE;
      this.dummy.position.set(a.x - HALF, surface + 3, a.y - HALF);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, STATE_RGB[a.state] ?? STATE_RGB[0]!);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
