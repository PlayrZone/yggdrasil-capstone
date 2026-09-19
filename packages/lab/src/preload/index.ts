import { contextBridge, ipcRenderer } from 'electron';

type UpdaterChannel =
  | 'updater:checking'
  | 'updater:available'
  | 'updater:none'
  | 'updater:progress'
  | 'updater:ready'
  | 'updater:error';

/**
 * Mirrors `ActivityLine` in @yggdrasil/home. Declared rather than imported so
 * the sandboxed preload bundle stays a leaf that requires only `electron`.
 * Time is two fields, never one: `wallMs` is when the line was written (absent
 * on legacy lines), `tick` is the simulation tick it describes.
 */
export interface ActivityLine {
  wallMs?: number;
  tick?: number;
  actor: string;
  kind: string;
  runId?: number;
  summary: string;
  data?: Record<string, unknown>;
  agents?: { id: number; x: number; y: number; state: number }[];
}

export interface ReportMeta {
  slug: string;
  title: string;
  author: string;
  updatedAt: number;
}

export interface LlmStatus {
  hasKey: boolean;
  model: string;
  /** How the key is held: 'env' | 'encrypted' | 'plaintext' | 'none'. Never the key. */
  keyAtRest: 'none' | 'env' | 'encrypted' | 'plaintext';
}

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  onUpdate: (cb: (channel: UpdaterChannel, payload: unknown) => void): (() => void) => {
    const channels: UpdaterChannel[] = ['updater:checking', 'updater:available', 'updater:none', 'updater:progress', 'updater:ready', 'updater:error'];
    const handlers = channels.map((ch) => {
      const h = (_e: unknown, payload: unknown): void => cb(ch, payload);
      ipcRenderer.on(ch, h);
      return { ch, h };
    });
    return () => handlers.forEach(({ ch, h }) => ipcRenderer.removeListener(ch, h));
  },

  // LLM consciousness bridge (key stays in main). The prompt is composed once,
  // in the engine, with any retry feedback already appended to `prompt.user`;
  // `input` rides along for backends that reason rather than transport. Neither
  // side may rebuild one from the other.
  // `worldId` names the adapter the engine composed `prompt` from — main
  // rebuilds the prompt to bind it to `input`, and since engine W1-B3 that
  // render depends on the world's own action vocabulary.
  llmComplete: (prompt: unknown, input: unknown, worldId: unknown): Promise<string> =>
    ipcRenderer.invoke('llm:complete', prompt, input, worldId),
  llmStatus: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:status'),
  setKey: (key: string, model?: string): Promise<LlmStatus & { error?: string }> => ipcRenderer.invoke('settings:setKey', key, model),
  getSettings: (): Promise<LlmStatus & { savedModel: string | null }> => ipcRenderer.invoke('settings:get'),

  // Shared activity feed.
  recentActivity: (limit?: number): Promise<ActivityLine[]> => ipcRenderer.invoke('activity:recent', limit),
  onActivity: (cb: (lines: ActivityLine[]) => void): (() => void) => {
    const h = (_e: unknown, lines: ActivityLine[]): void => cb(lines);
    ipcRenderer.on('activity:lines', h);
    return () => ipcRenderer.removeListener('activity:lines', h);
  },

  // Shared reports.
  listReports: (): Promise<ReportMeta[]> => ipcRenderer.invoke('reports:list'),
  readReport: (slug: string): Promise<{ meta: ReportMeta; body: string } | null> => ipcRenderer.invoke('reports:read', slug),
  writeReport: (title: string, body: string, slug?: string): Promise<string> => ipcRenderer.invoke('reports:write', title, body, slug),
};

contextBridge.exposeInMainWorld('lab', api);

export type LabApi = typeof api;
