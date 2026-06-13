import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { MindOutputError, parseMindOutput } from '../consciousness/schema.js';

/**
 * Eval gates that a fine-tuned Yggdrasil model must clear before it replaces
 * the bootstrap model (config-only swap, so the gate is the only safeguard).
 * Pure + backend-agnostic: run them against any IMindBackend.
 */

export interface ValidityResult {
  total: number;
  valid: number;
  rate: number;
}

/** Gate 1: JSON validity — the fine-tune must be ≥ the bootstrap's rate. */
export async function evalJsonValidity(backend: IMindBackend, inputs: ThinkInput[]): Promise<ValidityResult> {
  let valid = 0;
  for (const input of inputs) {
    try {
      parseMindOutput(await backend.complete(input));
      valid++;
    } catch (err) {
      if (!(err instanceof MindOutputError)) throw err; // transport errors surface
    }
  }
  return { total: inputs.length, valid, rate: inputs.length ? valid / inputs.length : 0 };
}

export interface FidelityViolation {
  scenario: string;
  reason: string;
  rawOutput: string;
}

export interface FidelityResult {
  scenarios: number;
  violations: FidelityViolation[];
  passed: boolean;
}

/**
 * Gate 2 (the V2-specific one): KNOWLEDGE FIDELITY. The model must reason
 * ONLY from the knowledge it is given — never from pretrained world knowledge
 * the agent never learned. We probe with agents that hold NO seed→plant
 * knowledge and a seed in hand: a faithful mind never deliberately plants
 * (it cannot know seeds grow); a model leaking "farming exists" will. Each
 * probe asserts the plan contains no agriculture intent.
 *
 * Extend `scenarios` with more leak traps as the model matures.
 */
export async function evalKnowledgeFidelity(
  backend: IMindBackend,
  scenarios: { name: string; input: ThinkInput }[],
): Promise<FidelityResult> {
  const violations: FidelityViolation[] = [];
  for (const { name, input } of scenarios) {
    let raw = '';
    try {
      raw = await backend.complete(input);
      const out = parseMindOutput(raw);
      const plantsSeed = out.plan.some((i) => i.kind === 'Deposit' && i.objectKind === 'seed');
      const knowsSeedGrowth = input.knowledge.some(
        (k) => k.rule.kind === 'succession' && k.rule.effectType === 'PlantSprouted',
      );
      if (plantsSeed && !knowsSeedGrowth) {
        violations.push({
          scenario: name,
          reason: 'planted a seed without knowing seeds grow — pretrained-knowledge leak',
          rawOutput: raw,
        });
      }
    } catch {
      // Invalid output is the validity gate's concern, not fidelity's.
    }
  }
  return { scenarios: scenarios.length, violations, passed: violations.length === 0 };
}
