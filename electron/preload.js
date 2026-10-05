const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectSource: () => ipcRenderer.invoke('dialog:selectSource'),
  extractFiles: (data) => ipcRenderer.invoke('extract:start', data),
  onExtractProgress: (callback) => ipcRenderer.on('extract:progress', (_event, value) => callback(value)),
  onExtractComplete: (callback) => ipcRenderer.on('extract:complete', (_event, result) => callback(result)),
  onExtractError: (callback) => ipcRenderer.on('extract:error', (_event, error) => callback(error)),

  scanCompressFolder: (folderString) => ipcRenderer.invoke('compress:scan', folderString),
  compressFiles: (data) => ipcRenderer.invoke('compress:start', data),
  onCompressProgress: (callback) => ipcRenderer.on('compress:progress', (_event, value) => callback(value)),
  onCompressComplete: (callback) => ipcRenderer.on('compress:complete', (_event, result) => callback(result)),
  onCompressError: (callback) => ipcRenderer.on('compress:error', (_event, error) => callback(error)),

  cancelProcess: (moduleName) => ipcRenderer.invoke('cancel:process', moduleName),
  selectMergeSource: () => ipcRenderer.invoke('dialog:selectMergeSource'),
  scanMergeFolder: (folderString) => ipcRenderer.invoke('merge:scan', folderString),
  mergeFiles: (data) => ipcRenderer.invoke('merge:start', data),
  onMergeProgress: (callback) => ipcRenderer.on('merge:progress', (_event, value) => callback(value)),
  onMergeComplete: (callback) => ipcRenderer.on('merge:complete', (_event, result) => callback(result)),
  onMergeError: (callback) => ipcRenderer.on('merge:error', (_event, error) => callback(error))
})
