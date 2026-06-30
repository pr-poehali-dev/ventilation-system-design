// Preload — безопасный мост между Electron и React
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Сервер
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),

  // Постоянное хранилище (лицензия и настройки)
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // Печать
  print: (options) => ipcRenderer.invoke('print', options),

  // Файлы
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Открытие файла извне (двойной клик)
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_, data) => callback(data)),
  offOpenFile: () => ipcRenderer.removeAllListeners('open-file'),

  // Обновления
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
});
