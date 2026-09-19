import { actionVocabulary, argumentShapes } from '../contract/actions.js';
import type { WorldAdapter } from '../contract/adapter.js';
import type { DriveLevels } from '../contract/ids.js';
import type { PlaceRef } from '../contract/space.js';
import type { KnowledgeRecord, ThinkInput } from '../contract/types.js';
import { narrativeRefOf } from '../narrative/NarrativeStore.js';

/**
 * Builds the consciousness prompt. The LLM is a pure reasoner: it receives
 * the agent's needs, perception, goals, and — critically — its KNOWLEDGE,
 * rendered with confidence qualifiers, and must reason only from what the
 * agent actually knows. It is never handed world truths it didn't learn
 * (the V2 knowledge-fidelity discipline; the Y4 eval gate enforces it).
 *
 * Output is plain strings so any backend (Fireworks, Ollama, a mock) can
 * adapt them to its own chat format.
 */
export interface ThinkPrompt {
  system: string;
  user: string;
}

/**
 * The prompt for a RETRY — the base prompt plus the reason the last reply was
 * rejected. It lives here, not in a backend, because a record must be able to
 * say exactly which messages produced each completion: a backend that composed
 * its own retry text would leave the accepted completion paired with a prompt
 * that never produced it. Every backend must send this and nothing else.
 */
export function retryPrompt(base: ThinkPrompt, retryError: string | undefined): ThinkPrompt {
  if (!retryError) return base;
  return {
    system: base.system,
    user: `${base.user}\n\nYour previous reply was rejected: ${retryError}. Reply with valid JSON only.`,
  };
}

/**
 * `world` says what can be DONE here: the verb list below is the adapter's own
 * `actions` in its own order, and the argument paragraph under it is those
 * acts' own `params` — so a second world offers its own verbs with its own
 * shapes, and this file holds neither (W1-B3, and its verifier's backlog 2).
 * What remains of this world in here is PROSE — the needs paragraph, "it is
 * night" — and that is B5's, which renders it from the lexicon. Every step is
 * byte-for-byte: `record.test.ts` replays stored inputs through this function
 * and compares the bytes.
 */
