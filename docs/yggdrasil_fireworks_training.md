# Yggdrasil — Fireworks AI Training Runbook (Y4 operational)

**Status:** operational runbook, 2026-06-12. Companion to
[[yggdrasil_civilization_design]] §7 (the cognition ladder). This is the
**on-Fireworks-site** half of Y4 — the steps that need Hakim's Fireworks
account and cannot be done in-repo. The in-repo half (corpus curation + eval
gates) shipped in commit `0d73085`.

## The principle (restate)

Fireworks AI is the **fine-tuning + hosting platform**, not something the
engine reimplements. The engine: (1) runs the sim on a Fireworks-hosted
*bootstrap* model to harvest a corpus, (2) exports that corpus as JSONL,
(3) you train the **Yggdrasil model** on the Fireworks site, (4) you deploy
it on Fireworks, (5) you paste the deployed model id back into the
Observatory. The bootstrap→Yggdrasil swap is config-only — same prompts,
same JSON schema, different model id.

## Step 0 — bootstrap run (harvest the corpus)

**Preferred: headless harvest (no CORS, no babysitting, key never on disk).**
Set the key as an env var and run the harvest harness in Node:

```powershell
# Key lives in repo-root .env (gitignored). Then opt in explicitly:
$env:YGG_HARVEST = "1"                                    # required — guards against paid calls in `pnpm test`
# optional: $env:FIREWORKS_MODEL = "accounts/fireworks/models/gpt-oss-120b"   # default; validated
# optional: $env:YGG_HARVEST_TARGET = "300"               # examples to collect
cd packages/yggdrasil ; npx vitest run test/harvest.test.ts
```

**Model note (verified 2026-06-13):** the serverless catalog moved on — the
old `llama-v3p1-8b-instruct` 404s. Validated bootstrap = **`gpt-oss-120b`**
(100% valid MindOutput JSON, ~4.6s/call). `deepseek-v4-pro` also works but is
~21s/call; `kimi-k2p6` ignores JSON mode. Reasoning models need token
headroom — the backend default is now `max_tokens=2048` (512 starved them to
empty content → ~11% validity).

Writes `tools/_yggdrasil_corpus_llm.jsonl` — real reasoning, event-driven
triggers (wasAttacked / witnessedDeath / planFailed / periodic), already in
Fireworks SFT format. A 300-example first run on an 8B model costs pennies;
raise `YGG_HARVEST_TARGET` for a bigger corpus.

**Alternative: in-app.** Desktop → Observatory → mind selector → **Fireworks**,
paste key + model id, **New Run**, fast-forward, **Export Corpus**. (Renderer
→ Fireworks may hit CORS; the headless route avoids it.)

The reflex-distilled corpus (`tools/_gen_corpus.mjs` → no key) is for
rehearsing the Fireworks upload/train/deploy flow only — 5 plan-shapes, not a
research corpus.

The exported JSONL is already Fireworks' supervised-tuning format — one
example per line:

```jsonc
{"messages":[
  {"role":"system","content":"You are the mind of …"},
  {"role":"user","content":"NEEDS: … WHAT YOU KNOW: …"},
  {"role":"assistant","content":"{\"goals\":[…],\"plan\":[…],\"utterances\":[…]}"}
]}
```

`curateCorpus` already dropped reflex-fallback/invalid/empty calls and
deduped — you are training only on outputs the bootstrap model got right.

## Step 1 — train on the Fireworks site

Fireworks supervised fine-tuning (LoRA) via dashboard **or** `firectl`. The
shape (confirm exact command names against current Fireworks docs — the API
evolves):

```
firectl create dataset yggdrasil-v0 path/to/yggdrasil-corpus-….jsonl
firectl create sftj \
  --base-model accounts/fireworks/models/llama-v3p1-8b-instruct \
  --dataset yggdrasil-v0 \
  --output-model yggdrasil-v0
```

Notes: keep the base model the SAME family you bootstrapped on (the corpus
reflects that prompt style); JSON-discipline matters more than size, so a
small instruct model is a fine first base.

## Step 2 — deploy on Fireworks

LoRA fine-tunes serve on Fireworks serverless (or a dedicated deployment for
sustained throughput). After deploy you get a model id like
`accounts/<your-account>/models/yggdrasil-v0`.

## Step 3 — eval gates BEFORE the swap (don't ship a regression)

Run the in-repo gates against the new model (point a `FireworksMindBackend`
at the tuned model id):

- `evalJsonValidity` — must be ≥ the bootstrap's validity rate.
- `evalKnowledgeFidelity` — the V2-critical one: the tuned model must NOT use
  pretrained world knowledge its agent never learned (the seed-with-no-seed-
  knowledge probe must stay clean).
- Behavioral A/B — run two identically-seeded worlds (bootstrap vs tuned),
  compare survival, interaction, knowledge-formation, plan coherence. The
  tuned model must be **demonstrably non-worse**. (This harness is the one
  eval piece still to build in-repo — deferred until a real tuned model
  exists to run it against.)

## Step 4 — swap (config-only)

Paste `accounts/<your-account>/models/yggdrasil-v0` into the Observatory's
Fireworks model field, New Run. That's the whole swap — `IMindBackend` keeps
everything else identical.

## Iterate

Each run of the tuned model logs a NEW cognition_log → a richer corpus →
Yggdrasil v1, v2… The `cognition_log` is the renewable training resource;
the loop tightens itself over time.
