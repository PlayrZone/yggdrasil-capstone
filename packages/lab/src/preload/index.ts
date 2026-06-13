import { contextBridge, ipcRenderer } from 'electron';

type UpdaterChannel =
  | 'updater:checking'
  | 'updater:available'
  | 'updater:none'
  | 'updater:progress'
  | 'updater:ready'
  | 'updater:error';

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  onUpdate: (cb: (channel: UpdaterChannel, payload: unknown) => void): (() => void) => {
    const channels: UpdaterChannel[] = [
      'updater:checking',
      'updater:available',
      'updater:none',
      'updater:progress',
      'updater:ready',
      'updater:error',
    ];
    const handlers = channels.map((ch) => {
      const h = (_e: unknown, payload: unknown): void => cb(ch, payload);
      ipcRenderer.on(ch, h);
      return { ch, h };
    });
    return () => handlers.forEach(({ ch, h }) => ipcRenderer.removeListener(ch, h));
  },
};

contextBridge.exposeInMainWorld('lab', api);

export type LabApi = typeof api;
