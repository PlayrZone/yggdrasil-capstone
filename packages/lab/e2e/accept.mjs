// @ts-check
/**
 * `pnpm --filter @yggdrasil/lab accept` — the world view, scored by machine.
 *
 * Six rounds of item L3a were scored by a hostile critic, and six times a fix
 * for what he named broke something he had already passed. That is not a
 * competence problem; it is a *process* problem. Nothing in this view could be
 * run, so nothing in it could be re-checked, so every regression had to be
 * found by a human looking at a picture — which is the most expensive detector
 * available and the slowest.
 *
 * So this file is the detector. It boots the BUILT app with the known-good
 * flags, drives REAL input events, reads truth from `window.__ygg`, and scores
 * the critic's own bars at the critic's own thresholds. It writes
 * `accept-report.json` and the canonical screenshots beside it, exits non-zero
 * on any failure, and kills every process it started.
 *
 *   node e2e/accept.mjs                       every check
 *   node e2e/accept.mjs --only=far,perf       one fix, re-verified in a minute
 *   node e2e/accept.mjs --shots=<dir>         where the evidence lands
 *   node e2e/accept.mjs --keep                leave the app open (debugging)
 *
 * Every check is independently runnable, because a check you cannot run alone
 * is a check that is run once. `--list` prints them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Lab, sleep } from './cdp.mjs';

const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── The bars, in one place, in the critic's numbers ──────────────────────────
const BAR = {
  /** `screenPositionOf` and `markScreenPositionOf` must be the same point. */
  pointPx: 0.5,
  /** How many beings that has to hold for before it means anything. */
  pointsMin: 40,
  /** Offers, paused: how many, over how many cameras, with no mispick. */
  offersMin: 300,
  camerasMin: 30,
  /** Real-mouse roster clicks. */
  rosterClicks: 30,
  /** The roster must not re-order under a resting pointer, for this long. */
  rosterStillMs: 12_000,
  /** The scale bar is a ruler or it is decoration. */
  scalePx: 0.05,
  /** NEAR naming frames. */
  namingFrames: 5,
  /** Perf: the frame, at the speed a reader actually runs. */
  perfSeconds: 30,
  perfFps: 59.5,
  perfLongTasks: 0,
  perfBeings: 250,
  /** The window below the app's declared minimum. */
  smallW: 900,
  smallH: 620,
  /** A pennant may not be taller than the person carrying it. */
  pennantOfFigure: 0.6,
  pennantFloorPx: 13,
};

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const SHOTS = String(flag('shots', path.join(os.homedir(), '.yggdrasil-lab', 'rework', 'shots', 'L3a-r7')));
const ONLY = flag('only', null);
const KEEP = !!flag('keep', false);
const PORT = Number(flag('port', 9422));

/** @type {string[]} */
const logLines = [];
const log = (line, quiet = false) => {
  logLines.push(line);
  if (!quiet) process.stdout.write(`${line}\n`);
};

// ── Small numeric helpers ────────────────────────────────────────────────────
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);

// ── World setup, the way a hand does it ──────────────────────────────────────

const SPEEDS = ['1×', '2×', '6×', '30×', '120×', '600×', '2400×'];

async function setSpeed(lab, label) {
  await lab.clickText('.speeds button', label);
}