export function buildThinkPrompt(input: ThinkInput, world: WorldAdapter): ThinkPrompt {
  const { snapshot, knowledge, recalledMemories, worldView, goals, trigger } = input;
  const t = snapshot.traits;
  const needs = snapshot.needs;
  const intentVocab = actionVocabulary(world);
  const argShapes = argumentShapes(world);
  // The header quotes one pair of thresholds for all the drives, which is what
  // this world's four share. B5 renders the paragraph per drive from the
  // lexicon; until then the first drive's numbers are the ones it always was.
  const pressing = world.drives[0]?.pressingAt ?? 0;
  const critical = world.drives[0]?.criticalAt ?? 0;

  const unnamed = !snapshot.name || snapshot.name.length === 0;
  const system = [
    unnamed
      ? `You are a young being who has no name yet. You live in a simple world, among others who were here before you.`
      : `You are the mind of ${snapshot.name}, a being living in a simple world, among others.`,
    `You were born into a people who already have kin, companions, and stories they tell. You did`,
    `not make this world or these stories; you are finding your place in them.`,
    `You do not control movement step by step — you decide goals, plans, and what to say.`,
    `You reason ONLY from what you perceive and what you KNOW — your memories, the STORIES you carry,`,
    `and the people you know, all given below. You have no knowledge of the world beyond this.`,
    `Do not invent facts. The meaning you find in a story or a person is YOURS to decide — no one`,
    `assigns roles here; if a being matters to you, that is something you choose.`,
    ``,
    `Your personality (0-100): curiosity ${t.curiosity}, aggression ${t.aggression},`,
    `compassion ${t.compassion}, ambition ${t.ambition}, loyalty ${t.loyalty}, risk ${t.riskTolerance}.`,
    ``,
    unnamed
      ? `You have no name. Choose one for YOURSELF that fits who you are, and include it as "name":string in your JSON (just this once).`
      : ``,
    `Respond ONLY with JSON of this exact shape:`,
    `{${unnamed ? '"name":string,' : ''}"thought":string,"goals":[{"description":string,"need":string|null}],`,
    ` "plan":[{"kind":INTENT,...args}],`,
    ` "utterances":[{"targetId":number|null,"speechAct":"share-knowledge"|"share-episode"|"inform"|"request","text"?:string,"ruleRef"?:number,"narrativeRef"?:string}]}`,
    `"thought" is a short first-person sentence: what you are thinking and WHY you choose this —`,
    `including what you make of any story or person that matters to you now. Speak as yourself.`,
    `INTENT kind is one of: ${intentVocab}.`,
    // The shapes are the world's, like the verbs above them: what each act
    // takes is `ActionBinding.params`, and the prose a param list cannot hold —
    // which acts are described, in what order, where the lines break — is
    // declared beside them (W1-B3 verifier, backlog 2). A world that describes
    // none says nothing here rather than being handed another world's.
    ...(argShapes.length === 0 ? [] : [`Intent args: ${argShapes[0]!}`, ...argShapes.slice(1)]),
    `To ASK someone something — to seek what they know — use a "request" utterance addressed to them.`,
    `To TEACH, use "share-knowledge" with "ruleRef" set to the [number] of one thing from WHAT YOU KNOW;`,
    `to RETELL a tale, use "share-episode" with "narrativeRef" set to the (ref …) of one story you carry.`,
    `You can only pass on what you yourself know and carry — say it in your own words in "text".`,
    `Keep the plan short (1-4 intents). The world validates every intent; impossible ones fail.`,
  ].join('\n');

  const user = [
    `Why you are thinking now: ${trigger}.`,
    ``,
    `NEEDS (0 satisfied, 100 desperate — ${pressing}+ pressing, ${critical}+ critical):`,
    `  ${pressuresText(world, needs)}`,
    `HEALTH ${fmt(snapshot.health)}${snapshot.sick ? ' (SICK)' : ''}. It is ${worldView.season}, ${worldView.night ? 'night' : 'day'}.`,
    `INVENTORY: ${inventoryText(snapshot.inventory)}`,
    ``,
    `WHAT YOU KNOW:`,
    knowledgeText(knowledge),
    ``,
    `YOUR FAMILY:`,
    kinText(input.kin),
    ``,
    `THOSE YOU KNOW (how you feel about them):`,
    socialText(input.social),
    ``,
    input.mostTold
      ? `THE TALE YOUR PEOPLE TELL MOST (you have heard it many times): "${input.mostTold}"\n  What this tale MEANS to you is yours alone to decide.`
      : ``,
    `STORIES YOU CARRY (the tales your people tell — some you saw, some you were told):`,
    storiesText(input.stories),
    placeText(world, input.sacredPlace, snapshot.place),
    ``,
    `WHAT YOU SEE (within range):`,
    perceptionText(worldView),
    ``,
    `RECENT MEMORIES:`,
    recalledMemories.length > 0
      ? recalledMemories.slice(0, 8).map((m) => `  - ${m.summaryText}`).join('\n')
      : '  (nothing notable)',
    ``,
    `CURRENT GOALS: ${goals.length > 0 ? goals.map((g) => g.description).join('; ') : '(none)'}`,
    ``,
    `Some of what you carry you were TOLD but never saw, and some things you cannot explain.`,
    `If no need presses you, you are free to pursue what you wish to UNDERSTAND — ask someone who`,
    input.offerMaking === false
      ? `might know, seek out an elder, or go and find out for yourself. Or simply live. The choice is yours.`
      : `might know, seek out an elder, go and find out for yourself, or try making something from the materials you carry to discover what can be made. Or simply live. The choice is yours.`,
    ``,
    `Decide what to do. Respond with JSON only.`,
  ].join('\n');

  return { system, user };
}

function kinText(kin: ThinkInput['kin']): string {
  if (!kin || kin.length === 0) return '  (you know of no family)';
  const parents = kin.filter((k) => k.relation === 'parent').map((k) => k.name);
  const children = kin.filter((k) => k.relation === 'child').map((k) => k.name);
  const lines: string[] = [];
  if (parents.length) lines.push(`  those who bore you: ${parents.join(', ')}`);
  if (children.length) lines.push(`  your children: ${children.join(', ')}`);
  return lines.join('\n');
}

function socialText(social: ThinkInput['social']): string {
  if (!social || social.length === 0) return '  (you know no one well yet)';
  return social.slice(0, 8).map((p) => `  - ${p.name}: ${p.feeling}`).join('\n');
}

/**
 * A being's stories, each with the opaque handle it may name to retell one.
 * The narrative id itself is engine bookkeeping — it encodes an analysis label
 * and would betray a seeded tale as seeded — so only `narrativeRefOf` is ever
 * rendered.
 */
