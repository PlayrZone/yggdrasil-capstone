import type { WorldAdapter } from '../../contract/adapter.js';
import type { ThinkInput } from '../../contract/types.js';

/**
 * A GENERATIVE-AGENTS-LITE MEMORY, and deliberately nothing more.
 *
 * The baseline agent gets what an ordinary LLM-agent paper gives one: a stream
 * of raw observations, a rolling window of the most recent, and a summary
 * refreshed every so often. It does NOT get Yggdrasil's epistemics — no mined
 * semantic beliefs with confidence, no narrative store, no relationship
 * feelings, no place a story pulls it toward. That absence is the independent
 * variable of the whole experiment, so it is enforced here by what this file
 * READS out of a `ThinkInput` rather than by a promise in a prompt.
 *
 * Read: perception, drives, inventory, episodic summaries, its own goals.
 * Never read: `knowledge`, `stories`, `mostTold`, `social`, `kin`,
 * `sacredPlace`, `tragedyPlaces`.
 */

export interface BaselineMemoryOptions {
  /** Raw observations kept in the prompt. Default 12. */
  windowSize?: number;
  /** Refresh the summary every N thinks. Default 8. */
  summaryEvery?: number;
  /** Observations the local summarizer keeps. Default 4. */
  summaryKeep?: number;
}

export class BaselineMemory {
  private readonly window: string[] = [];
  private readonly seen = new Set<number>();
  private readonly tally = new Map<string, number>();
  private summaryText = '';
  private thinks = 0;
  private summarizedAt = -1;

  private readonly windowSize: number;
  private readonly summaryEvery: number;
  private readonly summaryKeep: number;

  constructor(options: BaselineMemoryOptions = {}) {
    this.windowSize = options.windowSize ?? 12;
    this.summaryEvery = options.summaryEvery ?? 8;
    this.summaryKeep = options.summaryKeep ?? 4;
  }

  get thinkCount(): number {
    return this.thinks;
  }

  /** Fold this moment's raw observations into the stream. */
  observe(input: ThinkInput, world: WorldAdapter): void {
    this.thinks++;
    for (const line of observationLines(input, world, this.seen)) {
      this.window.push(line);
      this.tally.set(line, (this.tally.get(line) ?? 0) + 1);
    }
    while (this.window.length > this.windowSize) this.window.shift();
  }

  recent(): readonly string[] {
    return this.window;
  }

  summary(): string {
    return this.summaryText;
  }

  /** Is it time to reflect? True at most once per cadence. */
  shouldSummarize(): boolean {
    return this.thinks - this.summarizedAt >= this.summaryEvery;
  }

  setSummary(text: string): void {
    this.summaryText = text.trim();
    this.summarizedAt = this.thinks;
  }

  /**
   * Reflection without a model: the observations this agent has made most
   * often, most-first, ties broken by first appearance. Deterministic, so a
   * mock arm B is as reproducible as arm A.
   */
  summarizeLocally(): void {
    const order = [...this.tally.keys()];
    const ranked = order
      .map((line, index) => ({ line, count: this.tally.get(line) ?? 0, index }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .slice(0, this.summaryKeep);
    this.setSummary(ranked.map((r) => `${r.line} (${r.count}×)`).join('; '));
  }

  /** What the summarizer is asked to compress, when a model does the compressing. */
  summarySource(): readonly string[] {
    const order = [...this.tally.keys()];
    return order
      .map((line, index) => ({ line, count: this.tally.get(line) ?? 0, index }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .slice(0, this.windowSize)
      .map((r) => `${r.line} (${r.count}×)`);
  }
}

/**
 * One moment, as raw lines. Only episodes not already folded in are added, so
 * the window moves with the life instead of repeating the whole retrieval every
 * think; the drive and perception lines are the current state and always go in.
 */
function observationLines(input: ThinkInput, world: WorldAdapter, seen: Set<number>): string[] {
  const lines: string[] = [];
  for (const memory of input.recalledMemories) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    lines.push(memory.summaryText);
  }
  const sights: string[] = [];
  const counts = new Map<string, number>();
  for (const r of input.worldView.resources) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const s of input.worldView.structures) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  for (const [kind, n] of counts) sights.push(`${n} ${kind}`);
  if (input.worldView.agents.length > 0) sights.push(`${input.worldView.agents.length} other people`);
  lines.push(sights.length > 0 ? `I see ${sights.join(', ')}.` : 'I see nothing of note.');
  const pressing = world.drives
    .filter((d) => (input.snapshot.needs[d.id] ?? 0) >= d.pressingAt)
    .map((d) => d.id);
  if (pressing.length > 0) lines.push(`I feel ${pressing.join(' and ')}.`);
  return lines;
}
