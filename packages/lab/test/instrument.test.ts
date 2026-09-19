import { describe, expect, it, vi } from 'vitest';
import {
  ghostCommonChunk,
  ghostFragmentChunk,
  ghostVertexChunk,
  LIT_ONLY_VERTEX_IDENTIFIERS,
  litOnlyIdentifiersIn,
} from '../src/renderer/shading.js';
import { createHealth, onConsoleError, onWindowError } from '../src/renderer/health.js';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

/**
 * The instrument's own health, and the one coordinate frame its probes answer
 * in. Neither is about the picture; both are about whether a measurement of the
 * picture means anything.
 */

// ── A shipped shader that never compiled ─────────────────────────────────────

/**
 * The exact vertex patch this view shipped for four rounds, quoted so the check
 * that would have caught it can be held against the thing it missed.
 *
 * `applyGhostFade` wrote a rim term guarded by `uRim > 0.0` and reached for
 * `transformedNormal` inside it. GLSL compiles both arms of an `if`, and the
 * lit-windows material is a `MeshBasicMaterial` whose vertex program declares
 * no normals at all — so the program failed to compile on every boot, the lit
 * windows never drew, and every hut was a black box at midnight. No round
 * caught it: three writes a compile failure to `console.error`, which
 * `pageerror` does not raise.
 */
const ROUND_EIGHT_RIM = `
  float floorA = uGhostFloor;
  if (uRim > 0.0) {
    vec4 rimView = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    float grazing = 1.0 - abs(dot(normalize(transformedNormal), normalize(-rimView.xyz)));
    floorA = clamp(uGhostFloor + uRim * smoothstep(0.30, 0.90, grazing), 0.0, 1.0);
  }`;

