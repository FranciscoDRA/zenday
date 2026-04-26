// src/hooks/useAutoBackup.js

import { useEffect, useRef } from 'react'
import { BackupService } from '../services/backupService'

export function useAutoBackup(data, intervalHours = 24) {
  const dataRef = useRef(data)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    const interval = setInterval(() => {
      const backupCreated = BackupService.setupAutoBackup(intervalHours, dataRef.current)
      if (backupCreated) {
        console.log('✅ Respaldo automático creado')
      }
    }, 60 * 60 * 1000) // Revisar cada hora
    
    return () => clearInterval(interval)
  }, [intervalHours])
}