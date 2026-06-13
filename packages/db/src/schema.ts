/**
 * The research database schema. Every experiment is a permanent record:
 * its seed and config (so it's reproducible), a time-series of population +
 * knowledge metrics, a sampled event stream, knowledge snapshots, and an
 * append-only action log (every mutation an MCP client performs is recorded
 * — the lab is auditable). SQLite keeps a run self-contained and queryable.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seed         TEXT    NOT NULL,
  agent_count  INTEGER NOT NULL,
  backend      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'running',  -- running | finished | aborted
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  ticks        INTEGER NOT NULL DEFAULT 0,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS metrics (
  run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tick            INTEGER NOT NULL,
  day             INTEGER NOT NULL,
  alive           INTEGER NOT NULL,
  total_knowledge INTEGER NOT NULL,
  exchanges       INTEGER NOT NULL,
  conflicts       INTEGER NOT NULL,
  sickness        INTEGER NOT NULL,
  shares          INTEGER NOT NULL,
  seed_plants     INTEGER NOT NULL,
  sprouts         INTEGER NOT NULL,
  builds          INTEGER NOT NULL,
  PRIMARY KEY (run_id, tick)
);

CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tick     INTEGER NOT NULL,
  type     TEXT    NOT NULL,
  actor    INTEGER,
  payload  TEXT  -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, tick);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(run_id, type);

CREATE TABLE IF NOT EXISTS knowledge_snapshots (
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tick       INTEGER NOT NULL,
  agent_id   INTEGER NOT NULL,
  rule_key   TEXT    NOT NULL,
  status     TEXT    NOT NULL,
  confidence REAL    NOT NULL,
  PRIMARY KEY (run_id, tick, agent_id, rule_key)
);
CREATE INDEX IF NOT EXISTS idx_know_run ON knowledge_snapshots(run_id, tick);

-- Append-only audit log: every mutating action any client (incl. MCP) performs.
CREATE TABLE IF NOT EXISTS actions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  at      INTEGER NOT NULL,
  actor   TEXT    NOT NULL,  -- e.g. 'mcp', 'lab', 'cli'
  action  TEXT    NOT NULL,
  detail  TEXT  -- JSON
);
CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id);
`;
