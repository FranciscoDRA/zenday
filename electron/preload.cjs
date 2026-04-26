const { contextBridge, ipcRenderer } = require('electron')

// ========== API EXPUESTAS ==========
contextBridge.exposeInMainWorld('electronAPI', {
  // ========== TAREAS ==========
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),
  
  // ========== NOTIFICACIONES ==========
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  
  // ========== CONTROLES DE VENTANA ==========
  close: () => ipcRenderer.invoke('close-window'),
  minimize: () => ipcRenderer.invoke('minimize-window'),
  maximize: () => ipcRenderer.invoke('maximize-window'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  
  // ========== EVENTOS DE VENTANA ==========
  onWindowMaximized: (callback) => {
    ipcRenderer.on('window-maximized', (_, isMaximized) => callback(isMaximized))
    return () => ipcRenderer.removeListener('window-maximized', callback)
  },
  
  // ========== UTILIDADES ==========
  reload: () => ipcRenderer.invoke('reload-window'),
  openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
  
  // ========== ARCHIVOS ==========
  openFile: (dataUrl, fileName) => ipcRenderer.invoke('open-file', dataUrl, fileName),
  
  // ========== ABRIR ENLACES EXTERNOS ==========
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // ========== LICENCIAS ==========
  checkLicense: () => ipcRenderer.invoke('check-license'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  deleteLicense: () => ipcRenderer.invoke('delete-license'),
  
  // ========== VERSIÓN DE LA APP ==========
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // ========== FETCH EXTERNO (evita CORS) ==========
  fetchExternal: (url, options) => ipcRenderer.invoke('fetch-external', url, options),

  // ========== AUTO-ACTUALIZACIONES ==========
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', callback)
    return () => ipcRenderer.removeListener('update-downloaded', callback)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
})

console.log('✅ Preload cargado correctamente')