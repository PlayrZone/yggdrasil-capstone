// @yggdrasil/home — the shared lab home (~/.yggdrasil-lab, or YGG_HOME).
// One implementation of the paths, the activity feed, and the shared reports
// for both hosts. Node built-ins only: the Electron main process bundles this,
// so it must never reach for `node:sqlite` (that lives in @yggdrasil/db).
export { yggHome, dbPath, activityPath, reportsDir, corpusDir } from './paths.js';
export { appendActivity, parseActivityLine, recentActivity, tailActivity, MAX_ACTIVITY_BYTES, MAX_PENDING_CHARS } from './activity.js';
export type { ActivityLine, NewActivityLine, ActivityTail } from './activity.js';
export { isSafeSlug, canonicalSlug, slugify, reportPath, listReports, readReport, writeReport } from './reports.js';
export type { ReportMeta } from './reports.js';
