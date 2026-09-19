import { describe, expect, it, vi } from 'vitest';
import {
  ghostCommonChunk,
  ghostFragmentChunk,
  ghostVertexChunk,
  LIT_ONLY_VERTEX_IDENTIFIERS,
  litOnlyIdentifiersIn,
} from '../src/renderer/shading.js';
import { createHealth, onConsoleError } from '../src/renderer/health.js';

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
  it('starts at zero on all three counts', () => {
    expect(createHealth().report()).toEqual({
      shaderErrors: 0, consoleErrors: 0, webglContextLost: 0, notes: [],
    });
  });

  it('counts the three ways a WebGL view breaks silently, separately', () => {
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
