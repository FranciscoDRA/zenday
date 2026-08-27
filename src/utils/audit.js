// src/utils/audit.js

import { newId } from './helpers'
import { auth } from '../firebase'

// Antes esto leia localStorage['zenday-user'], una clave que NADIE escribe en
// todo el proyecto (lo unico guardado es 'zenday-user-name'). Resultado: cada
// entrada del registro salia como "Usuario desconocido" / "anonymous". Con dos
// personas compartiendo el negocio, la auditoria no servia para saber quien
// cobro, quien cambio un estado ni quien borro un paciente -- que es
// exactamente para lo que existe.
//
// La identidad real ya esta en Firebase Auth.
const getCurrentUser = () => {
  try {
    const u = auth?.currentUser
    const nombreGuardado = localStorage.getItem('zenday-user-name')
    if (!u && !nombreGuardado) return null
    return {
      name:  nombreGuardado || u?.displayName || u?.email?.split('@')[0] || 'Usuario',
      email: u?.email || '',
      id:    u?.uid || 'anonymous',   // el consumidor de abajo lee user.id
    }
  } catch {
    return null
  }
}

export const addAuditLog = async (action, type, id, details = {}) => {
  try {
    const user = getCurrentUser()
    let userName = 'Usuario desconocido'
    let userEmail = ''
    let userId = 'anonymous'
    
    if (user) {
      userEmail = user.email || ''
      userName = user.name || user.email?.split('@')[0] || 'Usuario'
      userId = user.id || user.email || 'anonymous'
    }
    
    const logEntry = {
      id: newId(),
      timestamp: new Date().toISOString(),
      user: userName,
      userEmail: userEmail,
      userId: userId,
      action,
      type,
      itemId: id,
      details,
    }
    
    const logs = JSON.parse(localStorage.getItem('zenday-audit-logs') || '[]')
    logs.unshift(logEntry)
    const trimmedLogs = logs.slice(0, 1000)
    localStorage.setItem('zenday-audit-logs', JSON.stringify(trimmedLogs))
    
    console.log('📝 Auditoría:', action, type, id, userName)
    return logEntry
  } catch (error) {
    console.error('Error en auditoría:', error)
    return null
  }
}

export const getAuditLogs = () => {
  return JSON.parse(localStorage.getItem('zenday-audit-logs') || '[]')
}

export const getUserAuditLogs = (userId) => {
  return JSON.parse(localStorage.getItem(`zenday-audit-logs-${userId}`) || '[]')
}

export const clearAuditLogs = () => {
  localStorage.removeItem('zenday-audit-logs')
  const user = getCurrentUser()
  if (user?.id) {
    localStorage.removeItem(`zenday-audit-logs-${user.id}`)
  }
}

export const deleteAuditLog = (logId) => {
  const logs = getAuditLogs()
  const filtered = logs.filter(log => log.id !== logId)
  localStorage.setItem('zenday-audit-logs', JSON.stringify(filtered))
}