/**
 * Myth formation — the analysis of how stories DISTORT as they spread. A
 * narrative keeps its stable id (the event it's about) but its TEXT drifts from
 * teller to teller. This measures how many versions a story has fractured into,
 * which events have become hero-tales or villain-tales, and whether different
 * tribes now tell different versions of the same event. Analysis only.
 */

export interface MythReport {
  totalStories: number;
  /** Stories that exist in more than one version — they have drifted. */
  driftedStories: number;
  driftRate: number;
  /** The most-fractured story + a few of the versions it has become. */
  mostVaried: { id: number; variants: number; examples: string[] } | null;
  /** Beings whose deeds (slaying, home-raising) are widely retold. */
  heroes: { name: string; mentions: number }[];
  /** Beings whose attacks on others are widely retold. */
  villains: { name: string; mentions: number }[];
  /** One event two tribes remember differently — same id, different words. */
  tribeVersions: { versions: { tribeSize: number; text: string }[] } | null;
  labels: string[];
}

interface NarrativeRef {
  id: string;
  text: string;
}

function protagonist(id: string): { kind: string; actor: number } | null {
  const [kind, actor] = id.split(':');
  if (!kind || actor === undefined) return null;
  return { kind, actor: Number(actor) };
}

export function analyzeMyth(
  narratives: Map<number, NarrativeRef[]>,
  tribes: { members: number[]; size: number }[],
  names: Map<number, string>,
): MythReport {
  // id → (text → holders)
  const byId = new Map<string, Map<string, number>>();
  for (const ns of narratives.values()) {
    for (const n of ns) {
      let variants = byId.get(n.id);
      if (!variants) byId.set(n.id, (variants = new Map()));
      variants.set(n.text, (variants.get(n.text) ?? 0) + 1);
    }
  }

  const totalStories = byId.size;
  let driftedStories = 0;
  let mostVaried: MythReport['mostVaried'] = null;
  for (const [id, variants] of byId) {
    if (variants.size > 1) driftedStories++;
    if (!mostVaried || variants.size > mostVaried.variants) {
      const examples = [...variants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
      mostVaried = { id: 0, variants: variants.size, examples };
    }
  }

  // Heroes (slew/home) and villains (attack), by total retellings of their deeds.
  const heroScore = new Map<number, number>();
  const villainScore = new Map<number, number>();
  for (const [id, variants] of byId) {
    const p = protagonist(id);
    if (!p) continue;
    const holders = [...variants.values()].reduce((a, b) => a + b, 0);
    if (p.kind === 'slew' || p.kind === 'home') heroScore.set(p.actor, (heroScore.get(p.actor) ?? 0) + holders);
    else if (p.kind === 'attack') villainScore.set(p.actor, (villainScore.get(p.actor) ?? 0) + holders);
  }
  const rank = (m: Map<number, number>): { name: string; mentions: number }[] =>
    [...m.entries()]
      .map(([id, mentions]) => ({ name: names.get(id) ?? `#${id}`, mentions }))
      .filter((x) => x.mentions >= 4)
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 8);
  const heroes = rank(heroScore);
  const villains = rank(villainScore);

  // Different tribes telling the same event differently.
  let tribeVersions: MythReport['tribeVersions'] = null;
  for (const [id, variants] of [...byId.entries()].sort((a, b) => b[1].size - a[1].size)) {
    if (variants.size < 2) break;
    const versions: { tribeSize: number; text: string }[] = [];
    for (const t of tribes) {
      const local = new Map<string, number>();
      for (const member of t.members) {
        const n = narratives.get(member)?.find((x) => x.id === id);
        if (n) local.set(n.text, (local.get(n.text) ?? 0) + 1);
      }
      if (local.size === 0) continue;
      const dominant = [...local.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      versions.push({ tribeSize: t.size, text: dominant });
    }
    const distinct = new Set(versions.map((v) => v.text));
    if (distinct.size >= 2) {
      tribeVersions = { versions: versions.slice(0, 4) };
      break;
    }
  }

  const driftRate = totalStories ? Math.round((driftedStories / totalStories) * 100) / 100 : 0;
  const labels: string[] = [];
  if (driftedStories > 0) labels.push(`Stories drift: ${driftedStories}/${totalStories} have fractured into multiple versions (${Math.round(driftRate * 100)}%)`);
  if (mostVaried && mostVaried.variants > 1) labels.push(`A myth in the making: one event is now told ${mostVaried.variants} different ways`);
  if (heroes[0]) labels.push(`A hero emerges: ${heroes[0].name}'s deeds are retold ${heroes[0].mentions} times`);
  if (villains[0]) labels.push(`A villain emerges: ${villains[0].name} is remembered for attacks (${villains[0].mentions})`);
  if (tribeVersions) labels.push(`Tribes disagree: the same event is remembered differently by different tribes`);

  return { totalStories, driftedStories, driftRate, mostVaried, heroes, villains, tribeVersions, labels };
}
