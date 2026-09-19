import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray } from 'electron';
import path from 'node:path';
import electronUpdaterPkg from 'electron-updater';
import { FireworksMindBackend } from '@yggdrasil/engine';
import type { IMindBackend } from '@yggdrasil/engine';
import { listReports, readReport, recentActivity, tailActivity, writeReport, type ActivityTail } from '@yggdrasil/home';
import { TRAY_ICON_DATA_URL } from './trayIcon.js';
import { llmRateLimiter } from './ipcGuards.js';
import { llmComplete } from './llmBridge.js';
import { effectiveKey, effectiveModel, keyAtRest, migrateKeyAtRest, saveKey, savedModel, SettingsError, setSecretStore, type KeyAtRest } from './settings.js';

const { autoUpdater } = electronUpdaterPkg;

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

/** Renderer-supplied report text is written to disk; bound what it can write. */
const MAX_REPORT_TITLE = 512;
const MAX_REPORT_BODY = 4 * 1024 * 1024;

// LLM backend (the trained consciousness). Built lazily from the effective
// key; rebuilt when the key/model changes. The key never leaves main.
let llmBackend: IMindBackend | null = null;
let llmBackendKey = '';
function getBackend(): IMindBackend | null {
  const key = effectiveKey();
  if (!key) {
    llmBackend = null;
    return null;
  }
  const model = effectiveModel();
  const sig = `${key.slice(0, 6)}:${model}`;
  if (!llmBackend || llmBackendKey !== sig) {
    llmBackend = new FireworksMindBackend({ apiKey: key, model });
    llmBackendKey = sig;
  }
  return llmBackend;
}

const llmRate = llmRateLimiter();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activityTail: ActivityTail | null = null;
/** True once the user chose Quit — lets window-close hide to tray instead. */
let isQuitting = false;

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * System tray with a real Quit. Closing the window hides the Lab to the tray
 * (an experiment may still be mid-run); the only way to fully exit is the
 * tray's Quit — so "close" and "quit" are distinct, deliberate actions.
 */
function createTray(): void {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('Yggdrasil Lab');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Yggdrasil Lab', click: showWindow },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => void autoUpdater.checkForUpdates().catch(() => {}) },
    { type: 'separator' },
    {
      label: 'Quit Yggdrasil Lab',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0b0f12',
    title: 'Yggdrasil Lab',
    icon: nativeImage.createFromDataURL(TRAY_ICON_DATA_URL),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // The preload only touches contextBridge + ipcRenderer, both of which are
      // available inside the sandbox, so the renderer process gets no Node at all.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  // The lab is a single local document: it never navigates and never opens a
  // second window. Anything that tries is either a bug or an injection.
  const logBlocked = (what: string, url: string): void => {
    // eslint-disable-next-line no-console
    console.warn(`[yggdrasil] blocked ${what} to ${url}`);
  };
  mainWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    logBlocked('navigation', url);
  });
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    e.preventDefault();
    logBlocked('frame navigation', e.url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Deliberately NOT forwarded to shell.openExternal: the lab has no outbound
    // links, so a window.open() could only be an exfiltration channel.
    logBlocked('window.open', url);
    return { action: 'deny' };
  });

  // Close hides to the tray (a run may still be going); real exit is the
  // tray's Quit, which sets isQuitting first.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function emitUpdate(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function setupAutoUpdate(): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => emitUpdate('updater:checking'));
  autoUpdater.on('update-available', (info) => emitUpdate('updater:available', info));
  autoUpdater.on('update-not-available', () => emitUpdate('updater:none'));
  autoUpdater.on('download-progress', (p) => emitUpdate('updater:progress', p));
  autoUpdater.on('update-downloaded', (info) => emitUpdate('updater:ready', info));
  autoUpdater.on('error', (err) => emitUpdate('updater:error', String(err)));
  autoUpdater.checkForUpdates().catch(() => {});
}

function llmStatus(): { hasKey: boolean; model: string; keyAtRest: KeyAtRest } {
  return { hasKey: !!effectiveKey(), model: effectiveModel(), keyAtRest: keyAtRest() };
}

app.whenReady().then(() => {
  // safeStorage is only usable once the app is ready; hand it to the settings
  // module, then lift any key an older version left on disk in the clear.
  setSecretStore(safeStorage);
  if (migrateKeyAtRest()) {
    // eslint-disable-next-line no-console
    console.log('[yggdrasil] migrated the stored API key to OS-encrypted storage');
  }

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('updater:install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  // LLM consciousness bridge — the renderer's minds reason through here so the
  // Fireworks key stays in main. Both halves cross: the prompt the engine
  // composed (retry feedback already inside `prompt.user`) and the situation it
  // was composed from. Both are renderer-controlled and the endpoint is billed,
  // so llmBridge validates and rate-limits before anything costs money.
  ipcMain.handle('llm:complete', (_e, prompt: unknown, input: unknown) => llmComplete(llmRate, getBackend, prompt, input));
  ipcMain.handle('llm:status', () => llmStatus());
  // Reports the rejection instead of throwing, so a mistyped key cannot leave
  // the renderer with an unhandled rejection.
  ipcMain.handle('settings:setKey', (_e, key: unknown, model?: unknown) => {
    try {
      saveKey(key, model);
      getBackend();
      return llmStatus();
    } catch (e) {
      return { ...llmStatus(), error: e instanceof SettingsError ? e.message : 'SAVE_FAILED' };
    }
  });
  ipcMain.handle('settings:get', () => ({ ...llmStatus(), savedModel: savedModel() }));

  // Shared activity feed + reports. Slugs are validated inside @yggdrasil/home
  // (reportPath), which is the single gate between an untrusted name and disk.
  ipcMain.handle('activity:recent', (_e, limit?: unknown) =>
    recentActivity(typeof limit === 'number' && Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 100),
  );
  ipcMain.handle('reports:list', () => listReports());
  ipcMain.handle('reports:read', (_e, slug: unknown) => (typeof slug === 'string' ? readReport(slug) : null));
  ipcMain.handle('reports:write', (_e, title: unknown, body: unknown, slug?: unknown) => {
    if (typeof title !== 'string' || title.length === 0 || title.length > MAX_REPORT_TITLE) throw new Error('BAD_REPORT_TITLE');
    if (typeof body !== 'string' || body.length > MAX_REPORT_BODY) throw new Error('BAD_REPORT_BODY');
    if (slug !== undefined && typeof slug !== 'string') throw new Error('BAD_REPORT_SLUG');
    return writeReport(title, body, 'you', slug);
  });

  createWindow();
  createTray();
  setupAutoUpdate();

  // Stream new activity lines (incl. the AI engineer's MCP runs) to the window.
  activityTail = tailActivity((lines) => mainWindow?.webContents.send('activity:lines', lines));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  activityTail?.stop();
  activityTail = null;
});

// Tray app: closing the window only hides it; exit happens via the tray's
// Quit / before-quit — so do NOT auto-quit when all windows close.
app.on('window-all-closed', () => {
  // intentionally empty
});
