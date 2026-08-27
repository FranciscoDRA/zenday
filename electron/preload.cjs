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
    const handler = (_, isMaximized) => callback(isMaximized)
    ipcRenderer.on('window-maximized', handler)
    return () => ipcRenderer.removeListener('window-maximized', handler)
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
  
  // ========== ADJUNTOS DE CLIENTES ==========
  docsList:      (patientId)             => ipcRenderer.invoke('docs-list', patientId),
  docsSave:      (patientId, meta, data) => ipcRenderer.invoke('docs-save', patientId, meta, data),
  docsRead:      (patientId, docId)      => ipcRenderer.invoke('docs-read', patientId, docId),
  docsDelete:    (patientId, docId)      => ipcRenderer.invoke('docs-delete', patientId, docId),
  docsDeleteAll: (patientId)             => ipcRenderer.invoke('docs-delete-all', patientId),
  docsMigrate:   (patientId, docs)       => ipcRenderer.invoke('docs-migrate', patientId, docs),

  // ========== REGISTRO DE ERRORES ==========
  logError:     (payload) => ipcRenderer.invoke('log-error', payload),
  openErrorLog: ()        => ipcRenderer.invoke('open-error-log'),

  // ========== VERSIÓN DE LA APP ==========
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // ========== FETCH EXTERNO (evita CORS) ==========
  fetchExternal: (url, options) => ipcRenderer.invoke('fetch-external', url, options),

  // ========== AUTO-ACTUALIZACIONES ==========
  onUpdateDownloaded: (callback) => {
    const handler = (_, info) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
})

console.log('✅ Preload cargado correctamente')