async function setPopulation(lab, value) {
  await lab.evaluate(`(() => {
    const el = document.querySelector('.controls input[type=range]');
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, String(${value}));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function setSeed(lab, seed) {
  await lab.evaluate(`(() => {
    const el = document.querySelector('.controls label input:not([type=range])');
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(seed)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

const isRunning = (lab) => lab.evaluate(`!!document.querySelector('.controls .row button.danger')`);

/** The band strip's own words — the sentence the picture is printing. */
const stripText = (lab) => lab.evaluate(`(document.querySelector('.wband span')?.textContent || '')`);

async function setRunning(lab, on) {
  const now = await isRunning(lab);
  if (now === on) return;
  await lab.clickText('.controls .row button', on ? 'Run' : 'Pause');
  await sleep(150);
}

/**
 * A settled world: a real population, run fast enough that there are
 * settlements to look at, then PAUSED — every number a reviewer scores is
 * measured on a still picture.
 */
async function settleWorld(lab, { seed = 'genesis-01', population = 256, seconds = 26, speed = '2400×' } = {}) {
  await setRunning(lab, false);
  await setSeed(lab, seed);
  await setPopulation(lab, population);
  await setSpeed(lab, speed);
  await setRunning(lab, true);
  await sleep(seconds * 1000);
  await setRunning(lab, false);
  await lab.settle(500);
  const stats = await lab.evaluate(`(() => {
    const n = document.querySelectorAll('.panel .stat, .panel .stats *');
    return document.querySelector('.panel')?.innerText?.slice(0, 400) ?? '';
  })()`);
  log(`  world "${seed}": ${String(stats).split('\n').slice(0, 3).join(' | ')}`);
}

async function newWorld(lab, seed) {
  await setRunning(lab, false);
  await lab.clickText('.controls .row button', 'New world');
  await sleep(600);
  await settleWorld(lab, { seed });
}

/**
 * The whole continent in a DEFAULT frame — the view the app opens on, and the
 * one every perf measurement has been made in.
 *
 * `frameCandidates('default')` frames a SETTLEMENT, which holds thirty beings;
 * the frame that costs is the wide one holding three hundred. Placing it by
 * hand rather than by candidate is the difference between measuring the bar
 * and measuring something easier.
 */
async function placeContinent(lab) {
  const W = 2000;
  await lab.evaluate(`(window.__ygg.placeCamera(
    { x: ${-W * 0.26}, y: ${W * 0.5}, z: ${W * 0.42} },
    { x: 0, y: 40, z: ${-W * 0.05} }
  ), true)`);
  await lab.settle(400);
  return lab.probe('cameraReport');
}

/** Put the camera on the n-th place worth looking at, in this band. */
async function placeOn(lab, band, index) {
  const cands = await lab.probe('frameCandidates', band);
  if (!Array.isArray(cands) || cands.length === 0) return null;
  const c = cands[index % cands.length];
  await lab.evaluate(`(window.__ygg.placeCamera(${JSON.stringify(c.camera)}, ${JSON.stringify(c.target)}), true)`);
  await lab.settle(260);
  return c;
}

// ── The checks ───────────────────────────────────────────────────────────────
//
// Each returns { pass, numbers }. Throwing is a failure with a reason.

const CHECKS = {};

/**
 * 1 — the instrument is WELL, and says so honestly.
 *
 * Every count zero at boot, mid-run and before close; and the tap proved by a
 * deliberate error, because a counter that cannot go up is not a counter.
 */
CHECKS.health = async (lab, ctx) => {
  const boot = ctx.bootHealth;
  await settleWorld(lab, { seconds: 12 });
  const mid = await lab.probe('health');
  const cull = await lab.probe('cullAudit');
  const before = await lab.probe('health');
  await lab.evaluate(`(console.error('accept: a deliberate console error'), true)`);
  await sleep(120);
  const afterConsole = await lab.probe('health');
  await lab.evaluate(`(setTimeout(() => { throw new Error('accept: a deliberate window error'); }, 0), true)`);
  await sleep(250);
  const afterWindow = await lab.probe('health');
  const zero = (h) => h.shaderErrors === 0 && h.consoleErrors === 0 && h.webglContextLost === 0 && h.windowErrors === 0 && h.cullRisks === 0;
  const tapConsole = afterConsole.consoleErrors === before.consoleErrors + 1;
  const tapWindow = afterWindow.windowErrors === before.windowErrors + 1;
  return {
    pass: zero(boot) && zero(mid) && cull.length === 0 && tapConsole && tapWindow,
    numbers: { boot, mid, cullRisks: cull, tapConsole, tapWindow },
  };
};

/**
 * 2 — FAR is reachable with a wheel, on any window, and the report agrees.
 *
 * The bar the view keeps breaking. Round three could not reach it; round four
 * fixed it; round six inverted the wheel AND left `farReachable` asserting the
 * opposite of what the mouse does. So this measures three things that have to
 * agree: what a DOM listener sees for a notch, what the camera does with it,
 * and what `cameraReport()` claims about both.
 */
CHECKS.far = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab, { seconds: 14 });
  const runs = [];
  const geometries = [
    { name: 'default-window', set: null },
    { name: 'short-window', set: [1280, 720] },
    { name: 'after-live-resize', set: [1500, 860], resizeDuring: true },
  ];
  for (const g of geometries) {
    if (g.set) await lab.setViewport(g.set[0], g.set[1]);
    else await lab.clearViewport();
    await placeOn(lab, 'default', 0);
    // The sign, measured rather than assumed: what does a DOM listener see?
    const canvas = await lab.rect('canvas.world3d');
    const cx = canvas.x + canvas.w / 2;
    const cy = canvas.y + canvas.h / 2;
    const domDelta = await lab.wheelProbe(cx, cy, 120);
    const start = await lab.probe('cameraReport');
    await lab.wheel(cx, cy, 120);
    await lab.settle(200);
    const oneOut = await lab.probe('cameraReport');
    const zoomsOut = oneOut.distance > start.distance;
    // Whichever direction pulls back, drive it. A harness that guesses the
    // convention measures its own guess.
    const outDelta = zoomsOut ? 120 : -120;
    let notches = 0;
    let report = oneOut;
    for (; notches < 90; notches++) {
      await lab.wheel(cx, cy, outDelta);
      if (notches % 5 === 4) {
        await lab.settle(90);
        report = await lab.probe('cameraReport');
        if (report.band === 'far') break;
      }
    }
    await lab.settle(350);
    report = await lab.probe('cameraReport');
    if (g.resizeDuring) {
      await lab.setViewport(1180, 700);
      await lab.settle(400);
      report = await lab.probe('cameraReport');
    }
    const band = await lab.probe('zoomBand');
    runs.push({
      geometry: g.name,
      notches: notches + 1,
      band,
      figurePx: Number(report.figurePx.toFixed(3)),
      enterFarPx: Number(report.enterFarPx.toFixed(3)),
      stopFigurePx: Number(report.stopFigurePx.toFixed(3)),
      atStop: report.atStop,
      farReachable: report.farReachable,
      canvasH: report.canvasH,
      projectionH: report.projectionH,
      domDeltaSeenForPlus120: domDelta,
      wheelZoomsOutOnScrollDown: zoomsOut,
      pass: band === 'far'
        && report.figurePx < report.enterFarPx
        && report.farReachable === true
        && report.canvasH === report.projectionH,
    });
    log(`  far/${g.name}: ${notches + 1} notches → ${band}, figurePx ${report.figurePx.toFixed(3)} vs enter ${report.enterFarPx.toFixed(3)}, atStop ${report.atStop}, farReachable ${report.farReachable}`);
  }
  await lab.clearViewport();
  await lab.shot('r7-far');
  return { pass: runs.every((r) => r.pass), numbers: { runs } };
};

/**
 * 3 — one screen point per being, and the mouse goes where the probe says.
 */
CHECKS.points = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  let checked = 0;
  let worst = 0;
  let pickAgrees = 0;
  let pickTried = 0;
  // Wide, because the population a frame OFFERS is small on purpose: a hut's
  // occupants are the building's to speak for and are not in `visibleIds()`,
  // so forty beings is a dozen cameras rather than three.
  for (let c = 0; c < 60 && checked < BAR.pointsMin + 8; c++) {
    await placeOn(lab, ['mid', 'default', 'near'][c % 3], Math.floor(c / 3));
    const ids = await lab.probe('visibleIds');
    const sample = ids.slice(0, 20);
    const rows = await lab.evaluate(`(() => ${JSON.stringify(sample)}.map((id) => ({
      id,
      p: window.__ygg.screenPositionOf(id),
      m: window.__ygg.markScreenPositionOf(id),
      inside: (window.__ygg.visibilityOf(id) || {}).carriedBy,
    })))()`);
    for (const r of rows) {
      if (!r.p || !r.m || r.inside !== null) continue;
      const d = Math.hypot(r.p.x - r.m.x, r.p.y - r.m.y);
      worst = Math.max(worst, d);
      checked++;
    }
    for (const id of sample.slice(0, 6)) {
      const p = await lab.probe('screenPositionOf', id);
      if (!p) continue;
      const hits = await lab.probe('pickAtScreen', p.x, p.y);
      pickTried++;
      if (hits[0]?.id === id) pickAgrees++;
    }
  }
  return {
    pass: checked >= BAR.pointsMin && worst <= BAR.pointPx && pickTried > 0 && pickAgrees === pickTried,
    numbers: { checked, worstPx: Number(worst.toFixed(3)), pickAgrees, pickTried },
  };
};

/**
 * 4 — the offered set is the picker's own answer, paused and running.
 *
 * The definition of "offered" is `pickAtScreen(screenPositionOf(id))[0] === id`,
 * so the only honest test is to drive the REAL mouse to each offered being's
 * own reported point and read the card. A mispick hands a reader somebody
 * else; "lost" opens nothing, which is honest but still a miss.
 */
CHECKS.offers = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const bands = ['mid', 'near', 'default'];
  let offers = 0;
  let cameras = 0;
  let mispicks = 0;
  let lost = 0;
  const misses = [];
  for (let world = 0; world < 2; world++) {
    if (world === 1) await newWorld(lab, 'genesis-02');
    for (let c = 0; c < 120 && offers < BAR.offersMin * 1.1; c++) {
      const band = bands[c % bands.length];
      const placed = await placeOn(lab, band, Math.floor(c / bands.length));
      if (!placed) continue;
      cameras++;
      const ids = (await lab.probe('visibleIds')).slice(0, 14);
      for (const id of ids) {
        const p = await lab.probe('screenPositionOf', id);
        if (!p) continue;
        await lab.move(p.x, p.y);
        // Long enough for the view to have picked: the hover raycast is capped
        // at one every 70 ms and the limiter can be at ten frames a second
        // before the pointer moves. A hundred milliseconds is the boundary,
        // and a harness that measures on the boundary measures itself.
        await sleep(200);
        const got = await lab.probe('hoveredId');
        offers++;
        if (got === null) { lost++; misses.push({ id, kind: 'lost', band }); }
        else if (got !== id) { mispicks++; misses.push({ id, got, kind: 'mispick', band }); }
      }
    }
  }
  // And again with the world RUNNING, where the idle animation moves the
  // bodies between the read and the press.
  await setSpeed(lab, '30×');
  await setRunning(lab, true);
  let runMispicks = 0;
  let runLost = 0;
  let runOffers = 0;
  for (let c = 0; c < 4; c++) {
    await placeOn(lab, 'mid', c);
    const ids = (await lab.probe('visibleIds')).slice(0, 8);
    for (const id of ids) {
      const p = await lab.probe('screenPositionOf', id);
      if (!p) continue;
      await lab.move(p.x, p.y);
      await sleep(110);
      const got = await lab.probe('hoveredId');
      runOffers++;
      if (got === null) runLost++;
      else if (got !== id) runMispicks++;
    }
  }
  await setRunning(lab, false);
  await lab.shot('r7-offers');
  return {
    pass: offers >= BAR.offersMin && cameras >= BAR.camerasMin && mispicks === 0 && lost === 0 && runMispicks === 0,
    numbers: { offers, cameras, mispicks, lost, runOffers, runMispicks, runLost, misses: misses.slice(0, 12) },
  };
};

