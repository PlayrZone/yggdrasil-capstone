import type { KnowledgeRule } from '../contract/types.js';

/**
 * Statements are TEMPLATED from rule structure — never free-generated
 * (V2 decision: machine comparability and auditability beat prose).
 * These strings appear in consciousness prompts and the Observatory.
 */

const EVENT_PHRASE: Record<string, string> = {
  GatherSucceeded: 'gathering succeeds',
  GatherFailed: 'gathering fails',
  AteFood: 'eating',
  DrankWater: 'drinking',
  BecameSick: 'becoming sick',
  SufferedExposure: 'suffering from exposure',
  SleptSafely: 'sleeping safely',
  SleptExposed: 'sleeping in the open',
  WasAttacked: 'being attacked',
  AgentDied: 'death',
  WitnessedDeath: 'a death',
  SeedDeposited: 'putting a seed in the ground',
  PlantSprouted: 'a plant appearing',
  FoundResource: 'finding resources',
  BuiltStructure: 'building',
};

const FEATURE_PHRASE: Record<string, string> = {
  nearWater: 'near water',
  night: 'at night',
  inShelter: 'in shelter',
  highland: 'in the highlands',
};

function phrase(type: string, objectKind?: string): string {
  const base = EVENT_PHRASE[type] ?? type;
  return objectKind ? `${base} (${objectKind})` : base;
}

export function renderStatement(rule: KnowledgeRule): string {
  switch (rule.kind) {
    case 'context-association':
      return rule.direction === 'positive'
        ? `${capitalize(phrase(rule.event, rule.objectKind))} happens mostly ${FEATURE_PHRASE[rule.feature]}`
        : `${capitalize(phrase(rule.event, rule.objectKind))} rarely happens ${FEATURE_PHRASE[rule.feature]}`;
    case 'succession':
      return `${capitalize(phrase(rule.causeType, rule.causeObject))} is followed by ${phrase(
        rule.effectType,
        rule.effectObject,
      )}`;
    case 'social-contingency': {
      switch (rule.pattern) {
        case 'reciprocates':
          return `Agent #${rule.partnerId} gives back when given to`;
        case 'generous':
          return `Agent #${rule.partnerId} is generous`;
        case 'dangerous':
          return `Agent #${rule.partnerId} is dangerous`;
        case 'helpful':
          return `Agent #${rule.partnerId} is helpful`;
      }
      break;
    }
    case 'outcome-association': {
      const where = rule.feature ? ` ${FEATURE_PHRASE[rule.feature]}` : '';
      const effect = rule.direction === 'relieves' ? 'eases' : 'worsens';
      return `${capitalize(phrase(rule.actionType))}${where} ${effect} ${rule.need}`;
    }
    case 'craft-recipe': {
      const parts = Object.entries(rule.inputs).map(([k, n]) => (n && n > 1 ? `${n} ${k}` : k));
      const mats = parts.length ? parts.join(' and ') : 'the right materials';
      return `A ${rule.output} can be made by working ${mats} together`;
    }
  }
  return '';
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
