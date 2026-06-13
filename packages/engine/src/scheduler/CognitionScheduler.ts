import type { MindOutput } from '../contract/types.js';

export interface CognitionSchedulerOptions {
  /** Max concurrent in-flight think calls. Default 8. */
  maxConcurrent?: number;
  /** Max queued (not yet started) before submit() refuses. Default 64. */
  maxQueued?: number;
}

interface Job {
  agentId: number;
  run: () => Promise<MindOutput>;
  apply: (output: MindOutput) => void;
}

/**
 * Budgeted async queue decoupling slow minds from the fast body tick — the
 * sim NEVER awaits inference. Each agent may have at most one think in
 * flight (a second submit while pending is refused). Results are applied
 * via the per-job callback when they resolve, on whatever tick that is;
 * until then the reflex layer keeps the agent acting.
 */
export class CognitionScheduler {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly queue: Job[] = [];
  private readonly pendingIds = new Set<number>();
  private active = 0;

  constructor(options: CognitionSchedulerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 8;
    this.maxQueued = options.maxQueued ?? 64;
  }

  /**
   * Queue a think for an agent. Returns false (caller does nothing / runs
   * reflex) if the agent already has one pending or the queue is full.
   */
  submit(agentId: number, run: () => Promise<MindOutput>, apply: (output: MindOutput) => void): boolean {
    if (this.pendingIds.has(agentId)) return false;
    if (this.queue.length >= this.maxQueued) return false;
    this.pendingIds.add(agentId);
    this.queue.push({ agentId, run, apply });
    this.pump();
    return true;
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      job
        .run()
        .then(
          (output) => job.apply(output),
          () => {
            /* LlmMind already falls back internally; a throw here is swallowed
               so one bad job can't wedge the scheduler. */
          },
        )
        .finally(() => {
          this.active--;
          this.pendingIds.delete(job.agentId);
          this.pump();
        });
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  isPending(agentId: number): boolean {
    return this.pendingIds.has(agentId);
  }
}