/**
 * 5 — the roster answers the hand, and stands still while it is being read.
 */
CHECKS.roster = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  await lab.ui('roster', true);
  await lab.settle(400);
  let clicks = 0;
  let right = 0;
  const wrong = [];
  for (const speed of ['1×', '120×', '2400×']) {
    await setSpeed(lab, speed);
    await setRunning(lab, speed !== '1×');
    for (let n = 0; n < 12 && clicks < BAR.rosterClicks + 6; n++) {
      const row = await lab.evaluate(`(() => {
        const rows = [...document.querySelectorAll('.rbody .rrow')];
        if (rows.length === 0) return null;
        const el = rows[${n} % rows.length];
        const r = el.getBoundingClientRect();
        const body = document.querySelector('.rbody').getBoundingClientRect();
        // Deliberately including rows clipped by the box edge.
        const y = Math.min(Math.max(r.top + r.height / 2, body.top + 1), body.bottom - 1);
        return { x: r.left + 40, y, name: (el.querySelector('.c-name')?.textContent || '').trim() };
      })()`);
      if (!row) break;
      const under = await lab.evaluate(`(() => {
        const el = document.elementFromPoint(${row.x}, ${row.y});
        const rw = el && el.closest ? el.closest('.rrow') : null;
        return rw ? (rw.querySelector('.c-name')?.textContent || '').trim() : null;
      })()`);
      await lab.click(row.x, row.y);
      await sleep(220);
      clicks++;
      const sel = await lab.evaluate(`(() => {
        const el = document.querySelector('.rbody .rrow.sel');
        return el ? (el.querySelector('.c-name')?.textContent || '').trim() : null;
      })()`);
      if (sel !== null && under !== null && sel === under) right++;
      else wrong.push({ aimedAt: under, selected: sel, speed });
    }
  }
  await setRunning(lab, false);
  // And it must not re-order under a resting pointer.
  await setSpeed(lab, '2400×');
  await setRunning(lab, true);
  const box = await lab.rect('.rbody');
  await lab.move(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(400);
  const before = await lab.evaluate(`[...document.querySelectorAll('.rbody .rrow')].map((r) => (r.querySelector('.c-name')?.textContent || '').trim()).join('|')`);
  await sleep(BAR.rosterStillMs);
  const after = await lab.evaluate(`[...document.querySelectorAll('.rbody .rrow')].map((r) => (r.querySelector('.c-name')?.textContent || '').trim()).join('|')`);
  await setRunning(lab, false);
  await lab.shot('r7-roster');
  return {
    pass: clicks >= BAR.rosterClicks && right === clicks && before === after && before.length > 0,
    numbers: { clicks, right, wrong: wrong.slice(0, 8), stillMs: BAR.rosterStillMs, orderHeld: before === after },
  };
};

