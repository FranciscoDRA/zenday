// src/services/backupService.js

export class BackupService {
  constructor() {
    this.backupPrefix = 'zenday_backup_'
  }

  /**
   * Crear un respaldo completo de todos los datos
   */
  static createBackup(data) {
    const backup = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      data: {
        products: data.products || [],
        clients: data.clients || [],
        appointments: data.appointments || [],
        settings: data.settings || {},
        notifications: data.notifications || []
      },
      metadata: {
        totalProducts: (data.products || []).length,
        totalClients: (data.clients || []).length,
        totalAppointments: (data.appointments || []).length,
        createdAt: new Date().toISOString()
      }
    }

    // Guardar en localStorage
    const backupKey = `${this.backupPrefix}${backup.id}`
    localStorage.setItem(backupKey, JSON.stringify(backup))
    
    // Actualizar índice de respaldos
    this.updateBackupIndex(backup.id)
    
    return backup
  }

  /**
   * Actualizar índice de respaldos
   */
  static updateBackupIndex(backupId) {
    const index = JSON.parse(localStorage.getItem('zenday_backups_index') || '[]')
    if (!index.includes(backupId)) {
      index.push(backupId)
      localStorage.setItem('zenday_backups_index', JSON.stringify(index))
    }
  }

  /**
   * Obtener todos los respaldos disponibles
   */
  static getBackups() {
    const index = JSON.parse(localStorage.getItem('zenday_backups_index') || '[]')
    const backups = []
    
    for (const id of index) {
      const backup = localStorage.getItem(`${this.backupPrefix}${id}`)
      if (backup) {
        backups.push(JSON.parse(backup))
      }
    }
    
    return backups.sort((a, b) => b.id - a.id)
  }

  /**
   * Restaurar un respaldo específico
   */
  static restoreBackup(backupId, setDataFunctions) {
    const backupKey = `${this.backupPrefix}${backupId}`
    const backupData = localStorage.getItem(backupKey)
    
    if (!backupData) {
      throw new Error('Respaldo no encontrado')
    }
    
    const backup = JSON.parse(backupData)
    
    // Restaurar datos
    if (setDataFunctions.setProducts && backup.data.products) {
      setDataFunctions.setProducts(backup.data.products)
    }
    
    if (setDataFunctions.setClients && backup.data.clients) {
      setDataFunctions.setClients(backup.data.clients)
    }
    
    if (setDataFunctions.setAppointments && backup.data.appointments) {
      setDataFunctions.setAppointments(backup.data.appointments)
    }
    
    if (setDataFunctions.setSettings && backup.data.settings) {
      setDataFunctions.setSettings(backup.data.settings)
    }
    
    return backup
  }

  /**
   * Exportar respaldo como archivo JSON
   */
  static exportBackupToFile(backupId) {
    const backupKey = `${this.backupPrefix}${backupId}`
    const backupData = localStorage.getItem(backupKey)
    
    if (!backupData) {
      throw new Error('Respaldo no encontrado')
    }
    
    const backup = JSON.parse(backupData)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backup_${new Date(backup.id).toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    
    return backup
  }

  /**
   * Importar respaldo desde archivo
   */
  static importBackupFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = (e) => {
        try {
          const backup = JSON.parse(e.target.result)
          
          // Validar estructura del respaldo
          if (!backup.id || !backup.timestamp || !backup.data) {
            throw new Error('Archivo de respaldo inválido')
          }
          
          // Guardar el respaldo importado
          const backupKey = `${this.backupPrefix}${backup.id}`
          localStorage.setItem(backupKey, JSON.stringify(backup))
          this.updateBackupIndex(backup.id)
          
          resolve(backup)
        } catch (error) {
          reject(error)
        }
      }
      
      reader.onerror = () => reject(new Error('Error al leer el archivo'))
      reader.readAsText(file)
    })
  }

  /**
   * Eliminar un respaldo
   */
  static deleteBackup(backupId) {
    const backupKey = `${this.backupPrefix}${backupId}`
    localStorage.removeItem(backupKey)
    
    // Actualizar índice
    const index = JSON.parse(localStorage.getItem('zenday_backups_index') || '[]')
    const newIndex = index.filter(id => id !== backupId)
    localStorage.setItem('zenday_backups_index', JSON.stringify(newIndex))
  }

  /**
   * Crear respaldo automático (cada X tiempo)
   */
  static setupAutoBackup(intervalHours = 24, data) {
    const lastBackup = localStorage.getItem('zenday_last_auto_backup')
    const now = Date.now()
    
    if (!lastBackup || (now - parseInt(lastBackup)) > intervalHours * 60 * 60 * 1000) {
      this.createBackup(data)
      localStorage.setItem('zenday_last_auto_backup', now.toString())
      return true
    }
    return false
  }
}