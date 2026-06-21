const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Notifications
  showNotification: (title, body) => {
    ipcRenderer.send('notification:show', { title, body });
  },

  // Listen for events from main process
  onAvailabilityUpdate: (callback) => {
    ipcRenderer.on('availability:update', (event, data) => callback(data));
  },
});

// Log that we're running in Electron
console.log('[Electron] Preload script loaded');