/** 6 — the count closes, whole frame and quadrant by quadrant. */
CHECKS.quadrants = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const frames = [];
  for (let c = 0; c < 5; c++) {
    await placeOn(lab, 'default', c);
    const a = await lab.probe('countAudit');
    if (!a.counts) continue;
    const chipSum = a.chips.reduce((s, x) => s + x.n, 0);
    frames.push({
      pins: a.pinsDrawn, chips: chipSum, beings: a.beingsInFrustum,
      whole: a.pinsDrawn + chipSum === a.beingsInFrustum,
      quadrants: a.quadrants.map((q) => q.reconciles),
    });
  }
  const bad = frames.filter((f) => !f.whole || f.quadrants.some((q) => !q));
  return { pass: frames.length >= 4 && bad.length === 0, numbers: { frames } };
};

/** 7 — the ruler is a ruler, and the world is life-size. */
CHECKS.scale = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const rows = [];
  for (const band of ['far', 'default', 'mid', 'near']) {
    await placeOn(lab, band, 0);
    const got = await lab.probe('zoomBand');
    const bar = await lab.probe('scaleBar');
    const want = bar.metresPerPx > 0 ? bar.metres / bar.metresPerPx : 0;
    const dom = await lab.evaluate(`(() => {
      const el = document.querySelector('.wband .wbar');
      if (!el) return null;
      return { w: el.getBoundingClientRect().width, span: el.dataset.span || '' };
    })()`);
    rows.push({
      asked: band, got, metres: bar.metres, px: Number(bar.px.toFixed(3)),
      expectedPx: Number(want.toFixed(3)), errPx: Number(Math.abs(bar.px - want).toFixed(4)),
      label: bar.label, domWidth: dom ? Number(dom.w.toFixed(1)) : null, domSpan: dom?.span ?? null,
      inMetres: /m\b/i.test(bar.label),
    });
  }
  const rep = await lab.probe('scaleReport');
  const order = rep.adult < rep.hut && rep.hut < rep.treeShortest;
  return {
    pass: rows.every((r) => r.errPx <= BAR.scalePx && r.inMetres) && order
      && near(rep.adult, 1.75, 0.01) && near(rep.hut, 4.4, 0.15) && rep.hutFrom === 'mesh',
    numbers: { rows, scaleReport: rep, trueScaleOrder: order },
  };
};

