// PV-Sistema — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store').default;
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// ── Постоянное хранилище (выживает при переустановке) ──────────────────────
const store = new Store({ name: 'pvs-data' });

// ── Python сервер ─────────────────────────────────────────────────────────────
let pythonServer = null;

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python-server.exe');
  }
  // Dev режим — ищем рядом
  return path.join(__dirname, '..', 'server', 'dist', 'python-server.exe');
}

function startPythonServer() {
  const serverPath = getServerPath();
  if (!fs.existsSync(serverPath)) {
    console.error('[electron] python-server не найден:', serverPath);
    return;
  }
  pythonServer = spawn(serverPath, [], { detached: false });
  pythonServer.stderr.on('data', d => console.error('[server]', d.toString()));
  pythonServer.on('exit', code => console.log('[server] завершился, код:', code));
}

function waitForServer(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 400);
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 400);
      });
    };
    check();
  });
}

// ── Главное окно ──────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow(fileToOpen = null) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    title: 'PV-Sistema',
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Убираем меню
  Menu.setApplicationMenu(null);

  // В packaged: main.js лежит в корне app.asar, dist-electron рядом
  const indexPath = app.isPackaged
    ? path.join(__dirname, 'dist-electron', 'index.html')
    : 'http://localhost:5174';

  if (app.isPackaged) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL(indexPath);
  }

  // Передаём файл на открытие после загрузки
  mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpen) {
      sendFileToOpen(fileToOpen);
    }
  });

  // Печать — открываем системный диалог
  mainWindow.webContents.on('did-finish-load', () => {});
}

// ── Открытие .vproj файлов ────────────────────────────────────────────────────
function sendFileToOpen(filePath) {
  if (!mainWindow || !filePath) return;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('open-file', { path: filePath, content });
  } catch (e) {
    console.error('[electron] Ошибка чтения файла:', e);
  }
}

// Файл передан через argv (двойной клик в проводнике)
function getFileFromArgv(argv) {
  return argv.find(a => a.endsWith('.vproj') && fs.existsSync(a)) || null;
}

// ── IPC обработчики ───────────────────────────────────────────────────────────

// URL сервера
ipcMain.handle('get-server-url', () => 'http://127.0.0.1:54321');

// Лицензия — постоянное хранилище
ipcMain.handle('store-get', (_, key) => store.get(key));
ipcMain.handle('store-set', (_, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_, key) => store.delete(key));

// Печать
ipcMain.handle('print', (_, options = {}) => {
  if (!mainWindow) return;
  mainWindow.webContents.print(
    { silent: false, printBackground: true, ...options },
    (success, err) => { if (!success) console.error('[print]', err); }
  );
});

// Диалог сохранения файла
ipcMain.handle('save-file', async (_, { defaultName, content }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'project.vproj',
    filters: [{ name: 'PV-Sistema Project', extensions: ['vproj'] }],
  });
  if (!filePath) return null;
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
});

// Диалог открытия файла
ipcMain.handle('open-file-dialog', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'PV-Sistema Project', extensions: ['vproj'] }],
    properties: ['openFile'],
  });
  if (!filePaths.length) return null;
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  return { path: filePaths[0], content };
});

// Версия приложения
ipcMain.handle('get-version', () => app.getVersion());

// ── Автообновление ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', progress);
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });

  ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
  ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
}

// ── Запуск приложения ─────────────────────────────────────────────────────────
const fileToOpenOnStart = getFileFromArgv(process.argv.slice(1));

// Один экземпляр приложения
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const file = getFileFromArgv(argv.slice(1));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (file) sendFileToOpen(file);
    }
  });

  app.whenReady().then(async () => {
    startPythonServer();
    await waitForServer('http://127.0.0.1:54321/health');
    createWindow(fileToOpenOnStart);
    if (app.isPackaged) setupAutoUpdater();
  });
}

app.on('window-all-closed', () => {
  if (pythonServer) pythonServer.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});