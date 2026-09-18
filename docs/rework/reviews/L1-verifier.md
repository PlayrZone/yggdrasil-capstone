PASS (Round 2)

# L1 — hostile verification of the security/integrity fixes

Round 1: FAIL — five defects, one a renderer-reachable kill switch on the Electron main process.
Round 2: PASS (see below) — all six re-verified fixed; nits only.

## Defects

**1. HIGH — TypedArray in `llm:complete` → main-process OOM.** `lab/src/main/ipcGuards.ts:122` (+ `isPlainObject`
`:40`), from `lab/src/main/index.ts:190`. A `Uint8Array`/`Buffer` survives structured-clone IPC, passes
`isPlainObject`, and reaches `Object.entries(v)`, which eagerly materialises one `[string, number]` pair **per
element** before any `bytes > budget` short-circuit can fire. *In:* `window.lab.llmComplete({...valid, junk: new
Uint8Array(N)})`. *Obs:* in the real booted app N=1e6 → **275 ms** main stall vs **2 ms** control; locally N=4e6 →
687 ms / 956 MB RSS, N=64e6 → `FATAL ERROR: Reached heap limit`, process dies (~150–230× amplification). Also
reachable as `snapshot.traits`. *Exp:* reject `ArrayBuffer.isView` / non-plain prototypes before walking. Compounding:
validation runs at `index.ts:191` **before** `llmRate.tryTake()` at `:192` — take the limit first.
**2. MEDIUM — `query_db` hangs the MCP server forever.** `db/src/ResearchDB.ts:272` (`stmt.all()`), via
`mcp/src/index.ts:459`. *In:* `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) n FROM c`.
*Obs:* subprocess **exit 124** after 25 s on *both* a file DB and `:memory:` — no output, flat memory, pure CPU in a
synchronous native call on the only thread; the server never answers again and must be killed externally. A 10-way
`sqlite_master` cross join does the same; `…WHERE x<50000000) SELECT x FROM c` instead OOMs at 900 MB in 3.3 s. *Exp:*
`node:sqlite` exposes no progress handler, so run `readonlyQuery` on a worker thread with a wall-clock kill; a wrapping
`LIMIT n` caps the rows but not the `count(*)` hang.
**3. MEDIUM — activity tail buffers the whole file *before* applying `MAX_PENDING_CHARS`.**
`home/src/activity.ts:217-224` concatenate every chunk into `pending`; the 4 MB cap sits at `:233`, after the loop,
though `:38` claims "drop it rather than buffer forever". *In:* 48 MB appended with no newline, then one `drain()`.
*Obs:* heap 5 → **102 MB**, RSS 33 → **135 MB** in one poll (≈2× file size). *Exp:* test the cap inside the read loop.
Reachable: `tailActivity` runs in main from startup (`index.ts:232`) while `rotateIfLarge` only fires from *our*
`appendActivity`, so a foreign or crashed writer is unbounded.
**4. MEDIUM — plaintext-key migration silently no-ops; `keyAtRest()` then lies.** `lab/src/main/settings.ts:63` →
`:109`/`:180`: `loadSettings` drops `fireworksKey` above 512 chars, so migration never sees it. *In:* `settings.json`
= `{"fireworksKey":"fw_"+"k".repeat(600)}`, encryption available. *Obs:* `migrateKeyAtRest()`→`false`, **plaintext
still on disk**, `keyAtRest()`→`'none'` — the UI reports no key at rest while a cleartext secret sits there
permanently. *Exp:* read the legacy field unbounded *in order to erase it*, and report `'plaintext'` whenever present.
**5. MEDIUM — Windows case-insensitivity: two accepted slugs, one file.** `home/src/reports.ts:28`/`:55` — `SLUG_RE`
is case-sensitive, NTFS is not. *In:* `writeReport('Alpha','ALPHA-BODY','you','Alpha')` then
`writeReport('alpha','…','attacker','alpha')`. *Obs:* `readReport('Alpha').body` is the attacker's, `readdir` shows
only `Alpha.md`, `listReports()` advertises `Alpha` for content written as `alpha`. *Exp:* case-fold or refuse a
cross-case collision — reports are the shared human↔AI channel, so MCP `write_report` can destroy the human's file
invisibly to both sides.

**Low.** `settings.ts:74-78` — `mode: 0o600`/`chmodSync` are no-ops on Windows, observed **0o666**. `settings.ts:122`
— the char class holds raw U+0000 / U+001F / U+007F bytes at offsets 4052/4054 (same in `lab/test/settings.test.ts`);
git and grep classify both as **binary**, so the API-key module and its tests cannot be reviewed as a diff — write
them as backslash-u escapes. `ipcGuards.ts:77` — the estimate counts UTF-16 units, so astral text under-counts
**2.00×** (838,939 vs 1,674,484 real UTF-8), making the 512 KB cap ~1 MB. `settings.ts:38/147` — `warnedPlaintext` is
a one-shot; the warning is logged once per process.