/** 8 — NEAR names what it says it names, and the strip is the audit's words. */
CHECKS.naming = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const frames = [];
  for (let c = 0; c < 8 && frames.length < BAR.namingFrames; c++) {
    await placeOn(lab, 'near', c);
    if ((await lab.probe('zoomBand')) !== 'near') continue;
    const audit = await lab.probe('labelAudit');
    const shown = await lab.probe('labelsShown');
    const strip = await stripText(lab);
    const pills = await lab.evaluate(`[...document.querySelectorAll('.wlabel')].filter((n) => n.offsetParent !== null).length`);
    frames.push({
      claim: audit.claim, violations: audit.violations, expected: audit.expected,
      shown: audit.shown, within: audit.within, carried: audit.carried,
      labelsShown: shown.length, domPills: pills,
      stripHasClaim: String(strip).includes(audit.claim),
    });
  }
  const bad = frames.filter((f) => f.violations !== 0 || !f.stripHasClaim || f.expected !== f.shown || f.shown !== f.labelsShown);
  return { pass: frames.length >= BAR.namingFrames && bad.length === 0, numbers: { frames, bad } };
};

/**
 * 9 — sixty frames a second with nothing stalling, at the speed a reader runs.
 *
 * Round five held 60.00 fps with zero long tasks at 272 beings. Round six
 * shipped a lighting effect, an outline pass and a new mark and measured none
 * of them: 56–58 fps and 41 long tasks up to 161 ms, roster open OR closed.
 * A round that adds to the frame owns the frame's budget.
 */
