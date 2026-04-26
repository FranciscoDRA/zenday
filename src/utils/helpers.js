// src/utils/helpers.js

export function todayKey() { 
  return new Date().toISOString().split('T')[0] 
}

export function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return 'Sin fecha'
  try {
    const date = new Date(dateTimeStr)
    if (isNaN(date.getTime())) return 'Fecha inválida'
    return date.toLocaleString('es-ES', { 
      day: '2-digit', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  } catch (error) {
    return 'Fecha inválida'
  }
}

export function formatTime(dateTimeStr) {
  if (!dateTimeStr) return ''
  try {
    const date = new Date(dateTimeStr)
    if (isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  } catch (error) {
    return ''
  }
}

export function formatCurrency(amount, currency = 'UYU') {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0'
  return new Intl.NumberFormat('es-UY', { 
    style: 'currency', 
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

export function calculateDuration(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return Math.round((endDate - startDate) / 60000)
}

export function hasConflict(appointments, newAppointment, excludeId = null) {
  const newStart = new Date(newAppointment.startTime)
  const newEnd = new Date(newAppointment.endTime)
  return appointments.some(apt => {
    if (excludeId && apt.id === excludeId) return false
    if (apt.status === 'cancelled') return false
    const aptStart = new Date(apt.startTime)
    const aptEnd = new Date(apt.endTime)
    return newStart < aptEnd && newEnd > aptStart
  })
}

export function hasAnyConflict(appointments, newAppointments) {
  for (const apt of newAppointments) {
    if (hasConflict(appointments, apt)) return true
  }
  return false
}

export function playDone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(523, ctx.currentTime)
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch (e) { 
    console.log('Audio not supported') 
  }
}

export function announceToScreenReader(message) {
  const el = document.createElement('div')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  el.className = 'sr-only'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1000)
}

export function generateRecurringAppointments(baseAppointment, recurrence, endDate, maxOccurrences = 10, RECURRENCE_TYPES) {
  if (recurrence === 'none' || !recurrence) return [baseAppointment]
  const appointments = [baseAppointment]
  const config = RECURRENCE_TYPES[recurrence]
  if (!config || config.interval === 0) return [baseAppointment]
  
  const startDate = new Date(baseAppointment.startTime)
  const duration = new Date(baseAppointment.endTime) - startDate
  const endDateTime = endDate ? new Date(endDate) : null
  const maxOcc = maxOccurrences || 52
  
  for (let i = 1; i < maxOcc; i++) {
    const nextStart = new Date(startDate)
    nextStart.setDate(startDate.getDate() + (config.interval * i))
    
    if (endDateTime && nextStart > endDateTime) break
    if (nextStart > new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate())) break
    
    const nextEnd = new Date(nextStart.getTime() + duration)
    
    appointments.push({
      ...baseAppointment,
      id: Date.now() + (i * 1000) + Math.random() * 1000,
      startTime: nextStart.toISOString(),
      endTime: nextEnd.toISOString(),
      parentId: baseAppointment.id,
      recurrenceInstance: i + 1,
      recurrenceType: recurrence,
      recurrenceGroupId: baseAppointment.recurrenceGroupId || baseAppointment.id,
    })
  }
  return appointments
}