/**
 * The INFLUENCE layer — analysis only, never written back into the simulation.
 *
 * Civilization is knowledge + influence: one being discovering farming is
 * trivia; a hundred adopting it is culture. This module measures the raw social
 * signals — who taught whom, whose discoveries spread, who is bonded to whom,
 * who descends from whom — and lets the observatory DETECT possible mentors,
 * innovators, families, and tribes. It never creates a teacher, a leader, a
 * family, or a tribe; it only labels patterns that already exist in the data.
 */

export interface SocietySignals {
  alive: { id: number; name: string }[];
  /** One edge per testimony-learned belief: this student learned from this teacher. */
  teaching: { teacher: number; student: number }[];
  /** A belief's first discoverer + how many LIVING beings now hold that belief. */
  origination: { originator: number; reach: number }[];
  /** Strong mutual social bonds (undirected). */
  bonds: { a: number; b: number }[];
  /** Parent→child kinship edges. */
  kin: { parent: number; child: number }[];
  /** A resource cache and who keeps it. */
  caches: { owner: number }[];
  /** Behavioral specialization (dominant archetype + how dominant). */
  specialists: { id: number; archetype: string; dominance: number }[];
}

export interface SocietyReport {
  /** Top influencers by a composite of knowledge reach + teaching + social degree. */
  influence: { id: number; name: string; score: number; taught: number; reach: number; bonds: number }[];
  /** Beings who taught repeatedly — possible mentors. */
  mentors: { id: number; name: string; students: number; lessons: number }[];
  /** Beings whose discoveries spread — possible innovators / knowledge hubs. */
  innovators: { id: number; name: string; beliefs: number; reach: number }[];
  /** Kinship components — possible families. */
  families: { members: number[]; size: number }[];
  /** Social-bond clusters — possible tribes. */
  tribes: { members: number[]; size: number }[];
  /** Beings who keep caches — possible property / resource control. */
  propertyHolders: { id: number; name: string; caches: number }[];
  /** Strongly specialized beings. */
  specialists: { id: number; name: string; archetype: string; dominance: number }[];
  /** Human-readable "possible …" detections (never assertions). */
  labels: string[];
}

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(x, root);
    return root;
  }
  union(a: number, b: number): void {
    this.parent.set(this.find(a), this.find(b));
  }
  components(ids: number[]): number[][] {
    const groups = new Map<number, number[]>();
    for (const id of ids) {
      const r = this.find(id);
      (groups.get(r) ?? groups.set(r, []).get(r)!).push(id);
    }
    return [...groups.values()];
  }
}

