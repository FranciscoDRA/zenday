// src/components/common/BackupManager.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'

// ─── BACKUP SERVICE ───────────────────────────────────────────────────────────

const STORAGE_KEY          = 'zenday_backups'
const EMERGENCY_STORAGE_KEY = 'zenday_backups_emergency'
const LAST_AUTO_BACKUP_KEY = 'zenday_last_auto_backup'
const MAX_BACKUPS          = 20
const MAX_EMERGENCY_BACKUPS = 5
const AUTO_BACKUP_MS       = 24 * 60 * 60 * 1000  // 24 h
const CHECK_INTERVAL_MS    =  1 * 60 * 60 * 1000  // 1 h

const BackupService = {
  getBackups() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    } catch {
      return []
    }
  },

  getEmergencyBackups() {
    try {
      return JSON.parse(localStorage.getItem(EMERGENCY_STORAGE_KEY) || '[]')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    } catch {
      return []
    }
  },

  saveBackups(list, isEmergency = false) {
    const key = isEmergency ? EMERGENCY_STORAGE_KEY : STORAGE_KEY
    try {
      localStorage.setItem(key, JSON.stringify(list))
    } catch (err) {
      console.error(`[BACKUP] Error saving to ${key}:`, err)
      throw new Error('No hay espacio suficiente para guardar el respaldo')
    }
  },

  async generateChecksum(data) {
    const str = JSON.stringify(data)
    const msgBuffer = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  },

  migrateBackup(backup) {
    if (!backup.metadata?.version) {
      return {
        ...backup,
        data: {
          products: backup.data.products || [],
          clients: backup.data.clients || [],
          appointments: backup.data.appointments || [],
          expenses: backup.data.expenses || [],
          settings: backup.data.settings || {},
          orders: backup.data.orders || [],
          stockMovements: backup.data.stockMovements || [],
          categories: backup.data.categories || [],
          recurringRules: backup.data.recurringRules || [],
          whatsappConfig: backup.data.whatsappConfig || null,
        },
        metadata: {
          ...backup.metadata,
          version: '2.1.0',
          migratedFrom: 'v1',
        },
      }
    }
    return backup
  },

  async createBackup(data, options = {}) {
    const isEmergency = options.type === 'emergency_pre_restore'
    const backups = isEmergency ? this.getEmergencyBackups() : this.getBackups()
    const maxLimit = isEmergency ? MAX_EMERGENCY_BACKUPS : MAX_BACKUPS
    
    const id = `backup_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    const payload = {
      products:     data.products     || [],
      clients:      data.clients      || [],
      appointments: data.appointments || [],
      expenses:     data.expenses     || [],
      settings:     data.settings     || {},
      orders:       data.orders       || [],
      stockMovements: data.stockMovements || [],
      categories:   data.categories   || [],
      recurringRules: data.recurringRules || [],
      whatsappConfig: data.whatsappConfig || null,
    }

    const checksum = await this.generateChecksum(payload)

    const backup = {
      id,
      timestamp: new Date().toISOString(),
      type:      options.type  || 'manual',
      label:     options.label || null,
      data:      payload,
      metadata: {
        totalProducts:     payload.products.length,
        totalClients:      payload.clients.length,
        totalAppointments: payload.appointments.length,
        totalExpenses:     payload.expenses.length,
        totalOrders:       payload.orders.length,
        totalStockMovements: payload.stockMovements.length,
        totalCategories:   payload.categories.length,
        version:           '2.1.0',
        checksum:          checksum,
      },
    }

    const next = [backup, ...backups].slice(0, maxLimit)
    this.saveBackups(next, isEmergency)
    return backup
  },

  // CORREGIDO: validación de checksum para backups migrados
  async validateBackup(backupId) {
    let backups = this.getBackups()
    let backup = backups.find(b => b.id === backupId)
    let isEmergency = false
    
    if (!backup) {
      backups = this.getEmergencyBackups()
      backup = backups.find(b => b.id === backupId)
      isEmergency = true
    }

    if (!backup)         return { valid: false, errors: ['Backup no encontrado'] }
    if (!backup.data)    return { valid: false, errors: ['Falta data'] }
    if (!backup.metadata)return { valid: false, errors: ['Falta metadata'] }

    const migrated = this.migrateBackup(backup)
    
    // Si fue migrado, saltear validación de checksum (datos cambiaron intencionalmente)
    if (migrated.metadata.migratedFrom) {
      return { valid: true, errors: [], backup: migrated, isEmergency }
    }
    
    const errors = []
    const checksum = await this.generateChecksum(migrated.data)
    if (checksum !== migrated.metadata.checksum) {
      errors.push('Checksum inválido — datos posiblemente corruptos')
    }

    return { valid: errors.length === 0, errors, backup: migrated, isEmergency }
  },

  restoreFull(backup) {
    return {
      products:       backup.data.products || [],
      clients:        backup.data.clients || [],
      appointments:   backup.data.appointments || [],
      expenses:       backup.data.expenses || [],
      settings:       backup.data.settings || {},
      orders:         backup.data.orders || [],
      stockMovements: backup.data.stockMovements || [],
      categories:     backup.data.categories || [],
      recurringRules: backup.data.recurringRules || [],
      whatsappConfig: backup.data.whatsappConfig || null,
    }
  },

  restoreClientsOnly(backup, currentClients) {
    const existingIds = new Set(currentClients.map(c => c.id))
    const toAdd = (backup.data.clients || []).filter(c => !existingIds.has(c.id))
    return {
      added: toAdd.length,
      clients: [...currentClients, ...toAdd],
      total: currentClients.length + toAdd.length
    }
  },

  restoreProductsOnly(backup, currentProducts) {
    const existingIds = new Set(currentProducts.map(p => p.id))
    const toAdd = (backup.data.products || []).filter(p => !existingIds.has(p.id))
    return {
      added: toAdd.length,
      products: [...currentProducts, ...toAdd],
      total: currentProducts.length + toAdd.length
    }
  },

  restoreOrdersOnly(backup, currentOrders) {
    const existingIds = new Set(currentOrders.map(o => o.id))
    const toAdd = (backup.data.orders || []).filter(o => !existingIds.has(o.id))
    return {
      added: toAdd.length,
      orders: [...currentOrders, ...toAdd],
      total: currentOrders.length + toAdd.length
    }
  },

  restoreSettingsOnly(backup) {
    return backup.data.settings || {}
  },

  deleteBackup(backupId, isEmergency = false) {
    const backups = isEmergency ? this.getEmergencyBackups() : this.getBackups()
    const filtered = backups.filter(b => b.id !== backupId)
    this.saveBackups(filtered, isEmergency)
  },

  exportToFile(backup) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `ZenDay_Backup_${new Date(backup.timestamp).toISOString().split('T')[0]}.zenday`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      document.body.removeChild(a)
    }, 150)
  },

  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 100 * 1024 * 1024) {
        reject(new Error('Archivo demasiado grande (máx 100MB)'))
        return
      }

      const reader = new FileReader()

      reader.onload = async (e) => {
        try {
          let backup = JSON.parse(e.target.result)

          if (!backup.id || !backup.data || !backup.metadata) {
            reject(new Error('Formato inválido'))
            return
          }

          backup = BackupService.migrateBackup(backup)

          const checksum = await BackupService.generateChecksum(backup.data)
          if (checksum !== backup.metadata.checksum) {
            reject(new Error('Archivo corrupto — checksum inválido'))
            return
          }

          const backups = BackupService.getBackups()
          if (!backups.find(b => b.id === backup.id)) {
            BackupService.saveBackups([backup, ...backups].slice(0, MAX_BACKUPS))
          }

          resolve(backup)
        } catch {
          reject(new Error('Archivo corrupto'))
        }
      }

      reader.onerror = () => reject(new Error('Error al leer el archivo'))
      reader.readAsText(file)
    })
  },

  getStats(backups, emergencyBackups) {
    return {
      total:         backups.length,
      oldest:        backups[backups.length - 1]?.timestamp || null,
      newest:        backups[0]?.timestamp || null,
      totalSize:     JSON.stringify(backups).length,
      autoBackups:   backups.filter(b => b.type === 'auto').length,
      manualBackups: backups.filter(b => b.type === 'manual').length,
      emergencyBackups: emergencyBackups.length,
    }
  },
}

// ─── HELPERS DE FORMATO ───────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(isoString) {
  if (!isoString) return 'Nunca'
  const date = new Date(isoString)
  const now = new Date()
  
  const isToday = date.toDateString() === now.toDateString()
  
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()
  
  if (isToday) return `Hoy ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  if (isYesterday) return `Ayer ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function BackupManager({
  products = [],
  clients = [],
  appointments = [],
  expenses = [],
  settings = {},
  orders = [],
  stockMovements = [],
  categories = [],
  recurringRules = [],
  whatsappConfig = null,
  setProducts = () => {},
  setClients = () => {},
  setAppointments = () => {},
  setExpenses = () => {},
  setSettings = () => {},
  setOrders = () => {},
  setStockMovements = () => {},
  setCategories = () => {},
  setRecurringRules = () => {},
  setWhatsappConfig = () => {},
}) {
  const toast = useToast()
  const { confirm } = useConfirm()

  const [backups, setBackupsState] = useState([])
  const [emergencyBackups, setEmergencyBackupsState] = useState([])
  const [stats, setStats] = useState({})
  const [showPanel, setShowPanel] = useState(false)
  const [showRestoreFor, setShowRestoreFor] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [backupLabel, setBackupLabel] = useState('')

  const latestData = useRef({ 
    products, clients, appointments, expenses, settings,
    orders, stockMovements, categories, recurringRules, whatsappConfig
  })
  
  useEffect(() => {
    latestData.current = { 
      products, clients, appointments, expenses, settings,
      orders, stockMovements, categories, recurringRules, whatsappConfig
    }
  }, [products, clients, appointments, expenses, settings, orders, stockMovements, categories, recurringRules, whatsappConfig])

  // CORREGIDO: loadBackups sin dependencias problemáticas
  const loadBackups = useCallback(() => {
    const list = BackupService.getBackups()
    const emergencyList = BackupService.getEmergencyBackups()
    setBackupsState(list)
    setEmergencyBackupsState(emergencyList)
    setStats(BackupService.getStats(list, emergencyList))
  }, [])

  useEffect(() => {
    if (showPanel) loadBackups()
  }, [showPanel, loadBackups])

  // Auto-backup
  useEffect(() => {
    const checkAutoBackup = async () => {
      const last = localStorage.getItem(LAST_AUTO_BACKUP_KEY)
      const now  = Date.now()
      if (last && now - parseInt(last) < AUTO_BACKUP_MS) return

      const data = latestData.current
      if (data.products.length === 0 && data.clients.length === 0) return

      try {
        await BackupService.createBackup(data, { type: 'auto' })
        localStorage.setItem(LAST_AUTO_BACKUP_KEY, now.toString())
      } catch (err) {
        console.error('[AUTO-BACKUP] Error:', err)
        if (err.message?.includes('espacio') && window.electronAPI?.showNotification) {
          window.electronAPI.showNotification(
            '⚠️ ZenDay — Sin espacio',
            'No se pudo crear el respaldo automático. Liberá espacio en el almacenamiento local.'
          )
        }
      }
    }

    checkAutoBackup()
    const interval = setInterval(checkAutoBackup, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const handleCreateBackup = useCallback(async () => {
    setIsCreating(true)
    try {
      const estimatedSize = JSON.stringify(latestData.current).length
      
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const { quota, usage } = await navigator.storage.estimate()
        const freeMB = (quota - usage - estimatedSize) / 1_048_576
        if (freeMB < 5) {
          toast.addToast(`⚠️ Espacio insuficiente: necesitas ${(estimatedSize/1_048_576).toFixed(1)} MB libre`, 'warning')
          return
        }
        if (freeMB < 50) {
          toast.addToast(`⚠️ Espacio bajo (${freeMB.toFixed(1)} MB libre)`, 'warning')
        }
      }

      await BackupService.createBackup(latestData.current, {
        type:  'manual',
        label: backupLabel.trim() || null,
      })

      toast.addToast('✅ Respaldo creado', 'success')
      setBackupLabel('')
      loadBackups()
    } catch (err) {
      toast.addToast(`❌ ${err.message || 'Error al crear respaldo'}`, 'error')
    } finally {
      setIsCreating(false)
    }
  }, [backupLabel, loadBackups, toast])

  const executeRestore = useCallback(async (backup, mode) => {
    const validation = await BackupService.validateBackup(backup.id)
    if (!validation.valid) {
      toast.addToast(`❌ Backup corrupto: ${validation.errors[0]}`, 'error')
      return
    }
    const validBackup = validation.backup

    setIsRestoring(true)
    try {
      await BackupService.createBackup(latestData.current, {
        type: 'emergency_pre_restore', 
        label: `PRE-RESTORE-${mode}-${new Date().toISOString()}`
      })

      if (mode === 'full') {
        const ok = await confirm(
          `⚠️ RESTAURACIÓN COMPLETA\n\n` +
          `📦 Productos: ${validBackup.metadata.totalProducts}\n` +
          `👥 Clientes: ${validBackup.metadata.totalClients}\n` +
          `📅 Citas: ${validBackup.metadata.totalAppointments}\n` +
          `💰 Gastos: ${validBackup.metadata.totalExpenses ?? 0}\n` +
          `🛒 Pedidos: ${validBackup.metadata.totalOrders ?? 0}\n` +
          `📊 Mov. Stock: ${validBackup.metadata.totalStockMovements ?? 0}\n\n` +
          `❗ TODOS los datos actuales serán REEMPLAZADOS.\n¿Estás seguro?`,
          'Confirmar restauración total'
        )
        if (!ok) {
          setShowRestoreFor(null)
          setIsRestoring(false)
          return
        }

        const restoredData = BackupService.restoreFull(validBackup)
        setProducts(restoredData.products)
        setClients(restoredData.clients)
        setAppointments(restoredData.appointments)
        setExpenses(restoredData.expenses)
        setSettings(restoredData.settings)
        setOrders?.(restoredData.orders)
        setStockMovements?.(restoredData.stockMovements)
        setCategories?.(restoredData.categories)
        setRecurringRules?.(restoredData.recurringRules)
        setWhatsappConfig?.(restoredData.whatsappConfig)
        
        toast.addToast('✅ Sistema restaurado. Recargando…', 'success')
        setTimeout(() => window.location.reload(), 2000)

      } else if (mode === 'clients') {
        const ok = await confirm(
          `👥 RESTAURAR SOLO CLIENTES\n\nSe agregarán ${validBackup.metadata.totalClients} clientes.\nLos actuales no se modificarán.\n\n¿Continuar?`,
          'Restaurar clientes'
        )
        if (!ok) return
        const r = BackupService.restoreClientsOnly(validBackup, clients)
        setClients(r.clients)
        toast.addToast(`✅ ${r.added} clientes agregados (total: ${r.total})`, 'success')
        loadBackups()

      } else if (mode === 'products') {
        const ok = await confirm(
          `📦 RESTAURAR SOLO PRODUCTOS\n\nSe agregarán ${validBackup.metadata.totalProducts} productos.\nLos actuales no se modificarán.\n\n¿Continuar?`,
          'Restaurar productos'
        )
        if (!ok) return
        const r = BackupService.restoreProductsOnly(validBackup, products)
        setProducts(r.products)
        toast.addToast(`✅ ${r.added} productos agregados (total: ${r.total})`, 'success')
        loadBackups()

      } else if (mode === 'orders') {
        const ok = await confirm(
          `🛒 RESTAURAR SOLO PEDIDOS\n\nSe agregarán ${validBackup.metadata.totalOrders ?? 0} pedidos.\nLos actuales no se modificarán.\n\n¿Continuar?`,
          'Restaurar pedidos'
        )
        if (!ok) return
        const r = BackupService.restoreOrdersOnly(validBackup, orders)
        setOrders(r.orders)
        toast.addToast(`✅ ${r.added} pedidos agregados (total: ${r.total})`, 'success')
        loadBackups()

      } else if (mode === 'settings') {
        const ok = await confirm(
          `⚙️ RESTAURAR CONFIGURACIÓN\n\nLa configuración actual será reemplazada.\n\n¿Continuar?`,
          'Restaurar configuración'
        )
        if (!ok) return
        const restoredSettings = BackupService.restoreSettingsOnly(validBackup)
        setSettings(restoredSettings)
        toast.addToast('✅ Configuración restaurada', 'success')
        loadBackups()
      }

      setShowRestoreFor(null)
    } catch (err) {
      console.error('[RESTORE]', err)
      toast.addToast('❌ Error en restauración', 'error')
    } finally {
      setIsRestoring(false)
    }
  }, [clients, products, orders, setProducts, setClients, setAppointments, setExpenses, setSettings, setOrders, setStockMovements, setCategories, setRecurringRules, setWhatsappConfig, loadBackups, toast, confirm])

  const handleExport = useCallback((backup) => {
    try {
      BackupService.exportToFile(backup)
      toast.addToast('📁 Respaldo exportado', 'success')
    } catch {
      toast.addToast('❌ Error al exportar', 'error')
    }
  }, [toast])

  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.zenday'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) {
        input.remove()
        return
      }
      try {
        const backup = await BackupService.importFromFile(file)
        toast.addToast(
          `✅ Respaldo importado: ${new Date(backup.timestamp).toLocaleDateString()}`,
          'success'
        )
        loadBackups()
      } catch (err) {
        toast.addToast(`❌ ${err.message}`, 'error')
      } finally {
        input.remove()
      }
    }
    input.click()
  }, [loadBackups, toast])

  const handleDelete = useCallback(async (backup, isEmergency = false) => {
    const ok = await confirm('⚠️ ELIMINAR RESPALDO\n\nEsta acción no se puede deshacer.', 'Confirmar')
    if (!ok) return
    BackupService.deleteBackup(backup.id, isEmergency)
    toast.addToast('🗑️ Respaldo eliminado', 'info')
    loadBackups()
  }, [confirm, toast, loadBackups])

  // CORREGIDO: calcular warning directamente en el render (sin estado)
  const daysSinceLastBackup = backups.length > 0
    ? (Date.now() - new Date(backups[0].timestamp).getTime()) / (1000 * 60 * 60 * 24)
    : 0
  const showOldBackupWarning = daysSinceLastBackup > 7

  return (
    <>
      <button
        className={`backup-button ${showOldBackupWarning ? 'backup-button-warning' : ''}`}
        onClick={() => setShowPanel(true)}
        title={showOldBackupWarning ? `⚠️ Sin respaldo desde hace ${Math.floor(daysSinceLastBackup)} días` : "Centro de Respaldos"}
      >
        💾
        {showOldBackupWarning && <span className="backup-badge-warning">!</span>}
      </button>

      {showPanel && (
        <div className="backup-modal-overlay" onClick={() => setShowPanel(false)}>
          <div className="backup-modal" onClick={e => e.stopPropagation()}>
            <div className="backup-modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em' }}>
                  💾 Centro de Respaldos
                </h2>
                <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  Protege los datos de tu negocio
                </p>
              </div>
              <button className="modal-close" onClick={() => setShowPanel(false)}>✕</button>
            </div>

            <div className="backup-stats" style={{ display:'flex', gap:16, padding:'16px 24px', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)' }}>
              {[
                { icon:'📦', value: stats.total        ?? 0,              label:'Respaldos' },
                { icon:'🤖', value: stats.autoBackups   ?? 0,              label:'Automáticos' },
                { icon:'🚨', value: stats.emergencyBackups ?? 0,           label:'Emergencia' },
                { icon:'💾', value: formatSize(stats.totalSize ?? 0),      label:'Tamaño total' },
                { icon:'🕐', value: formatDate(stats.newest),              label:'Último' },
              ].map(s => (
                <div key={s.label} className="stat" style={{ flex:1, background:'var(--bg-secondary)', borderRadius:12, padding:12 }}>
                  <div style={{ fontSize:20 }}>{s.icon}</div>
                  <div style={{ fontWeight:700, fontSize:16, color:'var(--text-primary)', marginTop:4 }}>{s.value}</div>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display:'flex', gap:10, padding:'16px 24px', borderBottom:'1px solid var(--border)' }}>
              <input
                type="text"
                placeholder="Etiqueta opcional (ej: 'Antes de actualizar')"
                value={backupLabel}
                onChange={e => setBackupLabel(e.target.value)}
                maxLength={50}
                style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'1px solid var(--border)', background:'var(--bg-tertiary)', color:'var(--text-primary)', fontSize:14 }}
              />
              <button
                onClick={handleCreateBackup}
                disabled={isCreating}
                className="btn-primary"
                style={{ whiteSpace:'nowrap', opacity: isCreating ? .6 : 1 }}
              >
                {isCreating ? '⏳ Creando…' : '➕ Crear respaldo'}
              </button>
              <button onClick={handleImport} className="btn-secondary">
                📂 Importar
              </button>
            </div>

            <div style={{ display:'flex', gap:20, padding:'10px 24px', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)', fontSize:13, color:'var(--text-secondary)', flexWrap:'wrap' }}>
              <span>📦 Productos: <strong>{products.length}</strong></span>
              <span>👥 Clientes: <strong>{clients.length}</strong></span>
              <span>📅 Citas: <strong>{appointments.length}</strong></span>
              <span>💰 Gastos: <strong>{expenses.length}</strong></span>
              <span>🛒 Pedidos: <strong>{orders.length}</strong></span>
              <span>📊 Mov. Stock: <strong>{stockMovements.length}</strong></span>
            </div>

            <div className="backup-list" style={{ flex:1, overflowY:'auto', padding:'16px 24px' }}>
              <h3 style={{ margin:'0 0 14px', fontSize:16, fontWeight:700 }}>Historial</h3>

              {backups.length === 0 && emergencyBackups.length === 0 ? (
                <div className="empty-state small">
                  <div className="empty-emoji">💾</div>
                  <div className="empty-title">Sin respaldos aún</div>
                  <div className="empty-subtitle">Crea tu primer respaldo para proteger tu negocio</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {backups.map(b => (
                    <BackupItem
                      key={b.id}
                      backup={b}
                      isRestoring={isRestoring}
                      onRestore={() => setShowRestoreFor(b)}
                      onExport={() => handleExport(b)}
                      onDelete={() => handleDelete(b, false)}
                      formatDate={formatDate}
                    />
                  ))}
                  
                  {emergencyBackups.length > 0 && backups.length > 0 && (
                    <div style={{ marginTop:16, marginBottom:8 }}>
                      <hr style={{ borderColor:'var(--border)', marginBottom:12 }} />
                      <span style={{ fontSize:12, color:'var(--text-tertiary)', fontWeight:500 }}>
                        🚨 Respaldos de emergencia (creados antes de restaurar)
                      </span>
                    </div>
                  )}
                  
                  {emergencyBackups.map(b => (
                    <BackupItem
                      key={b.id}
                      backup={b}
                      isRestoring={isRestoring}
                      onRestore={() => setShowRestoreFor(b)}
                      onExport={() => handleExport(b)}
                      onDelete={() => handleDelete(b, true)}
                      formatDate={formatDate}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding:'12px 24px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text-tertiary)', textAlign:'center' }}>
              💡 Exporta backups importantes para guardarlos en un lugar seguro. · Auto-backup cada 24 h.
            </div>
          </div>
        </div>
      )}

      {showRestoreFor && (
        <div className="modal-overlay" onClick={() => setShowRestoreFor(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth:460 }}>
            <div className="modal-header">
              <h3>🔄 ¿Qué querés restaurar?</h3>
              <button className="modal-close" onClick={() => setShowRestoreFor(null)}>✕</button>
            </div>

            <div style={{ padding:'16px 24px', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)', fontSize:13, color:'var(--text-secondary)' }}>
              Respaldo del: <strong>{formatDate(showRestoreFor.timestamp)}</strong>
              <div style={{ marginTop:4 }}>
                📦 {showRestoreFor.metadata.totalProducts} productos ·{' '}
                👥 {showRestoreFor.metadata.totalClients} clientes ·{' '}
                📅 {showRestoreFor.metadata.totalAppointments} citas ·{' '}
                💰 {showRestoreFor.metadata.totalExpenses ?? '?'} gastos
                {showRestoreFor.metadata.totalOrders != null && (
                  <> · 🛒 {showRestoreFor.metadata.totalOrders} pedidos</>
                )}
              </div>
            </div>

            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { mode:'full',     icon:'🔄', label:'Restauración completa',   desc:'Reemplaza TODOS los datos actuales' },
                { mode:'clients',  icon:'👥', label:'Solo clientes',           desc:'Agrega sin sobrescribir los existentes' },
                { mode:'products', icon:'📦', label:'Solo productos',          desc:'Agrega sin sobrescribir los existentes' },
                { mode:'orders',   icon:'🛒', label:'Solo pedidos',            desc:'Agrega pedidos sin sobrescribir (modo emprendedor)' },
                { mode:'settings', icon:'⚙️', label:'Solo configuración',      desc:'Reemplaza las preferencias del sistema' },
              ].map(opt => (
                <button
                  key={opt.mode}
                  onClick={() => executeRestore(showRestoreFor, opt.mode)}
                  disabled={isRestoring}
                  style={{
                    display:'flex', alignItems:'center', gap:14, padding:16,
                    background:'var(--bg-secondary)', border:'1.5px solid var(--border)',
                    borderRadius:14, cursor: isRestoring ? 'wait' : 'pointer', textAlign:'left',
                    transition:'all .15s', opacity: isRestoring ? .6 : 1,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <span style={{ fontSize:24 }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)' }}>{opt.label}</div>
                    <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:2 }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowRestoreFor(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function BackupItem({ backup, isRestoring, onRestore, onExport, onDelete, formatDate }) {
  return (
    <div
      className="backup-item"
      style={{
        padding:16, background:'var(--bg-secondary)', borderRadius:14,
        borderLeft: `4px solid ${
          backup.type === 'auto'                  ? 'var(--accent-green)' :
          backup.type === 'emergency_pre_restore' ? 'var(--accent-red)'   :
          'var(--accent-blue)'
        }`,
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontWeight:700, fontSize:14 }}>
          {backup.type === 'auto'                  && '🤖 Automático'}
          {backup.type === 'manual'                && '👤 Manual'}
          {backup.type === 'emergency_pre_restore' && '🚨 Emergencia pre-restore'}
        </span>
        <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>
          {formatDate(backup.timestamp)}
        </span>
      </div>

      {backup.label && (
        <div style={{ fontSize:12, color:'var(--accent-blue)', marginBottom:6 }}>
          📝 {backup.label}
        </div>
      )}

      <div style={{ display:'flex', gap:14, fontSize:12, color:'var(--text-secondary)', marginBottom:10, flexWrap:'wrap' }}>
        <span>📦 {backup.metadata.totalProducts}</span>
        <span>👥 {backup.metadata.totalClients}</span>
        <span>📅 {backup.metadata.totalAppointments}</span>
        {backup.metadata.totalExpenses != null && <span>💰 {backup.metadata.totalExpenses}</span>}
        {backup.metadata.totalOrders != null && <span>🛒 {backup.metadata.totalOrders}</span>}
        {backup.metadata.totalStockMovements != null && <span>📊 {backup.metadata.totalStockMovements}</span>}
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button
          onClick={onRestore}
          disabled={isRestoring}
          style={{ flex:1, padding:'8px 12px', background:'var(--accent-green)', color:'white', border:'none', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}
        >
          🔄 Restaurar
        </button>
        <button
          onClick={onExport}
          style={{ padding:'8px 12px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:8, fontSize:13, cursor:'pointer' }}
          title="Exportar archivo"
        >📥</button>
        <button
          onClick={onDelete}
          style={{ padding:'8px 12px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:8, fontSize:13, cursor:'pointer', color:'var(--accent-red)' }}
          title="Eliminar"
        >🗑️</button>
      </div>
    </div>
  )
}