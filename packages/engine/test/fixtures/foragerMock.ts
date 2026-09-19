import { foragerAdapter, foragerEdges, replyWriter } from '../../src/index.js';

/**
 * THE FORAGER WORLD'S MOCK BACKEND OPTIONS, in one place (W1-B4 round 4).
 *
 * `MockMindBackend` stands where a MODEL stands, so it has to write what a model
 * writes — this world's own wire fields, not a policy's opaque places. Only the
 * world's codec crosses between the two, and the mock lives in a mind directory
 * where a codec may not go, so the wiring that built the world hands it one
 * narrow function instead (`MockMindBackendOptions.writeReply`).
 *
 * In production that wiring is `SimRuntime`/a driver; in tests it is this. It is
 * a constant rather than a factory because it holds no state: spread it into any
 * mock's options and add `policy`/`failTimes` after it.
 */
export const FORAGER_MOCK = {
  world: foragerAdapter,
  writeReply: replyWriter(foragerEdges.codec),
} as const;
