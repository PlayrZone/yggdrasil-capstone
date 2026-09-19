/**
 * The GLSL this view patches into three's own materials, as strings — and the
 * one check that says whether a patch can compile against the material it is
 * being put into.
 *
 * It lives outside `World3D` because a shader that does not compile is invisible
 * from every direction a test can look from. `pageerror` does not see it: three
 * catches the compile failure, writes it to `console.error`, and the frame draws
 * without that program. For four rounds this view shipped a vertex patch that
 * injected `transformedNormal` into a `MeshBasicMaterial` — an identifier only a
 * LIT material's vertex program declares — so the lit-windows program failed on
 * every boot and every hut was a black box at midnight, with nothing anywhere
 * reporting a fault.
 *
 * Two answers, and they are separate on purpose. `ghostVertexChunk` never emits
 * a normal-dependent term unless it is asked for one, and when it is, it derives
 * the normal from `normal` and `normalMatrix`, which every non-raw material
 * declares. And `litOnlyIdentifiersIn` is the check: a string of the identifiers
 * three only declares for lit materials, so a patch can be held against what the
 * program it is going into actually has. The runtime counterpart is
 * `renderer.debug.onShaderError`, whose count `window.__ygg.health()` reports.
 */

/**
 * Identifiers three.js declares ONLY in a lit material's vertex program —
 * `MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshPhongMaterial`, … — via
 * the `beginnormal_vertex` / `defaultnormal_vertex` / `normal_vertex` chunks.
 *
 * `MeshBasicMaterial` includes none of them, so a patch that mentions one
 * compiles nowhere it is unlit. The list is the failure, written down.
 */
export const LIT_ONLY_VERTEX_IDENTIFIERS: readonly string[] = [
  'transformedNormal',
  'objectNormal',
  'transformedTangent',
  'objectTangent',
  'vNormal',
  'vTangent',
  'vBitangent',
  'vViewPosition',
];

/**
 * Which lit-only identifiers a chunk of GLSL uses — empty for a chunk that can
 * be injected into any material.
 *
 * Word-boundary matching, and comments are stripped first: this file writes its
 * reasons in the shader, and a word in a comment is not a reference.
 */
export function litOnlyIdentifiersIn(glsl: string): string[] {
  const code = glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const out: string[] = [];
  for (const name of LIT_ONLY_VERTEX_IDENTIFIERS) {
    if (new RegExp(`\\b${name}\\b`).test(code)) out.push(name);
  }
  return out;
}

/** The uniforms and varying the ghost patch declares, for `#include <common>`. */
export function ghostCommonChunk(slots: number): string {
  return `#include <common>
        uniform float uFadeNear;
        uniform float uFadeFar;
        uniform vec3 uSel;
        uniform float uSelR;
        uniform float uFadeFloor;
        uniform float uGhostFloor;
        uniform float uThick;
        uniform float uThickY;
        uniform float uCentreY;
        uniform float uRim;
        uniform int uSubjectN;
        uniform vec4 uSubject[${slots}];
        varying float vGhostA;`;
}

/**
 * The body of the ghost rule, for `#include <begin_vertex>`.
 *
 * `rim` is a BUILD-time flag, not a uniform test, and that distinction is the
 * whole bug. GLSL compiles both arms of an `if`, so a rim term guarded by
 * `uRim > 0.0` still has to resolve every identifier it mentions in a material
 * whose rim is permanently zero — which is how an unlit material came to be
 * asked for a lit material's normal. A material that wants no rim is now handed
 * no rim code at all, and a material that wants one gets a normal built from
 * `normal` and `normalMatrix` (plus `instanceMatrix`, which the caller has
 * already used two lines above, so instancing is not in question).
 */
export function ghostVertexChunk(slots: number, rim: boolean): string {
  const rimTerm = rim
    ? `
          // A ghosted BUILDING keeps its edges. A hut faded evenly to a fifth is
          // a glass vitrine — a reviewer's word — with grey slabs in it and no
          // doorway: the one object in the frame that does not read as what it
          // is. So the surfaces turned away from the eye hold their opacity
          // while the flat panels drop, which leaves the silhouette, the eaves,
          // the ridge and the jambs of the door drawn, and lets the people
          // inside show through the walls exactly as before.
          vec3 rimN = normalMatrix * (mat3(instanceMatrix) * normal);
          vec4 rimView = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          float grazing = 1.0 - abs(dot(normalize(rimN), normalize(-rimView.xyz)));
          floorA = clamp(uGhostFloor + uRim * smoothstep(0.30, 0.90, grazing), 0.0, 1.0);`
    : '';
  return `#include <begin_vertex>
        {
          vec4 fadeAnchor = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 fadeWorld = (modelMatrix * fadeAnchor).xyz;
          float scale = length(instanceMatrix[0].xyz);
          // The THING's middle, not this mesh's own origin. A tree is two
          // meshes with two anchors five metres apart, and testing each where
          // it happens to be pinned ghosts the crown and leaves the trunk — a
          // black bar standing in front of somebody with a ghost over it.
          vec3 fadeUp = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          vec3 fadeView = (modelViewMatrix * fadeAnchor).xyz + fadeUp * (uCentreY * scale);
          float fadeDepth = -fadeView.z;
          // Pressed against the lens: a trunk eleven metres off the glass is a
          // black bar across a third of the frame whoever is behind it.
          float lens = smoothstep(uFadeNear, uFadeFar, fadeDepth);
          float block = 0.0;
          float rx = uThick * scale;
          float ry = uThickY * scale;
          if (fadeDepth > 0.05) {
            for (int k = 0; k < ${slots}; k++) {
              if (k >= uSubjectN) break;
              vec4 sj = uSubject[k];
              float sd = -sj.z;
              // Its NEAR FACE, not its middle: a being standing inside a hut is
              // behind the hut's front wall and in front of its back one, and
              // the middle of the hut says neither.
              if (sd <= 0.05 || fadeDepth - max(rx, ry) >= sd - 0.2) continue;
              // Screen overlap, done as the projection does it: x over depth.
              vec2 o = fadeView.xy / fadeDepth;
              vec2 s = sj.xy / sd;
              vec2 reach = vec2(rx, ry) / fadeDepth + vec2(sj.w / sd);
              float d = length((o - s) / reach);
              block = max(block, 1.0 - smoothstep(0.62, 1.02, d));
            }
          }
          float sel = uSelR > 0.0 ? 1.0 - smoothstep(uSelR * 0.55, uSelR * 1.6, distance(fadeWorld, uSel)) : 0.0;
          float g = max(block, sel);
          float floorA = uGhostFloor;${rimTerm}
          vGhostA = min(mix(uFadeFloor, 1.0, lens), mix(1.0, floorA, g));
        }`;
}

/** The fragment half: a ghost is vapour, not a dimmer version of itself. */
export function ghostFragmentChunk(): string {
  return `#include <color_fragment>
        if (vGhostA < 0.015) discard;
        // A ghost is not a faint tree, it is a tree drawn as vapour: pulled
        // toward the pale end so its edges still describe the shape at a fifth
        // of the opacity, which a merely dimmed dark green does not.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.76, 0.80), (1.0 - vGhostA) * 0.55);
        diffuseColor.a *= vGhostA;`;
}
