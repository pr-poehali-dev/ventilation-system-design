// PV-Sistema — Electron main process (no external deps)
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// File-based store — survives restarts
var storePath = null;
var store = {};

function getStorePath() {
  if (!storePath) {
    storePath = path.join(app.getPath('userData'), 'pvs-store.json');
  }
  return storePath;
}

function loadStore() {
  try {
    var data = fs.readFileSync(getStorePath(), 'utf-8');
    store = JSON.parse(data);
  } catch(e) { store = {}; }
}

function saveStore() {
  try {
    fs.writeFileSync(getStorePath(), JSON.stringify(store), 'utf-8');
  } catch(e) {}
}

// ── Python server ─────────────────────────────────────────────────────────────
let pythonServer = null;

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python-server.exe');
  }
  return path.join(__dirname, '..', 'server', 'dist', 'python-server.exe');
}

function startPythonServer() {
  const serverPath = getServerPath();
  console.log('[electron] server path:', serverPath);
  if (!fs.existsSync(serverPath)) {
    console.error('[electron] python-server NOT FOUND at:', serverPath);
    dialog.showErrorBox('Сервер не найден', 'python-server.exe не найден по пути:\n' + serverPath);
    return;
  }
  console.log('[electron] starting server...');
  pythonServer = spawn(serverPath, [], {
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  pythonServer.stdout && pythonServer.stdout.on('data', d => console.log('[server]', d.toString().trim()));
  pythonServer.stderr && pythonServer.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  pythonServer.on('exit', code => console.log('[server] exited, code:', code));
  pythonServer.on('error', err => {
    console.error('[server] spawn error:', err.message);
    dialog.showErrorBox('Ошибка запуска сервера', err.message);
  });
}

function waitForServer(url, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function(resolve) {
    var start = Date.now();
    function check() {
      http.get(url, function(res) {
        if (res.statusCode === 200) return resolve(true);
        retry();
      }).on('error', retry);
      function retry() {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 400);
      }
    }
    check();
  });
}

// ── Main window ───────────────────────────────────────────────────────────────
var mainWindow = null;

function createWindow(fileToOpen) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    title: 'PV-Sistema',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);

  var indexPath = app.isPackaged
    ? path.join(__dirname, 'dist-electron', 'index.html')
    : 'http://localhost:5174';

  if (app.isPackaged) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL(indexPath);
  }

  mainWindow.webContents.on('did-finish-load', function() {
    if (fileToOpen) sendFileToOpen(fileToOpen);
  });

  mainWindow.on('close', function(e) {
    e.preventDefault();
    mainWindow.webContents.executeJavaScript('window.__unsavedChanges || false')
      .then(function(dirty) {
        if (dirty) {
          var choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Выйти без сохранения', 'Отмена'],
            defaultId: 1,
            title: 'Несохранённые изменения',
            message: 'Есть несохранённые изменения. Выйти?',
          });
          if (choice === 0) { mainWindow.destroy(); }
        } else {
          mainWindow.destroy();
        }
      }).catch(function() { mainWindow.destroy(); });
  });
}

// ── File open ─────────────────────────────────────────────────────────────────
function sendFileToOpen(filePath) {
  if (!mainWindow || !filePath) return;
  try {
    var content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('open-file', { path: filePath, content: content });
  } catch(e) {
    console.error('[electron] read error:', e);
  }
}

function getFileFromArgv(argv) {
  for (var i = 0; i < argv.length; i++) {
    if (argv[i].endsWith('.vproj') && fs.existsSync(argv[i])) return argv[i];
  }
  return null;
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-server-url', function() { return 'http://127.0.0.1:54321'; });

ipcMain.handle('store-get', function(_, key) { return store[key] !== undefined ? store[key] : null; });
ipcMain.handle('store-set', function(_, key, value) { store[key] = value; saveStore(); });
ipcMain.handle('store-delete', function(_, key) { delete store[key]; saveStore(); });

ipcMain.handle('print', function() {
  if (!mainWindow) return;
  mainWindow.webContents.print({ silent: false, printBackground: true }, function() {});
});

ipcMain.handle('save-file', async function(_, opts) {
  var result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts.defaultName || 'project.vproj',
    filters: [{ name: 'PV-Sistema Project', extensions: ['vproj'] }],
  });
  if (!result.filePath) return null;
  fs.writeFileSync(result.filePath, opts.content, 'utf-8');
  return result.filePath;
});

ipcMain.handle('open-file-dialog', async function() {
  var result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'PV-Sistema Project', extensions: ['vproj'] }],
    properties: ['openFile'],
  });
  if (!result.filePaths.length) return null;
  var content = fs.readFileSync(result.filePaths[0], 'utf-8');
  return { path: result.filePaths[0], content: content };
});

ipcMain.handle('get-version', function() { return app.getVersion(); });
ipcMain.handle('check-for-updates', function() { return null; });
ipcMain.handle('download-update', function() { return null; });
ipcMain.handle('install-update', function() { return null; });

// ── App start ─────────────────────────────────────────────────────────────────
var fileToOpenOnStart = getFileFromArgv(process.argv.slice(1));
var gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function(_, argv) {
    var file = getFileFromArgv(argv.slice(1));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (file) sendFileToOpen(file);
    }
  });

  app.whenReady().then(async function() {
    loadStore();
    startPythonServer();
    await waitForServer('http://127.0.0.1:54321/health');
    createWindow(fileToOpenOnStart);
  });
}

app.on('window-all-closed', function() {
  if (pythonServer) pythonServer.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});