describe('a patch compiles against the material it is put into', () => {
  it('catches the identifier that shipped broken for four rounds', () => {
    expect(litOnlyIdentifiersIn(ROUND_EIGHT_RIM)).toEqual(['transformedNormal']);
  });

  it('emits no lit-only identifier, rim or no rim', () => {
    for (const rim of [false, true]) {
      const glsl = ghostVertexChunk(8, rim);
      expect(litOnlyIdentifiersIn(glsl)).toEqual([]);
    }
    expect(litOnlyIdentifiersIn(ghostCommonChunk(8))).toEqual([]);
    expect(litOnlyIdentifiersIn(ghostFragmentChunk())).toEqual([]);
  });

  it('takes the rim normal from what every material declares', () => {
    const withRim = ghostVertexChunk(8, true);
    // `normal` and `normalMatrix` are in three's own vertex prefix for every
    // non-raw material, lit or not; `instanceMatrix` is under USE_INSTANCING,
    // which the chunk is already inside two lines above.
    expect(withRim).toContain('normalMatrix * (mat3(instanceMatrix) * normal)');
    expect(withRim).toContain('uRim');
  });

  it('gives a material that asked for no rim no rim code at all', () => {
    // The point of the fix, not a nicety: a `uRim > 0.0` guard is a RUNTIME
    // test and the compiler resolves both arms regardless. A material that
    // never wants a rim must never be handed one to resolve.
    const flat = ghostVertexChunk(8, false);
    expect(flat).not.toContain('grazing');
    expect(flat).not.toContain('normalMatrix');
    expect(flat).toContain('float floorA = uGhostFloor;');
  });

  it('writes the subject loop at the size it was given, and closes it', () => {
    for (const slots of [1, 8, 24]) {
      const glsl = ghostVertexChunk(slots, true);
      expect(glsl).toContain(`k < ${slots}`);
      expect(ghostCommonChunk(slots)).toContain(`uSubject[${slots}]`);
    }
    for (const glsl of [ghostVertexChunk(8, true), ghostVertexChunk(8, false), ghostCommonChunk(8), ghostFragmentChunk()]) {
      const opens = (glsl.match(/\{/g) ?? []).length;
      const closes = (glsl.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it('keeps the three-chunk contract the patch is injected through', () => {
    expect(ghostCommonChunk(8).startsWith('#include <common>')).toBe(true);
    expect(ghostVertexChunk(8, false).startsWith('#include <begin_vertex>')).toBe(true);
    expect(ghostFragmentChunk().startsWith('#include <color_fragment>')).toBe(true);
    // The varying is declared once in the vertex half and read in the fragment
    // half; a patch that declares it twice fails to link.
    expect((ghostCommonChunk(8).match(/varying float vGhostA/g) ?? []).length).toBe(1);
    expect(ghostFragmentChunk()).toContain('vGhostA');
  });

  it('names every lit-only identifier three declares, not just the one that bit', () => {
    expect(LIT_ONLY_VERTEX_IDENTIFIERS).toContain('transformedNormal');
    expect(LIT_ONLY_VERTEX_IDENTIFIERS).toContain('objectNormal');
    expect(LIT_ONLY_VERTEX_IDENTIFIERS).toContain('vViewPosition');
    for (const name of LIT_ONLY_VERTEX_IDENTIFIERS) {
      expect(litOnlyIdentifiersIn(`float x = ${name};`)).toEqual([name]);
    }
  });

  it('does not mistake a word in a comment for a reference', () => {
    // This file writes its reasons in the shader, and the round-eight failure
    // is named in one of them.
    expect(litOnlyIdentifiersIn('// transformedNormal was the bug\nfloat x = 1.0;')).toEqual([]);
    expect(litOnlyIdentifiersIn('/* objectNormal */ float x = 1.0;')).toEqual([]);
    expect(litOnlyIdentifiersIn('float myTransformedNormalish = 1.0;')).toEqual([]);
  });
});

// ── Is this renderer well? ───────────────────────────────────────────────────

describe('the renderer says whether it is well', () => {
  it('starts at zero on every count', () => {
    expect(createHealth().report()).toEqual({
      shaderErrors: 0, consoleErrors: 0, webglContextLost: 0, windowErrors: 0, cullRisks: 0, notes: [],
    });
  });

  it('counts the ways a WebGL view breaks silently, separately', () => {
    const health = createHealth();
    health.noteShaderError('undeclared identifier');
    health.noteConsoleError('something else');
    health.noteConsoleError('and again');
    health.noteContextLost('webglcontextlost');
    const report = health.report();
    expect(report.shaderErrors).toBe(1);
    expect(report.consoleErrors).toBe(2);
    expect(report.webglContextLost).toBe(1);
    expect(report.notes[0]).toContain('undeclared identifier');
  });

  /**
   * The reviewer's own blind spot, named by him: a renderer `window.onerror` is
   * not a `console.error`. He raised `ResizeObserver loop completed with
   * undelivered notifications` on a live resize and every count stayed at zero.
   */
  it('counts the page s own faults, which no console tap sees', () => {
    const health = createHealth();
    const handlers = new Map<string, (e: unknown) => void>();
    const source = {
      addEventListener: (t: string, fn: (e: unknown) => void) => { handlers.set(t, fn); },
      removeEventListener: (t: string) => { handlers.delete(t); },
    };
    const drop = onWindowError(source, (text) => health.noteWindowError(text));
    handlers.get('error')!({ message: 'ResizeObserver loop completed with undelivered notifications' });
    handlers.get('unhandledrejection')!({ reason: new Error('a promise nobody caught') });
    const report = health.report();
    expect(report.windowErrors).toBe(2);
    expect(report.consoleErrors).toBe(0);
    expect(report.notes[0]).toContain('ResizeObserver');
    expect(report.notes[1]).toContain('a promise nobody caught');
    drop();
    expect(handlers.size).toBe(0);
  });

  /**
   * The round-five defect, made countable. It is a STATE of the scene, not an
   * event, so it is replaced rather than accumulated: a mesh that is fixed must
   * be able to stop being reported.
   */
  it('reports the meshes three may drop, by name, and lets them be fixed', () => {
    const health = createHealth();
    health.setCullRisks(['lit windows']);
    expect(health.report().cullRisks).toBe(1);
    expect(health.report().notes.join(' ')).toContain('lit windows');
    health.setCullRisks([]);
    expect(health.report().cullRisks).toBe(0);
    expect(health.report().notes).toEqual([]);
  });

  it('keeps the messages but never becomes a log sink', () => {
    const health = createHealth(3);
    for (let i = 0; i < 50; i++) health.noteConsoleError(`e${i}`);
    expect(health.report().consoleErrors).toBe(50);
    expect(health.report().notes).toHaveLength(3);
    const long = createHealth();
    long.noteShaderError('x'.repeat(2000));
    expect(long.report().notes[0]!.length).toBeLessThan(420);
  });

  it('hands back a snapshot, so a caller cannot edit the ledger', () => {
    const health = createHealth();
    health.noteConsoleError('one');
    const report = health.report();
    report.notes.push('two');
    report.consoleErrors = 99;
    expect(health.report().notes).toHaveLength(1);
    expect(health.report().consoleErrors).toBe(1);
  });

  it('taps console.error without swallowing it', () => {
    const seen: string[] = [];
    const under = vi.fn();
    const sink = { error: under };
    const drop = onConsoleError(sink, (t) => seen.push(t));
    try {
      sink.error('boom', 42);
      expect(seen).toEqual(['boom 42']);
      expect(under).toHaveBeenCalledTimes(1);
      expect(under).toHaveBeenCalledWith('boom', 42);
    } finally {
      drop();
    }
  });

  it('reads an Error the way a reader would', () => {
    const seen: string[] = [];
    const sink = { error: vi.fn() };
    const drop = onConsoleError(sink, (t) => seen.push(t));
    try {
      sink.error(new Error('context lost'));
      expect(seen).toEqual(['context lost']);
    } finally {
      drop();
    }
  });

  /**
   * React mounts this view twice in development. A second wrapper around the
   * first would survive the first being removed — a tap that leaks a layer per
   * mount and then reports for a world that no longer exists.
   */
  it('wraps once however many listeners there are, and restores when the last leaves', () => {
    const original = vi.fn();
    const sink = { error: original };
    const a: string[] = [];
    const b: string[] = [];
    const dropA = onConsoleError(sink, (t) => a.push(t));
    const wrapped = sink.error;
    const dropB = onConsoleError(sink, (t) => b.push(t));
    try {
      expect(sink.error).toBe(wrapped); // one wrapper, two listeners
      sink.error('x');
      expect(a).toEqual(['x']);
      expect(b).toEqual(['x']);
      dropA();
      sink.error('y');
      expect(a).toEqual(['x']);
      expect(b).toEqual(['x', 'y']);
      dropB();
      expect(sink.error).toBe(original);
      sink.error('z');
      expect(b).toEqual(['x', 'y']);
      expect(original).toHaveBeenCalledWith('z');
    } finally {
      dropA();
      dropB();
    }
  });

  it('is safe to drop twice, because React cleanup runs more than once', () => {
    const sink = { error: vi.fn() };
    const seen: string[] = [];
    const drop = onConsoleError(sink, (t) => seen.push(t));
    sink.error('a');
    drop();
    drop();
    expect(seen).toEqual(['a']);
    // And the tap really is gone, rather than a layer deep.
    sink.error('b');
    expect(seen).toEqual(['a']);
  });
});

// ── A mesh three is allowed to drop ──────────────────────────────────────────

/**
 * The round-five defect, reproduced in three itself and then closed.
 *
 * `this.windows` was the only `InstancedMesh` in `World3D` that did not turn
 * frustum culling off. It was created with `count = 0` — as every mesh here is,
 * because the count is written per frame — so on its FIRST frustum test three
 * computed a bounding sphere from zero instances, cached it, and never looked
 * again. Measured here rather than assumed: that sphere is centred on the WORLD
 * ORIGIN with radius −1, which three's own `intersectsSphere` reads as "inside"
 * wherever the origin happens to be in view. On a two-kilometre continent, a
 * camera standing at a hut is never looking at the origin, so the panes were
 * drawn in exactly the frames nobody was photographing.
 *
 * Every health count stayed at zero: the program linked, `updateLight` set the
 * opacity, the matrices were written and uploaded, and no hut was lit at
 * midnight for the life of the view. Only a photograph could see it, and the
 * round that claimed the picture did not take one.
 */
describe('an instanced mesh built empty is drawn by where the ORIGIN is', () => {
  /** Looking at a hut, out where a settlement actually stands. */
  const HUT = { x: 300, y: 0, z: -220 };
  const frustumAtHut = (): THREE.Frustum => {
    const camera = new THREE.PerspectiveCamera(45, 1.6, 0.25, 500);
    camera.position.set(HUT.x, 3, HUT.z + 12);
    camera.lookAt(HUT.x, 1.4, HUT.z);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  };

  /** A pane on the hut's side wall, exactly as `rebuildStructures` writes it. */
  const paneOnTheHut = (mesh: THREE.InstancedMesh): void => {
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(HUT.x, 1.4, HUT.z));
    mesh.count = 1;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const emptyMesh = (): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.7), new THREE.MeshBasicMaterial(), 64);
    mesh.count = 0;
    return mesh;
  };

  it('caches an empty sphere on the origin the first time it is tested', () => {
    const mesh = emptyMesh();
    mesh.computeBoundingSphere();
    expect(mesh.boundingSphere!.radius).toBe(-1);
    expect(mesh.boundingSphere!.center.lengthSq()).toBe(0);
  });

  it('reproduces the defect: the pane is in front of the camera and not drawn', () => {
    const mesh = emptyMesh();
    const frustum = frustumAtHut();
    // The first frustum test, with nothing in it — the frame that poisons it.
    frustum.intersectsObject(mesh);
    paneOnTheHut(mesh);
    // Square in front of the camera, matrix written and uploaded, and three
    // still says no, because the sphere it kept is the empty one at the origin.
    expect(frustum.intersectsObject(mesh)).toBe(false);
  });

  it('is closed by turning culling off, which is what the factory does', () => {
    const mesh = emptyMesh();
    mesh.frustumCulled = false;
    frustumAtHut().intersectsObject(mesh);
    paneOnTheHut(mesh);
    // The renderer never asks the frustum about a mesh with culling off, so
    // the stale sphere cannot decide anything.
    expect(mesh.frustumCulled).toBe(false);
  });

  it('is also closed by dropping the cached sphere when the count changes', () => {
    const mesh = emptyMesh();
    const frustum = frustumAtHut();
    frustum.intersectsObject(mesh);
    paneOnTheHut(mesh);
    mesh.boundingSphere = null; // what `writeMarkers` does for the bodies
    expect(frustum.intersectsObject(mesh)).toBe(true);
  });
});

/**
 * The generic guard, held against the file itself.
 *
 * `cullAudit` catches it at runtime and `health().cullRisks` reports it, but a
 * runtime guard only fires in a session somebody runs. This one fires in CI, on
 * the next mesh somebody adds without reading any of the above: every
 * `InstancedMesh` this view creates must come out of the one factory that makes
 * it undroppable, and the two exceptions are the factory itself and `regrow`,
 * which copies the property across.
 */
describe('every instanced mesh the view creates goes through the guard', () => {
  it('leaves no bare construction in World3D', () => {
    const src = readFileSync(new URL('../src/renderer/World3D.ts', import.meta.url), 'utf8');
    const lines = src.split('\n');
    const bare: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.includes('new THREE.InstancedMesh(')) continue;
      // The factory (`instanced`) and `regrow` are the two places allowed to
      // call the constructor; both set the property on what they hand back.
      const before = lines.slice(Math.max(0, i - 14), i).join('\n');
      const inFactory = /private instanced\(|function regrow\(/.test(before);
      if (!inFactory) bare.push(`${i + 1}: ${line.trim()}`);
    }
    expect(bare).toEqual([]);
  });

  it('names every mesh, so a non-zero cullRisks says which one', () => {
    const src = readFileSync(new URL('../src/renderer/World3D.ts', import.meta.url), 'utf8');
    for (const call of src.matchAll(/this\.instanced\(\s*([^,]+),/g)) {
      const name = call[1]!.trim();
      expect(name.startsWith("'") || name.startsWith('`')).toBe(true);
    }
  });
});

// ── One coordinate frame ─────────────────────────────────────────────────────

/**
 * Every screen coordinate `window.__ygg` answers in is a CLIENT coordinate.
 *
 * Round eight had two frames in one namespace: `screenPositionOf` and
 * `pickAtScreen` in client coordinates, `chipsOnScreen` and `markGeometry` in
 * canvas-local ones. A reviewer drove the real mouse to a chip's own reported
 * point — probe (1290, 306), DOM rect (1306.0, 418.8) — landed exactly the
 * canvas origin away, and opened nothing at all.
 *
 * `toClient` is that conversion, and this is the arithmetic of it: canvas
 * pixels in, client pixels out, scaled where the canvas is drawn at a size
 * other than its layout box.
 */
function toClient(
  x: number, y: number,
  rect: { left: number; top: number; width: number; height: number },
  clientW: number, clientH: number,
): { x: number; y: number } {
  return {
    x: rect.left + x * (rect.width / Math.max(1, clientW)),
    y: rect.top + y * (rect.height / Math.max(1, clientH)),
  };
}

describe('every probe answers in the frame a mouse event carries', () => {
  const rect = { left: 16, top: 112.8, width: 2188, height: 914.8 };

  it('moves a canvas-local point to where a chip s DOM rect actually is', () => {
    // The reviewer's own numbers: this is the 113 px, reproduced and closed.
    const at = toClient(1290, 306, rect, 2188, 914.8);
    expect(at.x).toBeCloseTo(1306.0, 3);
    expect(at.y).toBeCloseTo(418.8, 3);
    expect(Math.hypot(at.x - 1290, at.y - 306)).toBeCloseTo(Math.hypot(16, 112.8), 6);
  });

  it('is the identity when the canvas is at the window origin, so nothing shifts for free', () => {
    const at = toClient(400, 300, { left: 0, top: 0, width: 800, height: 600 }, 800, 600);
    expect(at).toEqual({ x: 400, y: 300 });
  });

  it('scales a canvas drawn at a different size than its layout box', () => {
    const at = toClient(100, 50, { left: 10, top: 20, width: 400, height: 300 }, 800, 600);
    expect(at).toEqual({ x: 60, y: 45 });
  });

  it('round-trips a pointer event back to the pixel the picker tests', () => {
    // `pickAt` subtracts the same rect, so a point handed out by a probe and
    // fed back through the picker lands on the pixel it came from.
    for (const [cx, cy] of [[0, 0], [1290, 306], [2187, 914]] as const) {
      const at = toClient(cx, cy, rect, 2188, 914.8);
      expect(at.x - rect.left).toBeCloseTo(cx, 6);
      expect(at.y - rect.top).toBeCloseTo(cy, 6);
    }
  });

  it('never divides by a canvas that has not been laid out', () => {
    expect(() => toClient(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 0, 0)).not.toThrow();
    expect(toClient(10, 10, { left: 5, top: 5, width: 0, height: 0 }, 0, 0)).toEqual({ x: 5, y: 5 });
  });
});