## Attacks that held
**Slugs.** Rejected `..`, `../x`, `..\x`, `a/b`, `a\b`, `C:x`, ADS (`a::$DATA`, `x.md:evil`), 8.3, UNC and `\\?\`,
`CONIN$`, leading dot, trailing space, embedded NUL/newline, `İ`, 81+ chars. `reportPath` is genuinely the only path
builder in home/lab/mcp (corpus + activity use fixed names; `getEvents` interpolates literal clauses only).
`CON`/`NUL`/`AUX`/`PRN`/`COM1` pass `isSafeSlug`, but the mandatory `.md` suffix lands a **real file** on Win11 26200
(verified, incl. bare `CON`) — incidental, not a hole. Header forgery collapses CRLF; `slugify` is always safe.
**API key.** Migration erases plaintext; corrupt/oversized/non-base64 `fireworksKeyEnc` degrades to `'none'` without
throwing; `encryptString` throwing fails **closed**. No IPC reply carries the key or a prefix;
`FireworksMindBackend.ts:72` errors carry status+body, never the `Authorization` header. Fake keys + temp `YGG_HOME`
only; the real `.env`/settings were never read.
**`llm:complete`.** Cycles caught (diamonds allowed), depth-24 DAG bomb, sparse `Array(1e9)`, `NaN`/`Infinity`,
over-cap arrays, size smuggled through unknown keys, `Map(16384)`, `__proto__` — all rejected. Limiter exact at the
boundary, slides, immune to a backwards clock, bounded, env override main-only; default 600/60 s = 36,000 paid
calls/hour, a breaker not a budget.
**Write gate** (file *and* `:memory:`). `WITH…INSERT/UPDATE/DELETE` blocked by SQLite itself, `INSERT…RETURNING`,
stacked `;`, `--`, `/* */`, `/*/**/`, NBSP/BOM/VT before the keyword, `ATTACH`, `PRAGMA`, `load_extension`,
`readfile`/`writefile`/`sqlite_dbpage`, `pragma_query_only(0)`, `pragma_writable_schema(1)`. `query_only` restored
after a *throwing* query; `actions.at` a real clock; legacy `at` still parses.
**Activity.** Partial last line, a line split across writes, a codepoint cut mid-sequence (`X😀é中Y` intact), malformed
JSON/arrays/wrong types, truncation, rotation (NTFS `ino` real), `recentActivity` reading only a 1 MB tail.
**Boot** — one launch, PID 49144, reflex, temp `YGG_HOME`, no key. `process`/`require`/`module`/`__dirname`/`Buffer`/
`global` all `undefined`; `window.lab` = 14 methods. World renders (canvas 1459×1020) and runs: Day 1→2, 0→663
knowledge, 39 builds, 4 deaths. Reports round-trip over real IPC; `readReport('../../settings')`→`null`, traversal +
absolute writes refused. `window.open('_blank')`→`null`; anchor `_blank` and form POST denied (1 window throughout);
`location.href` to an external URL left the URL unchanged and `.lab` mounted; `<webview>` unregistered. No page
errors. Shot: `~/.yggdrasil-lab/rework/shots/L1-boot.png`.
**Test quality.** Reverted three fixes; each caught, then restored byte-identically (sha256 `-c` OK, suites back to
46/36/15 green): (a) `readonlyQuery`→`this.db` without `query_only` ⇒ 2 failures incl. "a CTE write is blocked at
execution"; (b) `activity.ts:209` restart-on-truncate removed ⇒ 3 failures; (c) `reports.ts:66` CRLF strip removed ⇒
"cannot forge the header" failed. Real tests, not decorative.

Scope: `packages/engine` untouched, its suite never run. Tree left as found — no `_verify_*` files created;
`git status --short` identical but for the engine agent's own concurrent changes.

## Round 2 — re-attack of the fixes (PASS)

All six hold. One Electron launch (PID 51224), one MCP server under tsx (PID 61808); both killed by PID and
confirmed gone. No source edits, no scratch test files. Suites 50/48/18/7 green (`packages/engine` untouched).

**1. DoS — fixed.** `isPlainObject` (`ipcGuards.ts:46`) now requires `Object.prototype`/null proto, and the walk
flags anything else `exotic` in O(1). Node-side `validateThinkInput` cost: `Uint8Array(1e6)`, `Uint8Array(64e6)`,
`Float64Array(8e6)`, `ArrayBuffer(64e6)`, `DataView`, `Set(1e6)`, `Date`/`RegExp`/`Error` all **0.0 ms** rejected
"not plain JSON data"; `array 1e6 strings`, `array 1e7 numbers`, `Map(1e6)`, `sparse Array(1e9)`, nested arrays
1e5 deep, cycle — all **≤0.1 ms**. In the booted app the 64e6 view that killed main in Round 1 now returns an
error in 197 ms and the app keeps running; the residual is Electron's structured clone of 64 MB, paid
symmetrically by the renderer, not amplification. Deep nesting never reaches main at all — contextBridge
refuses it ("recursion depth exceeded"). Astral under-count gone: est/real ratio **1.00** (was 2.00).
Rate-token-first confirmed: 3 junk payloads exhaust a 3-token window and the 4th *valid* call is `RATE_LIMITED`.
Legitimate ThinkInput still passes through the real bridge — full 47-field payload, with and without
`retryError`, with and without the `relationships` Map, all seven triggers → `NO_LLM_KEY` (i.e. past
validation); world still runs in reflex (0→188 knowledge, canvas 1459×1020, no page errors).

**2. Bounded query — fixed, with an honest residual.** Runaway CTE returns `QueryTimeoutError` at the deadline
(506 ms at 500, 5002 ms at the 5 s default) and the next normal query succeeds (20 ms). Verified through the
**real MCP server under `tsx src/index.ts`** and from built `dist/` — the inlined worker resolves in both.
Writes still refused through the bounded path: CTE+INSERT/UPDATE/DELETE ("attempt to write a readonly
database"), stacked, leading comments, ATTACH, PRAGMA, `load_extension`, `pragma_query_only(0)`, NBSP prefix;
`:memory:` falls back to the sync path and still refuses. Cap works: after 2 strands the 3rd query is refused
in 0 ms. `unref` works — the process exited on its own (code 0) with 2 threads still spinning.
*Residual, measured:* `terminate()` never settles, so 2 stranded threads burn **4000 ms CPU per 2000 ms wall =
~200% of one core**, permanently, until the server restarts — and once capped, `query_db` is dead for the life
of the process (even valid queries). **My call: not acceptable as the end state on a shared machine.** Two
accidental runaways peg two cores and brick the tool with no way back. Use a child **process**
(`child_process.fork` with its own read-only connection): `SIGKILL` actually reclaims the CPU and the DB
handle, the cap becomes unnecessary, and a timeout stops being permanent. The thread version is a correct
stop-gap — the hang is gone and the server survives — but file the process swap rather than closing it.

**3. Tail — fixed.** 48 MB unterminated line: one poll **19 ms**, heap 20→26 MB, RSS 80→90 MB (Round 1:
5→102 MB / 33→135 MB). `absorb` checks the cap before every concatenation. Over-long line dropped and resynced:
`GOOD-1` and `GOOD-2` on either side of a 6 MB line both survive; a 12 MB line spread over 12 polls is dropped
and `GOOD-3` after it is recovered, heap flat at 19 MB. Multi-byte split (`X😀é中Y` intact) and partial last
line still work.

**4. Key — fixed.** Every legacy shape leaves the disk: normal and 600-char keys are re-encrypted
(`keyAtRest` 'plaintext'→'encrypted'); 5000-char, whitespace-bearing, control-char and non-ASCII values are
erased →'none'. In all six cases the cleartext is **gone from the file**. Nothing is destroyed when it is the
only copy: with encryption unavailable, `migrateKeyAtRest()` is a no-op and `keyAtRest()` honestly says
'plaintext'; when encryption returns it migrates. A >1 MB settings.json is refused. No IPC reply carries the
key or even a 4-char prefix. Fake keys and a temp `YGG_HOME` only — the real `.env`/settings were never read.

**5. Slug case — fixed.** `Alpha`/`alpha` now resolve to one file, `listReports()` shows `alpha` once, and
`writeReport` returns the canonical slug. Pre-fix mixed-case files on disk (`LegacyReport.md`, `MiXeD.md`) are
readable under either spelling, listed exactly once each under canonical slugs (3 files → 3 unique slugs), and
`meta.slug` round-trips into a write that edits the same file. Confirmed over real IPC too (`MiXeDCase` →
`mixedcase`, readable as `MIXEDCASE`). Traversal and absolute writes still refused; `window.open` → null,
navigation blocked, no Node in the renderer.

**6. Control bytes — fixed.** All eight touched sources and all seven test files scan clean (no byte <0x09,
0x0E–0x1F, or 0x7F); `git diff` on `ResearchDB.ts` is textual (112/12), `settings.ts` is no longer binary.
UTF-8 sizing via `Buffer.byteLength`.

### Nits (none blocking)
- `ipcGuards.ts:150` — `Object.keys()` is still eager, the one case over ~50 ms of main-process time:
  **178 ms** at 1e6 keys (10 ms at 1e5). No amplification — the renderer pays more to build and clone it — but
  `for...in` with a counter would let the budget short-circuit fire before the array is materialised.
- `ipcGuards.ts:154` — keys are charged `k.length` (UTF-16) while values use `Buffer.byteLength`; astral keys
  under-count 1.36×. Bounded by the 4-bytes-per-key charge, so not a bypass.
- `guardLlmComplete` taking the token first (deliberate, and right) means malformed payloads now consume the
  paid-call budget — a renderer bug can starve legitimate thinking. Consider a separate junk counter.
- `settings.ts:133` — an unusable legacy value is erased silently; a one-line log would tell the user why their
  saved key vanished.
- `reports.ts:108` — `listReports` canonicalises then re-resolves, which relies on a case-insensitive FS. On
  Linux/macOS a pre-existing `LegacyReport.md` would drop out of the listing. Windows-only today, but
  `@yggdrasil/home` is shared with the MCP server.
- Every `query_db` now pays ~18–21 ms of worker startup.
