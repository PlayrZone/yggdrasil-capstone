import type { KnowledgeRule } from '../contract/types.js';

/**
 * Canonical string key for a rule. Two agents hold "the same" belief iff
 * their rule keys are equal — this is what the Observatory's diffusion
 * analysis compares.
 */
export function ruleKey(rule: KnowledgeRule): string {
  switch (rule.kind) {
    case 'context-association':
      return `ctx:${rule.event}:${rule.objectKind ?? '*'}:${rule.feature}:${rule.direction}`;
    case 'succession':
      return `seq:${rule.causeType}:${rule.causeObject ?? '*'}>${rule.effectType}:${rule.effectObject ?? '*'}`;
    case 'social-contingency':
      return `soc:${rule.partnerId}:${rule.pattern}`;
    case 'outcome-association':
      return `out:${rule.actionType}:${rule.feature ?? '*'}:${rule.need}:${rule.direction}`;
    case 'craft-recipe':
      // Keyed by output only: "the spear recipe" is one belief however its
      // inputs are remembered, so demonstrations and tellings reinforce it.
      return `craft:${rule.output}`;
  }
}
