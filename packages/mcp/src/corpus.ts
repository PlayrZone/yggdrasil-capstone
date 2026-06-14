import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusDir } from './home.js';

/**
 * One entry in the Yggdrasil Civilization Corpus (Phase 2). Captures what a
 * CONSCIOUS being did and — crucially — the cultural context it acted from:
 * the stories it carries, the kin it knows, its felt relationships. This is
 * the raw material for studying cultural inheritance, mentorship, myth
 * interpretation, tradition, and institution formation — and, eventually, the
 * training corpus for a dedicated Yggdrasil model. Collected now, never trained
 * on until enough civilization-scale data exists.
 *
 * `at` is the sim tick (deterministic-friendly; no wall clock in the data).
 */
export interface CorpusEntry {
  at: number;
  experiment: string;
  kind: 'cognition' | 'speech' | 'interpretation' | 'cultural-inheritance' | 'mentorship' | 'leadership' | 'tradition' | 'institution' | 'belief-change' | 'goal';
  agentId: number;
  name: string;
  trigger?: string;
  thought?: string;
  goals?: string[];
  utterances?: { speechAct: string; text?: string; targetId?: number }[];
  storiesHeld?: { text: string; firsthand: boolean }[];
  kin?: { name: string; relation: string }[];
  /** Anything experiment-specific (interpretation labels detected, follow target, …). */
  data?: Record<string, unknown>;
}

const FILE = 'civilization.jsonl';

export function appendCorpus(entry: CorpusEntry): void {
  try {
    appendFileSync(join(corpusDir(), FILE), JSON.stringify(entry) + '\n');
  } catch {
    // The corpus is best-effort capture; never let it break an experiment.
  }
}

export function corpusFilePath(): string {
  return join(corpusDir(), FILE);
}
