// src/utils/audit.js

// Función para obtener el usuario actual desde localStorage
const getCurrentUser = () => {
  try {
    const userData = localStorage.getItem('zenday-user')
    return userData ? JSON.parse(userData) : null
  } catch (error) {
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
      id: Date.now(),
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