CHECKS.perf = async (lab, ctx) => {
  // A maximised window's worth of canvas. Every perf number this item has ever
  // been scored on was measured on one, and a 388 px canvas is a fill rate
  // nobody was arguing about.
  await lab.setViewport(1920, 1200);
  await settleWorld(lab, { population: 256, seconds: 34 });
  const runs = [];
  for (const rosterOpen of [true, false]) {
    await lab.ui('roster', rosterOpen);
    await placeContinent(lab);
    await setSpeed(lab, '2400×');
    await setRunning(lab, true);
    await lab.settle(800);
    const alive = (await lab.probe('countAudit')).beingsInFrustum;
    await lab.startLongTasks();
    const f0 = await lab.probe('renderCount');
    const t0 = Date.now();
    await sleep(BAR.perfSeconds * 1000);
    const f1 = await lab.probe('renderCount');
    const t1 = Date.now();
    const longs = await lab.stopLongTasks();
    await setRunning(lab, false);
    const fps = ((f1 - f0) / ((t1 - t0) / 1000));
    runs.push({
      rosterOpen, fps: Number(fps.toFixed(2)), frames: f1 - f0, seconds: Number(((t1 - t0) / 1000).toFixed(1)),
      beingsInFrustum: alive, longTasks: longs.length, longestMs: longs.length ? Math.max(...longs) : 0,
      // A green light on a frame holding thirty beings is not the bar. If the
      // run did not reproduce the load, the check says so rather than passing.
      reproducedLoad: alive >= BAR.perfBeings,
      pass: fps >= BAR.perfFps && longs.length <= BAR.perfLongTasks && alive >= BAR.perfBeings,
    });
    log(`  perf roster=${rosterOpen}: ${fps.toFixed(2)} fps, ${longs.length} long tasks (max ${longs.length ? Math.max(...longs) : 0} ms), ${alive} in frustum`);
  }
  // NEAR, in a packed settlement — the other end of the cost.
  await placeOn(lab, 'near', 0);
  await setRunning(lab, true);
  await lab.startLongTasks();
  const n0 = await lab.probe('renderCount');
  const nt0 = Date.now();
  await sleep(10_000);
  const n1 = await lab.probe('renderCount');
  const nt1 = Date.now();
  const nearLongs = await lab.stopLongTasks();
  await setRunning(lab, false);
  const nearFps = (n1 - n0) / ((nt1 - nt0) / 1000);
  // The limiter: 60 while something is changing, 10 while nothing is.
  await setRunning(lab, false);
  await lab.settle(900);
  const i0 = await lab.probe('renderCount');
  await sleep(4000);
  const i1 = await lab.probe('renderCount');
  const idleFps = (i1 - i0) / 4;
  await lab.shot('r7-perf-default');
  await lab.clearViewport();
  return {
    pass: runs.every((r) => r.pass) && nearFps >= BAR.perfFps && nearLongs.length === 0 && idleFps < 20,
    numbers: {
      runs, nearFps: Number(nearFps.toFixed(2)), nearLongTasks: nearLongs.length,
      idleDrawsPerSecond: Number(idleFps.toFixed(1)),
      beingsBar: BAR.perfBeings,
    },
  };
};

/**
 * 10 — below the app's own minimum the PICTURE is not the first thing dropped.
 *
 * Round six forced 900 × 620, watched the canvas collapse to 534 × 293 and
 * `visibleIds()` return ZERO, and could not make the coordinate-frame check it
 * came to make because there was nothing left to point at.
 */
CHECKS.small = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  await lab.setViewport(BAR.smallW, BAR.smallH);
  // On a canvas this small the same camera lands in a WIDER band, where a
  // settlement is one chip and nobody is offered individually — which is the
  // contract working, not the layout failing. The question this check exists
  // to ask is whether a reader can still get to a band that draws people at
  // all, so it walks in until one does.
  let band = 'mid';
  for (let c = 0; c < 12; c++) {
    await placeOn(lab, c % 2 === 0 ? 'near' : 'mid', Math.floor(c / 2));
    await lab.settle(420);
    band = await lab.probe('zoomBand');
    if ((await lab.probe('visibleIds')).length > 0) break;
  }
  await lab.settle(700);
  const canvas = await lab.rect('canvas.world3d');
  const ids = await lab.probe('visibleIds');
  const chips = await lab.probe('chipsOnScreen');
  const audit = await lab.probe('countAudit');
  let frameHolds = true;
  if (ids.length > 0) {
    const p = await lab.probe('screenPositionOf', ids[0]);
    const hits = await lab.probe('pickAtScreen', p.x, p.y);
    frameHolds = hits[0]?.id === ids[0]
      && p.x >= canvas.x && p.x <= canvas.x + canvas.w && p.y >= canvas.y && p.y <= canvas.y + canvas.h;
  }
  const share = (canvas.w * canvas.h) / (BAR.smallW * BAR.smallH);
  await lab.shot('r7-small-window');
  await lab.clearViewport();
  await lab.settle(400);
  return {
    pass: ids.length > 0 && audit.beingsInFrustum > 0 && frameHolds && share >= 0.30,
    numbers: {
      canvas: { w: Number(canvas.w.toFixed(1)), h: Number(canvas.h.toFixed(1)) },
      band,
      shareOfWindow: Number(share.toFixed(3)), offered: ids.length,
      beingsInFrustum: audit.beingsInFrustum, chips: chips.length, coordinateFrameHolds: frameHolds,
    },
  };
};

