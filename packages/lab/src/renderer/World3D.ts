import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt, regionAt, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';

const HSCALE = 7; // vertical exaggeration of the heightmap
const SEA = 0.85; // sea level in world-height units
const GRID = 140; // terrain resolution
const HALF = WORLD / 2;

const REGION_RGB: Record<Region, [number, number, number]> = {
  river: [0.18, 0.42, 0.3],
  coast: [0.72, 0.66, 0.43],
  forest: [0.13, 0.34, 0.16],
  mountain: [0.42, 0.4, 0.44],
  hills: [0.4, 0.36, 0.22],
  plains: [0.28, 0.42, 0.2],
};

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

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 4000);
    this.camera.position.set(-220, 230, 300);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // don't go under the ground
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;
    this.controls.target.set(0, 10, 0);

    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x2a2a1f, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
    sun.position.set(180, 320, 120);
    this.scene.add(sun);

    this.buildTerrain();
    this.buildWater();
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
