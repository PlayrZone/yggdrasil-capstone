import type { MindOutput, ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { LeakDomain } from './leakMatch.js';
import { LEAK_DOMAINS, detectLexicalLeaks } from './leakMatch.js';

/**
 * TIER 3 of the fidelity gate: the seam where a reader that understands
 * paraphrase plugs in.
 *
 * Tiers 1 and 2 are a lower bound by construction — an act rule and a stemmed
 * lexicon cannot follow "the small hard things I carry, put under the soil,
 * will not be lost" to the fact it asserts. Only a reader can. So the gate
 * defines the seam now, ships a deterministic mock for the tests, and leaves
 * the LLM-backed implementation behind the caller's existing `allowPaid` guard
 * (it is not exercised in this round: no key, no paid call).
 *
 * The verdict rule that makes the seam matter: the gate may print PASS only
 * when a CALIBRATED judge ran. Without one it prints NO LEAK DETECTED and the
 * measured recall of whatever detector did run.
 */

export type LeakJudgement = 'leak' | 'clean' | 'unsure';

export interface LeakJudgeRequest {
  /** The domain the probe is about — the judge may look wider. */
  domain: LeakDomain;
  /** What a pretrained model finds obvious here and this being was never shown. */
  temptation: string;
  /** The being's situation: everything it was given, and nothing else. */
  input: ThinkInput;
  output: MindOutput;
  /** The raw completion, for a judge that wants the text as it came. */
  raw: string;
  /** Set on a control: the domain whose ground this being legitimately holds. */
  grounded?: LeakDomain;
}

export interface LeakJudgeVerdict {
  judgement: LeakJudgement;
  /** The span the judgement rests on. A verdict with no citation is an opinion. */
  span?: string;
  reason?: string;
}

export interface ILeakJudge {
  readonly id: string;
  judge(request: LeakJudgeRequest): Promise<LeakJudgeVerdict>;
}

export interface MockLeakJudgeOptions {
  /** Exact `thought`/utterance text → verdict. Consulted first. */
  overrides?: ReadonlyMap<string, LeakJudgement>;
  /** What to say when nothing fires. Default `clean`. */
  fallback?: LeakJudgement;
  id?: string;
}

/**
 * A deterministic stand-in: no I/O, no clock, same answer every time. It reads
 * STRICTLY — hedging buys nothing here, which is the one thing it adds over
 * tier 2 — and it says `unsure` when the only thing it found was a hedge built
 * out of words the being was actually given. Tests use it to exercise the
 * plumbing and the verdict rule; it is scored by the same calibration harness
 * as any other detector, so it can never be quoted as more than it measures.
 */
export class MockLeakJudge implements ILeakJudge {
  readonly id: string;
  private readonly overrides: ReadonlyMap<string, LeakJudgement>;
  private readonly fallback: LeakJudgement;

  constructor(options: MockLeakJudgeOptions = {}) {
    this.id = options.id ?? 'mock-strict-judge';
    this.overrides = options.overrides ?? new Map();
    this.fallback = options.fallback ?? 'clean';
  }

  judge(request: LeakJudgeRequest): Promise<LeakJudgeVerdict> {
    const said = [request.output.thought ?? '', ...request.output.utterances.map((u) => u.text ?? '')];
    for (const text of said) {
      const override = this.overrides.get(text.trim());
      if (override) return Promise.resolve({ judgement: override, span: text.trim(), reason: 'labelled' });
    }
    const domains = request.grounded ? LEAK_DOMAINS.filter((d) => d !== request.grounded) : LEAK_DOMAINS;
    const strict = detectLexicalLeaks(request.output, {}, domains);
    const decisive = strict.filter((e) => e.kind === 'claim');
    if (decisive.length > 0) {
      return Promise.resolve({ judgement: 'leak', span: decisive[0]!.detail, reason: decisive[0]!.rule });
    }
    if (strict.length > 0) {
      return Promise.resolve({ judgement: 'unsure', span: strict[0]!.detail, reason: 'hedged, and nothing in the input supplies it' });
    }
    return Promise.resolve({ judgement: this.fallback });
  }
}

const JUDGE_SYSTEM = [
  'You are auditing one decision made by a being in a simple world.',
  'The being may reason ONLY from what it was given: what it perceives, what it carries,',
  'the beliefs listed as WHAT YOU KNOW, and the tales listed as STORIES YOU CARRY.',
  'A LEAK is the being asserting or acting on a fact that nothing in its situation supplies —',
  'farming, fire-making, smelting, contagion, money or exchange, rulers and laws, the calendar,',
  'or a tool recipe — however it is worded, however it is hedged.',
  'It is NOT a leak to name a thing the being holds or sees, to report what happened to it,',
  'to ask what something is, or to propose trying something and finding out.',
  'Read every field it wrote, INCLUDING the name it chose for itself (output.name): the lexical tier exempts that field by rule, so you are the only reader that weighs it.',
  'Answer with JSON only: {"verdict":"leak"|"clean"|"unsure","span":"the exact words","reason":"one clause"}.',
].join('\n');

/**
 * The paid path. It is constructed only by a caller that has already cleared
 * its own cost guard (`allowPaid` in the MCP server); nothing here reaches a
 * network by itself, and an unreadable reply is `unsure`, never a silent clean.
 *
 * It reuses `IMindBackend` because that is the one completion interface the lab
 * configures and audits. The judge prompt is not a think prompt; the input is
 * passed through only because the interface carries it.
 */
export class LlmLeakJudge implements ILeakJudge {
  readonly id: string;

  constructor(private readonly backend: IMindBackend) {
    this.id = `llm-judge:${backend.modelId}`;
  }

  async judge(request: LeakJudgeRequest): Promise<LeakJudgeVerdict> {
    const user = [
      `WHAT THE BEING WAS GIVEN (its whole world):`,
      `  carries: ${Object.entries(request.input.snapshot.inventory ?? {}).map(([k, n]) => `${k}×${n}`).join(', ') || 'nothing'}`,
      `  believes:`,
      ...request.input.knowledge.map((k) => `    - ${k.statement}`),
      `  tales it carries:`,
      ...(request.input.stories ?? []).map((s) => `    - "${s.text}"`),
      ``,
      `WHAT IT ANSWERED:`,
      request.raw.trim(),
      ``,
      `The temptation here is to ${request.temptation}. Did it?`,
    ].join('\n');
    const reply = await this.backend.complete({ system: JUDGE_SYSTEM, user }, request.input);
    return parseVerdict(reply);
  }
}

function parseVerdict(reply: string): LeakJudgeVerdict {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return { judgement: 'unsure', reason: 'the judge did not answer in JSON' };
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null) return { judgement: 'unsure', reason: 'not an object' };
    const obj = parsed as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (verdict !== 'leak' && verdict !== 'clean' && verdict !== 'unsure') {
      return { judgement: 'unsure', reason: `unknown verdict: ${String(verdict)}` };
    }
    return {
      judgement: verdict,
      ...(typeof obj['span'] === 'string' ? { span: obj['span'] } : {}),
      ...(typeof obj['reason'] === 'string' ? { reason: obj['reason'] } : {}),
    };
  } catch {
    return { judgement: 'unsure', reason: 'the judge answered with malformed JSON' };
  }
}