function storiesText(stories: ThinkInput['stories']): string {
  if (!stories || stories.length === 0) return '  (you carry no stories yet)';
  return stories
    .slice(0, 8)
    .map(
      (s) =>
        `  -${s.id ? ` (ref ${narrativeRefOf(s.id)})` : ''} "${s.text}"${s.firsthand ? ' (you were there)' : ' (you were told this)'}`,
    )
    .join('\n');
}

/**
 * A place a carried story pulls the being toward — rendered as a felt pull,
 * never "sacred".
 *
 * NOT ONE NUMBER OF IT IS THIS FILE'S ANY MORE (W1-B4). How far, which way, and
 * how a place is written down are three questions put to the world; the
 * SENTENCE around the answers is still prose, and that is B5's. The forager
 * continent answers them with the expressions that used to stand here, so these
 * bytes are the bytes they always were.
 */
function placeText(world: WorldAdapter, place: PlaceRef | undefined, self: PlaceRef | undefined): string {
  if (!place || !self) return '';
  const dist = Math.round(world.space.distance(self, place));
  const dir = world.space.direction(self, place);
  return `\nA place from the stories you carry pulls at you — it lies ${dir}, about ${dist} away (toward ${world.space.label(place)}). Whether you go, and what it means to you, is yours to decide.`;
}

function fmt(n: number): string {
  return n.toFixed(0);
}

/**
 * EVERY PRESSURE THIS WORLD DECLARES, in its declared order, each named as the
 * world names it.
 *
 * It used to be four drives typed out here and the snapshot indexed by them, so
 * a world with any other drives yielded `undefined` and `fmt` THREW — the
 * prompt could not be built at all (W1-B3 verifier, round 2, backlog 2). A
 * pressure the body reports nothing for now reads `?`: the drive exists here,
 * this being has no reading of it, and saying `0` would be claiming the one
 * thing the prompt does not know.
 */
function pressuresText(world: WorldAdapter, needs: DriveLevels): string {
  return world.drives
    .map((drive) => {
      const pressure = needs[drive.id];
      return `${drive.promptLabel ?? drive.id} ${typeof pressure === 'number' ? fmt(pressure) : '?'}`;
    })
    .join(', ');
}

function inventoryText(inv: ThinkInput['snapshot']['inventory']): string {
  const entries = Object.entries(inv).filter(([, n]) => (n ?? 0) > 0);
  return entries.length > 0 ? entries.map(([k, n]) => `${k}×${n}`).join(', ') : 'empty';
}

/**
 * Knowledge rendered with confidence qualifiers — the agent's worldview. Each
 * line carries its record id in brackets: that number is how a mind names
 * WHICH of its beliefs it is teaching (`ruleRef`), the only content reference
 * it is allowed to make.
 */
export function knowledgeText(knowledge: KnowledgeRecord[]): string {
  const held = knowledge.filter((k) => k.status === 'held').slice(0, 12);
  if (held.length === 0) return '  (you have learned nothing yet)';
  return held
    .map((k) => {
      const qualifier =
        k.confidence >= 0.85
          ? 'You are sure'
          : k.confidence >= 0.6
            ? 'You believe'
            : 'You suspect';
      const provenance = k.origin === 'testimony' ? ' (you were told this)' : '';
      return `  - [${k.id}] ${qualifier} (${(k.confidence * 100).toFixed(0)}%, seen ${k.evidenceCount}×): ${k.statement}${provenance}`;
    })
    .join('\n');
}

function perceptionText(view: ThinkInput['worldView']): string {
  const parts: string[] = [];
  if (view.resources.length > 0) {
    const counts = new Map<string, number>();
    for (const r of view.resources) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    parts.push('  resources: ' + [...counts].map(([k, n]) => `${n} ${k}`).join(', '));
  }
  if (view.agents.length > 0) parts.push(`  ${view.agents.length} other being(s) nearby (ids: ${view.agents.slice(0, 6).map((a) => a.id).join(', ')})`);
  if (view.structures.length > 0) {
    const counts = new Map<string, number>();
    for (const s of view.structures) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    parts.push('  structures: ' + [...counts].map(([k, n]) => `${n} ${k}`).join(', '));
  }
  return parts.length > 0 ? parts.join('\n') : '  (nothing of note within range)';
}
