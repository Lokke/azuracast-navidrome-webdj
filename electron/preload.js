const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform detection
  isElectron: () => true,
  platform: process.platform,
  
  // Window controls
  hideWindow: () => ipcRenderer.send('hide-window'),
  showWindow: () => ipcRenderer.send('show-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  
  // Streaming status for tray menu
  setStreamingStatus: (isStreaming) => 
    ipcRenderer.send('streaming-status-changed', isStreaming)
});