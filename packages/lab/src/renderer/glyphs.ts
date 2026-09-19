import * as THREE from 'three';
import {
  PICTO_ALARM,
  PICTO_COUNT,
  PICTO_EAT,
  PICTO_GRID,
  PICTO_REST,
  PICTO_SPEAK,
  PICTO_WORK,
} from './beings.js';

/**
 * The pictogram a being wears, drawn once into one texture.
 *
 * Five marks, one meaning each. They are shapes, not colours: what a being is
 * doing has to survive a colour-blind viewer, a greyscale print and a night
 * grade, so each is distinguishable by its OUTER EDGE alone — a zigzag, a full
 * circle, a triangle, a block with a diagonal tail, a wide box with a tail —
 * and nothing depends on a hole staying open at ten pixels.
 *
 * What changed in round three is where they live. Round two hung a badge on a
 * stem above the head; a reviewer's three activity misses were all badges given
 * to the wrong body, because in a crowd a mark floating above the heads belongs
 * to whichever head you decide it belongs to. So the mark is now a CHIP welded
 * to its own ground ring: a bone disc with a stub running down-left out of it,
 * placed so the stub lands on the rim of that being's ring and nowhere near
 * anyone else's. It is attached, not hovering.
 *
 * The chip is bone in every band and for every condition. Condition is the
 * ring's job — three channels of it — and a chip that also carried a hue would
 * be a second, weaker answer to a question already answered.
 *
 *   Z zigzag — asleep            ● full circle — eating or drinking
 *   ▲ point up — fleeing         ▬ block with a haft — gathering or building
 *   ▭ box with a tail — speaking
 */

const CELL = 128;
/** Where the chip sits inside its cell, and how big it is. */
const CX = 74;
const CY = 54;
const CHIP_R = 46;
/** The stub that welds the chip to the ring below and to the left of it. */
const STUB_FROM: readonly [number, number] = [46, 84];
const STUB_TO: readonly [number, number] = [16, 114];

/**
 * Where the chip's centre and the stub's far end sit inside the cell, as
 * fractions of the cell from its centre, x right and y up. The view needs these
 * to place the quad so the stub's end lands on the ring — they are read off the
 * same numbers the atlas is drawn from rather than guessed at in the renderer.
 */
export const PICTO_CHIP_AT: readonly [number, number] = [(CX - CELL / 2) / CELL, (CELL / 2 - CY) / CELL];
export const PICTO_STUB_AT: readonly [number, number] = [(STUB_TO[0] - CELL / 2) / CELL, (CELL / 2 - STUB_TO[1]) / CELL];
export const PICTO_CHIP_R = CHIP_R / CELL;

type Pen = CanvasRenderingContext2D;

/** White is the chip, black is ink: the shader tints the first and keeps the second. */
const CHIP = '#fff';
const INK = '#000';

function chip(ctx: Pen): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.moveTo(STUB_FROM[0], STUB_FROM[1]);
  ctx.lineTo(STUB_TO[0], STUB_TO[1]);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(CX, CY, CHIP_R + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = CHIP;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(STUB_FROM[0], STUB_FROM[1]);
  ctx.lineTo(STUB_TO[0], STUB_TO[1]);
  ctx.stroke();
  ctx.fillStyle = CHIP;
  ctx.beginPath();
  ctx.arc(CX, CY, CHIP_R, 0, Math.PI * 2);
  ctx.fill();
}

/** The symbol, in ink, inside the chip. */
function symbol(ctx: Pen, picto: number): void {
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (picto) {
    case PICTO_REST:
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(CX - 24, CY - 21);
      ctx.lineTo(CX + 24, CY - 21);
      ctx.lineTo(CX - 24, CY + 22);
      ctx.lineTo(CX + 24, CY + 22);
      ctx.stroke();
      break;
    case PICTO_EAT:
      ctx.beginPath();
      ctx.arc(CX, CY, 27, 0, Math.PI * 2);
      ctx.fill();
      break;
    case PICTO_WORK:
      // A hammer: a heavy head with the haft swung down to the left. The
      // silhouette is a filled block with a diagonal tail, which is nothing
      // else in the set.
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(CX - 26, CY + 26);
      ctx.lineTo(CX + 2, CY - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CX - 6, CY - 28);
      ctx.lineTo(CX + 28, CY - 28);
      ctx.lineTo(CX + 28, CY - 1);
      ctx.lineTo(CX - 6, CY - 1);
      ctx.closePath();
      ctx.fill();
      break;
    case PICTO_SPEAK:
      ctx.beginPath();
      ctx.moveTo(CX - 30, CY - 22);
      ctx.lineTo(CX + 30, CY - 22);
      ctx.lineTo(CX + 30, CY + 10);
      ctx.lineTo(CX - 8, CY + 10);
      ctx.lineTo(CX - 20, CY + 28);
      ctx.lineTo(CX - 20, CY + 10);
      ctx.lineTo(CX - 30, CY + 10);
      ctx.closePath();
      ctx.fill();
      break;
    case PICTO_ALARM:
      ctx.beginPath();
      ctx.moveTo(CX, CY - 29);
      ctx.lineTo(CX + 30, CY + 25);
      ctx.lineTo(CX - 30, CY + 25);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
}

/** One texture holding every pictogram, laid out left to right, top to bottom. */
export function buildGlyphAtlas(): THREE.Texture {
  const size = CELL * PICTO_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let g = 1; g < PICTO_COUNT; g++) {
      ctx.save();
      ctx.translate((g % PICTO_GRID) * CELL, Math.floor(g / PICTO_GRID) * CELL);
      chip(ctx);
      symbol(ctx, g);
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The same symbol as an inline SVG path, for the legend — the same shapes at
 * the same proportions, in a 64-unit box, without the chip or the stub (a
 * legend row has no ring to weld to). The test that keeps them honest is that
 * both lists are generated from the same pictogram constants.
 */
export const PICTO_SVG: Record<number, string> = {
  [PICTO_REST]: 'M18 17 H46 L18 48 H46',
  [PICTO_EAT]: 'M32 14 a18 18 0 1 1 -0.1 0 Z',
  [PICTO_WORK]: 'M15 49 L34 30 M28 13 H50 V30 H28 Z',
  [PICTO_SPEAK]: 'M12 18 H52 V39 H27 L19 51 V39 H12 Z',
  [PICTO_ALARM]: 'M32 13 L53 50 H11 Z',
};