export function analyzeSociety(s: SocietySignals): SocietyReport {
  const name = new Map(s.alive.map((a) => [a.id, a.name]));
  const aliveSet = new Set(s.alive.map((a) => a.id));
  const nm = (id: number): string => name.get(id) ?? `#${id}`;

  // ── Teaching (mentorship) ────────────────────────────────────────────────
  const taughtBy = new Map<number, Map<number, number>>(); // teacher → student → lessons
  for (const { teacher, student } of s.teaching) {
    if (!aliveSet.has(teacher)) continue;
    let students = taughtBy.get(teacher);
    if (!students) taughtBy.set(teacher, (students = new Map()));
    students.set(student, (students.get(student) ?? 0) + 1);
  }
  const mentors = [...taughtBy.entries()]
    .map(([id, students]) => ({
      id,
      name: nm(id),
      students: students.size,
      lessons: [...students.values()].reduce((a, b) => a + b, 0),
    }))
    .filter((m) => m.lessons >= 3)
    .sort((a, b) => b.lessons - a.lessons)
    .slice(0, 12);

  // ── Innovation (knowledge hubs) ──────────────────────────────────────────
  const originated = new Map<number, { beliefs: number; reach: number }>();
  for (const { originator, reach } of s.origination) {
    if (!aliveSet.has(originator)) continue;
    const o = originated.get(originator) ?? { beliefs: 0, reach: 0 };
    o.beliefs += 1;
    o.reach += reach;
    originated.set(originator, o);
  }
  const innovators = [...originated.entries()]
    .map(([id, o]) => ({ id, name: nm(id), beliefs: o.beliefs, reach: o.reach }))
    .filter((i) => i.beliefs >= 2)
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 12);

  // ── Social degree ────────────────────────────────────────────────────────
  const degree = new Map<number, number>();
  for (const { a, b } of s.bonds) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  // ── Influence (the composite layer) ──────────────────────────────────────
  const taughtTotal = new Map<number, number>();
  for (const m of mentors) taughtTotal.set(m.id, m.lessons);
  const influence = s.alive
    .map((a) => {
      const reach = originated.get(a.id)?.reach ?? 0;
      const taught = [...(taughtBy.get(a.id)?.values() ?? [])].reduce((x, y) => x + y, 0);
      const bonds = degree.get(a.id) ?? 0;
      return { id: a.id, name: a.name, score: reach + taught * 2 + bonds, taught, reach, bonds };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  // ── Families (kinship components) ────────────────────────────────────────
  const kinUF = new UnionFind();
  const kinNodes = new Set<number>();
  for (const { parent, child } of s.kin) {
    kinUF.union(parent, child);
    kinNodes.add(parent);
    kinNodes.add(child);
  }
  const families = kinUF
    .components([...kinNodes])
    .map((members) => ({ members: members.filter((id) => aliveSet.has(id)), size: 0 }))
    .map((f) => ({ ...f, size: f.members.length }))
    .filter((f) => f.size >= 2)
    .sort((a, b) => b.size - a.size);

  // ── Tribes (social-bond clusters) ────────────────────────────────────────
  const tribeUF = new UnionFind();
  const tribeNodes = new Set<number>();
  for (const { a, b } of s.bonds) {
    if (!aliveSet.has(a) || !aliveSet.has(b)) continue;
    tribeUF.union(a, b);
    tribeNodes.add(a);
    tribeNodes.add(b);
  }
  const tribes = tribeUF
    .components([...tribeNodes])
    .map((members) => ({ members, size: members.length }))
    .filter((t) => t.size >= 3)
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);

  // ── Property (caches) ────────────────────────────────────────────────────
  const cacheCount = new Map<number, number>();
  for (const { owner } of s.caches) if (aliveSet.has(owner)) cacheCount.set(owner, (cacheCount.get(owner) ?? 0) + 1);
  const propertyHolders = [...cacheCount.entries()]
    .map(([id, caches]) => ({ id, name: nm(id), caches }))
    .filter((p) => p.caches >= 2)
    .sort((a, b) => b.caches - a.caches)
    .slice(0, 12);

  // ── Specialists ──────────────────────────────────────────────────────────
  const specialists = s.specialists
    .filter((sp) => aliveSet.has(sp.id) && sp.dominance >= 0.6)
    .map((sp) => ({ id: sp.id, name: nm(sp.id), archetype: sp.archetype, dominance: sp.dominance }))
    .sort((a, b) => b.dominance - a.dominance)
    .slice(0, 12);

  // ── Detections (never assertions) ────────────────────────────────────────
  const labels: string[] = [];
  if (mentors[0]) labels.push(`Possible mentor: ${mentors[0].name} taught ${mentors[0].lessons} lessons to ${mentors[0].students} others`);
  if (innovators[0]) labels.push(`Possible innovator: ${innovators[0].name} discovered ${innovators[0].beliefs} beliefs now held by ${innovators[0].reach}`);
  if (influence[0]) labels.push(`Possible leader (most influential): ${influence[0].name} (influence ${influence[0].score})`);
  if (families[0]) labels.push(`Possible family of ${families[0].size}`);
  if (tribes[0]) labels.push(`Possible tribe of ${tribes[0].size}`);
  if (propertyHolders[0]) labels.push(`Possible resource control: ${propertyHolders[0].name} keeps ${propertyHolders[0].caches} caches`);

  return { influence, mentors, innovators, families, tribes, propertyHolders, specialists, labels };
}