/** 11 + 12 — the shelter chip IS the reading, so it had better be true. */
CHECKS.shelter = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const seen = [];
  let nameButtons = 0;
  let nameRight = 0;
  for (let c = 0; c < 10 && seen.length < 6; c++) {
    await placeOn(lab, c % 2 === 0 ? 'mid' : 'near', c);
    // Take the pointer off whatever it was on first. A chip card left open
    // from the previous camera sits over the next chip's own point, and
    // `elementFromPoint` then honestly reports the card — which this harness
    // first read as "the chip is not where the probe says it is".
    await lab.move(4, 4);
    await sleep(260);
    // Both reads in ONE frame. The crowd plan is redone eleven times a second
    // whatever the world is doing, so a cluster INDEX read in one round trip
    // and summarised in the next can be a different hut — which this harness
    // first read as the chip lying about its own count.
    const chips = await lab.evaluate(`(() => window.__ygg.chipsOnScreen()
      .filter((c) => c.inside)
      .slice(0, 2)
      .map((c) => ({ chip: c, sum: window.__ygg.chipSummary(c.cluster) })))()`);
    for (const { chip, sum } of chips) {
      if (!sum) continue;
      // The chip's OWN node, found the way the mouse finds it — at the point
      // the probe reports. Matching by number picks a different chip that
      // happens to hold the same count, and a `.will` that is `display:none`
      // still has last frame's text in it, which is how this harness first
      // read "1 unwell" off six healthy huts.
      const mix = await lab.evaluate(`(() => {
        const at = document.elementFromPoint(${chip.x}, ${chip.y});
        const el = at && at.closest ? at.closest('.wcount') : null;
        if (!el) return null;
        const vis = (n) => !!n && n.offsetParent !== null && getComputedStyle(n).display !== 'none';
        const bar = el.querySelector('.wmix');
        const r = vis(bar) ? bar.getBoundingClientRect() : null;
        const ill = el.querySelector('.will');
        return {
          mixW: r ? r.width : 0, mixH: r ? r.height : 0,
          ill: vis(ill) ? (ill.textContent || '').trim() : '',
          num: (el.querySelector('.wnum')?.textContent || '').trim(),
          inside: el.classList.contains('inside'),
        };
      })()`);
      const unwell = sum.mix.filter((m) => m.word !== 'well').reduce((s, m) => s + m.count, 0);
      seen.push({
        cluster: chip.cluster, count: chip.count, truth: sum.count, inside: sum.inside,
        mixW: mix?.mixW ?? 0, mixH: mix?.mixH ?? 0, illShown: mix?.ill ?? null, unwellTruth: unwell,
        numDrawn: mix?.num ?? null,
        // The BAR: the number the chip carries is the number of people in the
        // hut. Measured against the summary, which is the sim's own list.
        countRight: chip.count === sum.count,
        // And a separate, stricter reading: is the mouse at this chip's own
        // reported point over THIS chip's node? Where two occupied huts stand
        // close together their discs can overlap and the topmost wins, which is
        // a real (small) defect and not a lie about the count — so it is
        // reported apart from the bar rather than folded into it.
        domIsThisChip: mix === null ? false : String(mix.num) === String(sum.count),
        mixDrawn: (mix?.mixW ?? 0) > 0 && (mix?.mixH ?? 0) > 0,
        illRight: mix === null ? null
          : unwell === 0 ? (mix.ill ?? '') === '' : String(mix.ill ?? '') === String(unwell),
      });
      // A name button in the card must select that being and no other.
      await lab.move(chip.x, chip.y);
      await sleep(200);
      const btn = await lab.evaluate(`(() => {
        const b = document.querySelector('.chipcard .hwho button, .chipcard button');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (b.textContent || '').trim() };
      })()`);
      if (btn) {
        await lab.click(btn.x, btn.y);
        await sleep(260);
        const selName = await lab.evaluate(`(document.querySelector('.selbar')?.textContent || '')`);
        nameButtons++;
        if (String(selName).includes(btn.text)) nameRight++;
      }
    }
  }
  const strip = await stripText(lab);
  const audit = await lab.probe('labelAudit');
  // The strip's own sentence for the people a building is speaking for. It is
  // `nameClaimFor`'s wording, so this string moves when the wording does.
  const clause = audit.carried > 0
    ? String(strip).includes(`${audit.carried} indoors, counted on their roofs`)
    : true;
  await lab.shot('r7-shelter');
  const onTheirOwnPoint = seen.filter((s) => s.domIsThisChip);
  return {
    pass: seen.length > 0
      && seen.every((s) => s.countRight)
      && onTheirOwnPoint.length > 0
      && onTheirOwnPoint.every((s) => s.mixDrawn && s.illRight !== false)
      && clause && (nameButtons === 0 || nameRight === nameButtons),
    numbers: {
      chips: seen, stripCarriedClause: clause, carried: audit.carried, nameButtons, nameRight,
      chipsFoundOnTheirOwnPoint: `${onTheirOwnPoint.length}/${seen.length}`,
    },
  };
};

/**
 * 13 — the canonical pictures, for human and critic eyes.
 *
 * Not scored. A harness that can only produce numbers cannot say whether a lit
 * window reads as firelight, and pretending otherwise is how a grey rectangle
 * shipped as the headline fix of a round.
 */
