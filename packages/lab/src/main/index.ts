import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import electronUpdaterPkg from 'electron-updater';
import { TRAY_ICON_DATA_URL } from './trayIcon.js';

const { autoUpdater } = electronUpdaterPkg;

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
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
      sandbox: false,
    },
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

app.whenReady().then(() => {
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

  createWindow();
  createTray();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Tray app: closing the window only hides it; exit happens via the tray's
// Quit / before-quit — so do NOT auto-quit when all windows close.
app.on('window-all-closed', () => {
  // intentionally empty
});
