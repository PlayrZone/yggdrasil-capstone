// @yggdrasil/db — the research store. Engine-agnostic: it records plain rows
// and answers SQL. Hosts (mcp, lab) wire an Experiment's output into it.
export { ResearchDB } from './ResearchDB.js';
export type {
  RunConfig,
  RunSummary,
  MetricsRow,
  EventRow,
  KnowledgeRow,
} from './ResearchDB.js';
export { SCHEMA } from './schema.js';
export { DEFAULT_QUERY_TIMEOUT_MS, QueryTimeoutError, strandedQueryWorkers } from './boundedQuery.js';