CHECKS.shots = async (lab, ctx) => {
  if (!ctx.worldReady) await settleWorld(lab);
  const made = [];
  const shoot = async (name) => { made.push(path.basename(await lab.shot(name))); };
  // Day.
  await placeOn(lab, 'default', 0); await shoot('r7-day-default');
  await placeOn(lab, 'near', 0); await shoot('r7-day-near-settlement');
  // Night: run until dark, then hold.
  await setSpeed(lab, '600×');
  for (let i = 0; i < 40; i++) {
    await setRunning(lab, true);
    await sleep(900);
    await setRunning(lab, false);
    await lab.settle(250);
    if ((await lab.probe('daylight')) < 0.02) break;
  }
  const dark = await lab.probe('daylight');
  await placeOn(lab, 'mid', 0); await shoot('r7-night-mid');
  await placeOn(lab, 'near', 0); await shoot('r7-night-near-hut');
  await placeOn(lab, 'default', 0); await shoot('r7-night-default');
  // Specimen, and the two colour-blind views a reviewer re-derives.
  await lab.probe('specimen', true);
  await lab.settle(500);
  await placeOn(lab, 'mid', 0);
  await shoot('r7-specimen');
  await lab.probe('specimen', false);
  await lab.settle(300);
  return { pass: made.length >= 6, numbers: { shots: made, daylightAtNight: dark }, advisory: true };
};

// ── Runner ───────────────────────────────────────────────────────────────────

const ORDER = ['health', 'far', 'points', 'offers', 'roster', 'quadrants', 'scale', 'naming', 'perf', 'small', 'shelter', 'shots'];

async function main() {
  if (flag('list')) {
    process.stdout.write(`${ORDER.join('\n')}\n`);
    return 0;
  }
  const wanted = ONLY === null || ONLY === true ? ORDER : String(ONLY).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !ORDER.includes(w));
  if (unknown.length) throw new Error(`no such check: ${unknown.join(', ')} (have: ${ORDER.join(', ')})`);

  mkdirSync(SHOTS, { recursive: true });
  const home = path.join(os.tmpdir(), `ygg-accept-${process.pid}`);
  const started = new Date().toISOString();
  log(`accept: ${wanted.join(', ')}`);
  log(`  lab ${LAB_DIR}`);
  log(`  home ${home}`);
  log(`  shots ${SHOTS}`);

  const lab = await Lab.launch({ labDir: LAB_DIR, home, shotsDir: SHOTS, port: PORT, log });
  const results = [];
  let ctx = { worldReady: false, bootHealth: null };
  try {
    // The first read a session makes, before anything else means anything.
    ctx.bootHealth = await lab.probe('health');
    log(`  boot health ${JSON.stringify(ctx.bootHealth)}`);
    // Prove it is drawing before it is measured.
    const drew = await lab.settle(1200);
    log(`  drawing: ${drew} frames`);

    for (const name of wanted) {
      const t0 = Date.now();
      log(`▸ ${name}`);
      let out;
      try {
        out = await CHECKS[name](lab, ctx);
        ctx.worldReady = true;
      } catch (e) {
        out = { pass: false, numbers: { error: String(e?.message ?? e) } };
      }
      const ms = Date.now() - t0;
      results.push({ check: name, pass: !!out.pass, advisory: !!out.advisory, seconds: Math.round(ms / 100) / 10, ...out.numbers ? { numbers: out.numbers } : {} });
      log(`  ${out.pass ? 'PASS' : 'FAIL'} ${name} (${(ms / 1000).toFixed(1)} s)`);
    }
  } finally {
    const closeHealth = await lab.probe('health').catch(() => null);
    const shutdown = KEEP ? { killed: [], alive: lab.pids, kept: true } : await lab.close();
    const failed = results.filter((r) => !r.pass && !r.advisory);
    const report = {
      item: 'L3a/L4 — the world view',
      round: 7,
      started,
      finished: new Date().toISOString(),
      lab: LAB_DIR,
      bars: BAR,
      pids: lab.pids,
      shutdown,
      pageErrors: lab.pageErrors,
      bootHealth: ctx.bootHealth,
      closeHealth,
      checks: results,
      passed: results.filter((r) => r.pass).length,
      failed: failed.map((r) => r.check),
      verdict: failed.length === 0 ? 'PASS' : 'FAIL',
      log: logLines,
    };
    const file = path.join(SHOTS, 'accept-report.json');
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n${report.verdict}: ${report.passed}/${results.length} checks\n`);
    if (failed.length) process.stdout.write(`  failed: ${failed.map((r) => r.check).join(', ')}\n`);
    process.stdout.write(`  report ${file}\n`);
    process.stdout.write(`  pids ${lab.pids.join(',')} — alive after close: ${shutdown.alive.join(',') || 'none'}\n`);
    process.exitCode = failed.length === 0 && shutdown.alive.length === 0 ? 0 : 1;
  }
  return process.exitCode ?? 0;
}

main().catch((e) => {
  process.stderr.write(`accept: ${e?.stack ?? e}\n`);
  process.exitCode = 1;
});
