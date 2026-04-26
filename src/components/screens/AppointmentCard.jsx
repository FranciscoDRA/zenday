import React, { useState, useEffect, useCallback, useMemo, useReducer, useRef } from 'react'
import './App.css'
import './Splash.css'

// Contexts
import { ToastProvider, useToast } from './contexts/ToastContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { NotificationProvider, useNotifications } from './contexts/NotificationContext'
import { ReminderProvider, useReminders } from './contexts/ReminderContext'

// Hooks
import { useNavigator } from './hooks/useNavigator'
import { useHistory } from './hooks/useHistory'

// Utils
import { DEFAULT_CONSULTATION_CONFIG, USER_MODES } from './utils/constants'
import { hasConflict, hasAnyConflict, playDone, formatCurrency } from './utils/helpers'
import { addAuditLog } from './utils/audit'

// Layout
import { WindowControls } from './components/common/WindowControls'
import { Sidebar } from './components/layout/Sidebar'
import { GlobalSearch } from './components/common/GlobalSearch'
import { NotificationCenter } from './components/common/NotificationCenter'
import { BackupManager } from './components/common/BackupManager'
import { ReminderPanel } from './components/common/ReminderPanel'

// Screens
import { DashboardScreen } from './components/screens/DashboardScreen'
import { AgendaScreen } from './components/screens/AgendaScreen'
import { NewAppointmentScreen } from './components/screens/NewAppointmentScreen'
import { AppointmentDetailScreen } from './components/screens/AppointmentDetailScreen'
import { PatientsScreen } from './components/screens/PatientsScreen'
import { PatientDetailScreen } from './components/screens/PatientDetailScreen'
import { KanbanScreen } from './components/screens/KanbanScreen'
import { FinancialScreen } from './components/screens/FinancialScreen'
import { PendingPaymentsScreen } from './components/screens/PendingPaymentsScreen'
import { ProductsScreen } from './components/screens/ProductsScreen'
import { ExpensesScreen } from './components/screens/ExpensesScreen'
import { SettingsScreen } from './components/screens/SettingsScreen'
import { AuditLogScreen } from './components/screens/AuditLogScreen'
import EmprendedorPanel from './components/screens/EmprendedorPanel.jsx'
import { ReportsScreen } from './components/screens/ReportsScreen'
import { LicenseScreen } from './components/screens/licenseScreen.jsx'

// Reducer
import { appointmentsReducer } from './reducers/appointmentsReducer'

// ========== FUNCIÓN PARA OBTENER CLAVES SEGÚN MODO ==========
const getStorageKey = (baseKey, mode) => {
  return `zenday-${mode}-${baseKey}`
}

// ========== FUNCIÓN DE REPARACIÓN DE CLIENTES ==========
function repairPatientsData(mode) {
  try {
    const key = getStorageKey('patients', mode)
    const patients = JSON.parse(localStorage.getItem(key) || '[]')
    if (patients.length === 0) return []
    
    const unique = []
    const seen = new Set()
    
    patients.forEach(p => {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        if (!p.kanbanStatus) p.kanbanStatus = 'prospect'
        unique.push(p)
      } else {
        const newId = Date.now() + Math.floor(Math.random() * 100000)
        const newP = { ...p, id: String(newId) }
        if (!newP.kanbanStatus) newP.kanbanStatus = 'prospect'
        unique.push(newP)
      }
    })
    
    if (unique.length !== patients.length) {
      localStorage.setItem(key, JSON.stringify(unique))
    }
    
    return unique
  } catch (error) {
    return []
  }
}

// ========== FUNCIÓN DE REPARACIÓN DE PRODUCTOS Y PEDIDOS ==========
function repairProductsAndAppointments(mode) {
  try {
    const productsKey = getStorageKey('products', mode)
    const products = JSON.parse(localStorage.getItem(productsKey) || '[]')
    
    // Solo reparar si es necesario (si hay IDs que no son string)
    const needsRepair = products.some(p => typeof p.id !== 'string' || typeof p.stock !== 'number')
    
    if (needsRepair) {
      const fixedProducts = products.map(p => ({
        ...p,
        id: String(p.id),
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0
      }))
      localStorage.setItem(productsKey, JSON.stringify(fixedProducts))
      console.log(`✅ Productos reparados para modo ${mode}:`, fixedProducts.length)
    }
    
    const appointmentsKey = getStorageKey('appointments', mode)
    const appointments = JSON.parse(localStorage.getItem(appointmentsKey) || '[]')
    
    // Solo reparar si es necesario
    const needsAppointmentsRepair = appointments.some(a => a.productId && typeof a.productId !== 'string')
    
    if (needsAppointmentsRepair) {
      const fixedAppointments = appointments.map(a => ({
        ...a,
        productId: a.productId ? String(a.productId) : a.productId
      }))
      localStorage.setItem(appointmentsKey, JSON.stringify(fixedAppointments))
      console.log(`✅ Pedidos reparados para modo ${mode}:`, fixedAppointments.length)
    }
    
    console.log(`📊 Datos verificados para modo ${mode}:`, products.length, 'productos,', appointments.length, 'pedidos')
  } catch (error) {
    console.error('Error reparando datos:', error)
  }
}

// ─── SPLASH ─────────────────────────────────────────────────────────
function Splash({ onFinish }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300)
    const t2 = setTimeout(() => setPhase(2), 900)
    const t3 = setTimeout(() => setPhase(3), 1600)
    const t4 = setTimeout(() => onFinish(), 2400)
    return () => [t1, t2, t3, t4].forEach(clearTimeout)
  }, [onFinish])

  return (
    <div className={`splash ${phase >= 1 ? 'splash-in' : ''} ${phase >= 3 ? 'splash-out' : ''}`}>
      <div className="splash-bg" />
      <div className={`splash-content ${phase >= 1 ? 'visible' : ''}`}>
        <div className={`splash-icon ${phase >= 2 ? 'icon-in' : ''}`}>
          <svg viewBox="0 0 80 80" fill="none">
            <rect width="80" height="80" rx="20" fill="url(#grad)" />
            <circle cx="40" cy="38" r="18" stroke="white" strokeWidth="3.5" />
            <path d="M30 38L37 45L52 30" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="grad">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className={`splash-text ${phase >= 2 ? 'text-in' : ''}`}>
          <h1 className="splash-title">ZenDay</h1>
          <p className="splash-subtitle">Encuentra tu flow</p>
        </div>
        <div className={`splash-loader ${phase >= 2 ? 'loader-in' : ''}`}>
          <div className="splash-bar">
            <div className={`splash-bar-fill ${phase >= 2 ? 'fill-animate' : ''}`} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────
function AppContent() {
  const toast = useToast()
  const { addNotification } = useNotifications()
  const { addReminder } = useReminders()
  
  // ========== ESTADO DE LICENCIA ==========
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseChecked, setLicenseChecked] = useState(false)
  
  const [showSplash, setShowSplash] = useState(true)
  const [theme, setTheme] = useState('violet')
  const [appointments, dispatch] = useReducer(appointmentsReducer, [])
  const [patients, setPatients] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [darkMode, setDark] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [activeTab, setActiveTab] = useState('dashboard')
  const [userMode, setUserMode] = useState(() => localStorage.getItem('zenday-user-mode') || 'professional')
  const [workingHours, setWorkingHours] = useState(() => JSON.parse(localStorage.getItem(getStorageKey('working-hours', localStorage.getItem('zenday-user-mode') || 'professional'))) || { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' })
  const [consultationConfig, setConsultationConfig] = useState(() => JSON.parse(localStorage.getItem(getStorageKey('consultation-config', localStorage.getItem('zenday-user-mode') || 'professional'))) || DEFAULT_CONSULTATION_CONFIG)
  
  const nav = useNavigator()
  const { state: historyState, setState: setHistoryState } = useHistory(appointments)

  const initialNotificationsSent = useRef(false)
  const lowStockNotified = useRef(new Set())
  const outOfStockNotified = useRef(new Set())
  const todayNotified = useRef(false)
  
  // ✅ REF PARA CONTROLAR CARGA ÚNICA POR MODO
  const dataLoadedForMode = useRef({})

  // ========== useEffect DE LICENCIA ==========
  useEffect(() => {
    if (window.electronAPI?.checkLicense) {
      window.electronAPI.checkLicense().then(status => {
        setLicenseStatus(status)
        setLicenseChecked(true)
        if (status.status === 'active' && status.plan && status.plan !== 'master') {
          const mode = status.plan === 'entrepreneur' ? 'entrepreneur' : 'professional'
          setUserMode(mode)
          localStorage.setItem('zenday-user-mode', mode)
        }
      })
    } else {
      setLicenseChecked(true)
    }
  }, [])

  // ========== useEffect PARA CARGAR DATOS SEGÚN MODO ==========
  useEffect(() => {
    // ✅ Evitar recargar si ya cargamos para este modo
    if (dataLoadedForMode.current[userMode]) {
      console.log('⏩ Datos ya cargados para modo:', userMode)
      return
    }
    
    localStorage.setItem('zenday-user-mode', userMode)
    
    const loadDataForMode = () => {
      // ✅ Esta función ahora no sobreescribe datos correctos
      repairProductsAndAppointments(userMode)
      
      const appointmentsKey = getStorageKey('appointments', userMode)
      const patientsKey = getStorageKey('patients', userMode)
      const productsKey = getStorageKey('products', userMode)
      const expensesKey = getStorageKey('expenses', userMode)
      const workingHoursKey = getStorageKey('working-hours', userMode)
      const configKey = getStorageKey('consultation-config', userMode)
      
      const savedAppointments = JSON.parse(localStorage.getItem(appointmentsKey) || '[]')
      if (savedAppointments.length) {
        dispatch({ type: 'SET_APPOINTMENTS', payload: savedAppointments })
        setHistoryState(savedAppointments, false)
      } else {
        dispatch({ type: 'SET_APPOINTMENTS', payload: [] })
        setHistoryState([], false)
      }
      
      setPatients(repairPatientsData(userMode))
      setProducts(JSON.parse(localStorage.getItem(productsKey) || '[]'))
      setExpenses(JSON.parse(localStorage.getItem(expensesKey) || '[]'))
      
      const savedWorkingHours = JSON.parse(localStorage.getItem(workingHoursKey))
      if (savedWorkingHours) setWorkingHours(savedWorkingHours)
      
      const savedConfig = JSON.parse(localStorage.getItem(configKey))
      if (savedConfig) setConsultationConfig(savedConfig)
      
      // ✅ Marcar como cargado
      dataLoadedForMode.current[userMode] = true
      setLoaded(true)
    }
    
    loadDataForMode()
  }, [userMode, setHistoryState])

  // ========== MANEJAR ACTIVACIÓN DE LICENCIA (desde LicenseScreen) ==========
  const handleActivateLicense = async (licenseKey) => {
    if (!licenseKey) {
      setLicenseStatus(prev => ({ ...prev, status: 'trial' }))
      return
    }

    try {
      if (window.electronAPI && window.electronAPI.activateLicense) {
        const result = await window.electronAPI.activateLicense(licenseKey)
        if (result.success) {
          let mode
          if (result.plan === 'master') {
            mode = localStorage.getItem('zenday-user-mode') || 'professional'
          } else {
            mode = result.plan === 'entrepreneur' ? 'entrepreneur' : 'professional'
          }
          setUserMode(mode)
          setLicenseStatus({ status: 'active', plan: result.plan })
          toast.addToast(`✅ Licencia activada: ${result.plan === 'master' ? 'MASTER' : (result.plan === 'professional' ? 'Profesional' : 'Emprendedor')}`, 'success')
          return true
        } else {
          toast.addToast(result.message || '❌ Licencia inválida', 'error')
          return false
        }
      }
    } catch (error) {
      toast.addToast('❌ Error al activar licencia', 'error')
      return false
    }
  }

  // ========== FUNCIONES PARA GESTIÓN DE LICENCIA DESDE SETTINGS ==========
  const handleDeactivateLicense = async () => {
    try {
      if (window.electronAPI?.deleteLicense) {
        await window.electronAPI.deleteLicense()
        const status = await window.electronAPI.checkLicense()
        setLicenseStatus(status)
        toast.addToast('✅ Licencia desactivada. Volviste al modo de prueba.', 'success')
        setTimeout(() => window.location.reload(), 1000)
        return { success: true }
      }
      return { success: false }
    } catch (error) {
      toast.addToast('❌ Error al desactivar la licencia', 'error')
      return { success: false }
    }
  }

  const handleActivateLicenseFromSettings = async (licenseKey) => {
    try {
      if (window.electronAPI?.activateLicense) {
        const result = await window.electronAPI.activateLicense(licenseKey)
        if (result.success) {
          let mode
          if (result.plan === 'master') {
            mode = localStorage.getItem('zenday-user-mode') || 'professional'
          } else {
            mode = result.plan === 'entrepreneur' ? 'entrepreneur' : 'professional'
          }
          
          setUserMode(mode)
          localStorage.setItem('zenday-user-mode', mode)
          
          const status = await window.electronAPI.checkLicense()
          setLicenseStatus(status)
          
          toast.addToast(`✅ Licencia activada: ${result.plan === 'master' ? 'MASTER (puedes cambiar de modo)' : (result.plan === 'professional' ? 'Profesional' : 'Emprendedor')}`, 'success')
          setTimeout(() => window.location.reload(), 1000)
          return { success: true, plan: result.plan }
        } else {
          toast.addToast(result.message || '❌ Licencia inválida', 'error')
          return { success: false, message: result.message }
        }
      }
      return { success: false, message: 'No se pudo conectar con el sistema de licencias' }
    } catch (error) {
      toast.addToast('❌ Error al activar licencia', 'error')
      return { success: false, message: error.message }
    }
  }

  // 👈 FUNCIÓN PARA CREAR RECORDATORIO DE PAGO CON WHATSAPP
  const createPaymentReminder = useCallback((appointment) => {
    const reminderDate = new Date(appointment.startTime)
    reminderDate.setDate(reminderDate.getDate() - 1)
    
    let patient = null
    if (appointment.patientId) {
      patient = patients.find(p => p.id === appointment.patientId)
    }
    if (!patient && appointment.patientName) {
      patient = patients.find(p => p.name === appointment.patientName)
    }
    
    addReminder({
      title: `💰 Pago pendiente: ${appointment.patientName}`,
      message: `Monto: ${formatCurrency(appointment.price, 'UYU')}`,
      type: 'payment',
      reminderTime: reminderDate.toISOString(),
      relatedId: appointment.id,
      relatedType: 'appointment',
      priority: 'high',
      repeat: 'none',
      sendWhatsApp: true,
      clientPhone: patient?.phone || null,
      clientName: appointment.patientName
    })
  }, [addReminder, patients])

  // 👈 FUNCIÓN PARA CREAR RECORDATORIO DE REUNIÓN CON WHATSAPP
  const createMeetingReminder = useCallback((appointment) => {
    const reminderDate = new Date(appointment.startTime)
    reminderDate.setHours(reminderDate.getHours() - 1)
    
    let patient = null
    if (appointment.patientId) {
      patient = patients.find(p => p.id === appointment.patientId)
    }
    if (!patient && appointment.patientName) {
      patient = patients.find(p => p.name === appointment.patientName)
    }
    
    addReminder({
      title: `📅 Reunión: ${appointment.patientName}`,
      message: `Tienes una reunión programada a las ${new Date(appointment.startTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
      type: 'meeting',
      reminderTime: reminderDate.toISOString(),
      relatedId: appointment.id,
      relatedType: 'appointment',
      priority: 'normal',
      repeat: 'none',
      sendWhatsApp: true,
      clientPhone: patient?.phone || null,
      clientName: appointment.patientName
    })
  }, [addReminder, patients])

  // 👈 FUNCIÓN PARA CREAR RECORDATORIO CON CONFIGURACIÓN PERSONALIZADA
  const createCustomReminder = useCallback((appointment, reminderConfig) => {
    if (!reminderConfig) return null
    
    const reminderDate = new Date(appointment.startTime)
    reminderDate.setHours(reminderDate.getHours() - reminderConfig.reminderTime)
    
    let patient = null
    if (appointment.patientId) {
      patient = patients.find(p => p.id === appointment.patientId)
    }
    if (!patient && appointment.patientName) {
      patient = patients.find(p => p.name === appointment.patientName)
    }
    
    let message = ''
    const dateStr = new Date(appointment.startTime).toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
    const timeStr = new Date(appointment.startTime).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit'
    })
    
    if (appointment.type === 'meeting' || reminderConfig.type === 'meeting') {
      message = `📅 *RECORDATORIO DE REUNIÓN*\n\nHola ${appointment.patientName},\n\nTe recordamos tu reunión programada para el ${dateStr} a las ${timeStr}.\n\n`
      if (appointment.location) {
        message += `📍 Ubicación: ${appointment.location}\n\n`
      }
      if (appointment.meetingLink) {
        message += `🔗 Enlace de reunión: ${appointment.meetingLink}\n\n`
      }
    } else if (appointment.type === 'payment' || reminderConfig.type === 'payment') {
      message = `💰 *RECORDATORIO DE PAGO*\n\nHola ${appointment.patientName},\n\nTe recordamos que tienes un pago pendiente de ${formatCurrency(appointment.price, 'UYU')}.\n\n`
    } else {
      message = `📌 *${reminderConfig.title || appointment.title || 'Recordatorio'}*\n\nHola ${appointment.patientName},\n\n${reminderConfig.message || appointment.description || 'Te recordamos tu compromiso programado.'}\n\n`
    }
    
    if (reminderConfig.customMessage) {
      message += `📝 *Nota adicional:* ${reminderConfig.customMessage}\n\n`
    }
    
    message += `---\n📱 Enviado desde *ZenDay*`
    
    const sendWhatsApp = reminderConfig.channel === 'whatsapp' || reminderConfig.channel === 'both'
    const sendEmail = reminderConfig.channel === 'email' || reminderConfig.channel === 'both'
    
    const reminder = {
      title: `${reminderConfig.type === 'payment' ? '💰' : '📅'} ${reminderConfig.type === 'payment' ? 'Pago pendiente' : 'Reunión'}: ${appointment.patientName}`,
      message: message,
      type: reminderConfig.type === 'payment' ? 'payment' : 'meeting',
      reminderTime: reminderDate.toISOString(),
      relatedId: appointment.id,
      relatedType: 'appointment',
      priority: reminderConfig.reminderTime <= 1 ? 'high' : 'normal',
      repeat: 'none',
      sendWhatsApp: sendWhatsApp,
      sendEmail: sendEmail,
      clientPhone: sendWhatsApp ? (patient?.phone || null) : null,
      clientEmail: sendEmail ? (patient?.email || null) : null,
      clientName: appointment.patientName,
      meetingLink: appointment.meetingLink || null,
      location: appointment.location || null,
      reminderLabel: reminderConfig.reminderLabel
    }
    
    addReminder(reminder)
    toast.addToast(`✅ Recordatorio configurado: ${reminderConfig.reminderLabel} por ${reminderConfig.channel === 'both' ? 'WhatsApp y Email' : reminderConfig.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}`, 'success')
    
    return reminder
  }, [addReminder, patients, toast])

  // NOTIFICACIONES INICIALES
  useEffect(() => {
    if (loaded && !initialNotificationsSent.current) {
      initialNotificationsSent.current = true
      
      // Protección: asegurar que products es un array
      const safeProducts = Array.isArray(products) ? products : []
      const safeAppointments = Array.isArray(appointments) ? appointments : []
      
      const lowStock = safeProducts.filter(p => p.stock > 0 && p.stock < 5)
      const outOfStock = safeProducts.filter(p => p.stock === 0)
      
      outOfStock.forEach(p => {
        if (!outOfStockNotified.current.has(p.id)) {
          outOfStockNotified.current.add(p.id)
          addNotification('error', `⚠️ SIN STOCK`, `${p.name} se ha agotado`, { screen: 'products' })
        }
      })
      
      lowStock.forEach(p => {
        if (!lowStockNotified.current.has(p.id)) {
          lowStockNotified.current.add(p.id)
          addNotification('warning', `📦 Stock bajo`, `${p.name}: quedan ${p.stock} unidades`, { screen: 'products' })
        }
      })
      
      const today = new Date().toDateString()
      const todayApps = safeAppointments.filter(a => new Date(a.startTime).toDateString() === today)
      
      if (todayApps.length > 0 && !todayNotified.current) {
        todayNotified.current = true
        addNotification('info', `📅 Agenda de hoy`, `${todayApps.length} cita(s) programadas para hoy`, { screen: 'agenda' })
      }
    }
  }, [loaded, products, appointments, addNotification])

  // Persistencia de configuración
  useEffect(() => {
    const key = getStorageKey('working-hours', userMode)
    localStorage.setItem(key, JSON.stringify(workingHours))
  }, [workingHours, userMode])
  
  useEffect(() => {
    const key = getStorageKey('consultation-config', userMode)
    localStorage.setItem(key, JSON.stringify(consultationConfig))
  }, [consultationConfig, userMode])
  
  useEffect(() => { 
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('zenday-theme', theme) 
  }, [theme])
  
  // Persistencia de datos
  useEffect(() => { 
    if (!loaded) return
    const key = getStorageKey('appointments', userMode)
    localStorage.setItem(key, JSON.stringify(appointments)) 
  }, [appointments, loaded, userMode])
  
  useEffect(() => { 
    if (!loaded) return
    const key = getStorageKey('patients', userMode)
    localStorage.setItem(key, JSON.stringify(patients)) 
  }, [patients, loaded, userMode])
  
  useEffect(() => { 
    if (!loaded) return
    const key = getStorageKey('products', userMode)
    localStorage.setItem(key, JSON.stringify(products)) 
  }, [products, loaded, userMode])
  
  useEffect(() => { 
    if (!loaded) return
    const key = getStorageKey('expenses', userMode)
    localStorage.setItem(key, JSON.stringify(expenses)) 
  }, [expenses, loaded, userMode])
  
  useEffect(() => { 
    document.body.classList.toggle('dark', darkMode) 
  }, [darkMode])
  
  // Notificaciones del sistema
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // ========== ACCIONES ==========
  const addAppointment = useCallback((data) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    
    if (hasConflict(safeAppointments, data)) {
      addNotification('warning', '⚠️ Conflicto de horario', 'Ya existe una cita en ese horario')
      return false
    }
    const n = { id: Date.now(), ...data, createdAt: new Date().toISOString() }
    dispatch({ type: 'ADD_APPOINTMENT', payload: n })
    setHistoryState([...safeAppointments, n])
    playDone()
    addAuditLog('CREAR', 'Pedido', n.id, { patient: data.patientName })
    
    addNotification('success', '✅ Cita creada', `Cita con ${data.patientName} agendada correctamente`, { screen: 'agenda' })
    
    if (data.price > 0 && !data.paid) {
      createPaymentReminder(n)
    }
    createMeetingReminder(n)
    
    return true
  }, [appointments, setHistoryState, addNotification, createPaymentReminder, createMeetingReminder])

  const addMultipleAppointments = useCallback((data) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    if (hasAnyConflict(safeAppointments, data)) return false
    dispatch({ type: 'ADD_MULTIPLE_APPOINTMENTS', payload: data })
    setHistoryState([...safeAppointments, ...data])
    playDone()
    addNotification('success', '✅ Citas múltiples', `${data.length} citas agregadas correctamente`, { screen: 'agenda' })
    
    data.forEach(appointment => {
      if (appointment.price > 0 && !appointment.paid) {
        createPaymentReminder(appointment)
      }
      createMeetingReminder(appointment)
    })
    
    return true
  }, [appointments, setHistoryState, addNotification, createPaymentReminder, createMeetingReminder])

  const updateAppointment = useCallback((id, upd) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const updated = safeAppointments.map(a => a.id === id ? { ...a, ...upd } : a)
    dispatch({ type: 'UPDATE_APPOINTMENT', id, payload: upd })
    setHistoryState(updated)
    addAuditLog('REPROGRAMAR', 'Pedido', id, { changes: upd })
    toast.addToast('✅ Cita reprogramada', 'success')
    addNotification('info', '🔄 Cita reprogramada', `La cita ha sido modificada`, { screen: 'agenda' })
    return true
  }, [appointments, setHistoryState, toast, addNotification])

  const updateStatus = useCallback((id, newStatus) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const appointment = safeAppointments.find(a => a.id === id)
    if (!appointment) return
    
    const oldStatus = appointment.status
    
    dispatch({ type: 'UPDATE_STATUS', id, status: newStatus })
    setHistoryState(safeAppointments.map(a => a.id === id ? { ...a, status: newStatus } : a))
    addAuditLog('CAMBIAR_ESTADO', 'Pedido', id, { oldStatus, newStatus })
    
    const completingStatuses = ['completed', 'delivered', 'picked']
    const wasCompleted = completingStatuses.includes(oldStatus)
    const isNowCompleted = completingStatuses.includes(newStatus)
    
    if (!wasCompleted && isNowCompleted && appointment.productId) {
      setProducts(prev => {
        const product = prev.find(p => String(p.id) === String(appointment.productId))
        if (!product) return prev
        
        const currentStock = product.stock || 0
        if (currentStock <= 0) {
          toast.addToast(`⚠️ "${product.name}" sin stock`, 'warning')
          addNotification('error', '❌ Sin stock', `No se puede completar: ${product.name} agotado`, { screen: 'products' })
          return prev
        }
        
        const newStock = currentStock - 1
        const updated = prev.map(p => String(p.id) === String(appointment.productId) ? { ...p, stock: newStock } : p)
        
        if (newStock === 0) {
          addNotification('error', `⚠️ "${product.name}" agotado`, `Stock: 0 unidades`, { screen: 'products' })
        } else if (newStock < 5) {
          addNotification('warning', `📦 Stock bajo: ${product.name}`, `Quedan ${newStock} unidades`, { screen: 'products' })
        }
        
        addNotification('success', '✅ Pedido completado', `${product.name} entregado a ${appointment.patientName}`, { screen: 'agenda' })
        
        return updated
      })
    }
    
    if (wasCompleted && !isNowCompleted && appointment.productId) {
      setProducts(prev => {
        const product = prev.find(p => String(p.id) === String(appointment.productId))
        if (!product) return prev
        
        const newStock = (product.stock || 0) + 1
        const updated = prev.map(p => String(p.id) === String(appointment.productId) ? { ...p, stock: newStock } : p)
        
        addNotification('info', '🔄 Pedido revertido', `Stock de ${product.name} restaurado a ${newStock}`, { screen: 'products' })
        
        return updated
      })
    }
  }, [appointments, setHistoryState, setProducts, toast, addNotification])

  const deleteAppointment = useCallback((id) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    dispatch({ type: 'DELETE_APPOINTMENT', id })
    setHistoryState(safeAppointments.filter(a => a.id !== id))
    addAuditLog('ELIMINAR', 'Pedido', id)
    toast.addToast('🗑️ Pedido eliminado', 'info')
    addNotification('info', '🗑️ Pedido eliminado', 'La cita ha sido eliminada', { screen: 'agenda' })
  }, [appointments, setHistoryState, toast, addNotification])

  const markAsPaid = useCallback((id) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    dispatch({ type: 'MARK_PAID', id })
    setHistoryState(safeAppointments.map(a => a.id === id ? { ...a, paid: true } : a))
    addAuditLog('PAGAR', 'Pedido', id)
    toast.addToast('💰 Pago registrado', 'success')
    addNotification('success', '💰 Pago registrado', `Pago recibido correctamente`, { screen: 'financial' })
  }, [appointments, setHistoryState, toast, addNotification])

  const addPatient = useCallback((data) => {
    const n = { 
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9), 
      ...data, 
      totalVisits: 0, 
      kanbanStatus: data.kanbanStatus || 'prospect'
    }
    setPatients(p => [...p, n])
    addAuditLog('CREAR', 'Cliente', n.id, { name: data.name })
    
    addNotification('success', '👤 Cliente agregado', `${data.name} se ha registrado correctamente`, { screen: 'patients' })
    
    return n
  }, [addNotification])

  const updatePatient = useCallback((id, upd) => {
    setPatients(p => p.map(x => x.id === id ? { ...x, ...upd } : x))
    addAuditLog('ACTUALIZAR', 'Cliente', id)
    addNotification('info', '✏️ Cliente actualizado', `Datos del cliente modificados`, { screen: 'patients' })
  }, [addNotification])

  const deletePatient = useCallback((id) => {
    const safePatients = Array.isArray(patients) ? patients : []
    const patient = safePatients.find(p => p.id === id)
    setPatients(p => p.filter(x => x.id !== id))
    addAuditLog('ELIMINAR', 'Cliente', id)
    addNotification('info', '🗑️ Cliente eliminado', `${patient?.name || 'Cliente'} ha sido eliminado`, { screen: 'patients' })
  }, [patients, addNotification])

  const todayAppointments = useMemo(() => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    return safeAppointments.filter(a => a && a.startTime && new Date(a.startTime).toDateString() === new Date().toDateString())
  }, [appointments])

  const stats = useMemo(() => {
    const safeToday = Array.isArray(todayAppointments) ? todayAppointments : []
    const safePatients = Array.isArray(patients) ? patients : []
    
    return {
      todayTotal: safeToday.length,
      todayCompleted: safeToday.filter(a => a.status === 'completed' || a.status === 'delivered').length,
      todayPending: safeToday.filter(a => ['scheduled', 'confirmed', 'pending'].includes(a.status)).length,
      revenueToday: safeToday.filter(a => (a.status === 'completed' || a.status === 'delivered') && a.paid).reduce((s, a) => s + (a.price || 0), 0),
      totalPatients: safePatients.length,
    }
  }, [todayAppointments, patients])

  const handleGlobalSearch = (result) => {
    if (result.type === 'patient') nav.navigate('patientDetail', { patientId: result.id })
    else if (result.type === 'product') nav.navigate('products')
    else nav.navigate('detail', { appointmentId: result.id })
  }

  const sharedProps = {
    appointments: Array.isArray(appointments) ? appointments : [],
    patients: Array.isArray(patients) ? patients : [],
    products: Array.isArray(products) ? products : [],
    setProducts,
    expenses: Array.isArray(expenses) ? expenses : [],
    setExpenses,
    nav,
    addAppointment,
    addMultipleAppointments,
    updateAppointment,
    updateStatus,
    deleteAppointment,
    markAsPaid,
    addPatient,
    updatePatient,
    deletePatient,
    selectedDate,
    setSelectedDate,
    workingHours,
    setWorkingHours,
    consultationConfig,
    setConsultationConfig,
    stats,
    theme,
    setTheme,
    darkMode,
    setDark,
    todayAppointments,
    userMode,
    setUserMode,
    createCustomReminder,
    licenseStatus,
    onDeactivateLicense: handleDeactivateLicense,
    onActivateLicense: handleActivateLicenseFromSettings,
    
    // ✅ VERSIÓN CORREGIDA - Soporta callback function y guarda en localStorage
    setAppointments: (newApps) => {
      console.log('📦 setAppointments llamado')
      
      // Obtener appointments actuales del estado más reciente
      const currentApps = Array.isArray(appointments) ? appointments : []
      
      // Si es una función, ejecutarla con el estado actual
      const safeNewApps = typeof newApps === 'function' 
        ? newApps(currentApps) 
        : (Array.isArray(newApps) ? newApps : [])
      
      console.log('📊 Pedidos antes:', currentApps.length, 'después:', safeNewApps.length)
      
      // ✅ GUARDAR EN LOCALSTORAGE INMEDIATAMENTE
      const appointmentsKey = getStorageKey('appointments', userMode)
      localStorage.setItem(appointmentsKey, JSON.stringify(safeNewApps))
      console.log('💾 Guardado en localStorage:', appointmentsKey, safeNewApps.length)
      
      // Actualizar estado
      dispatch({ type: 'SET_APPOINTMENTS', payload: safeNewApps })
      setHistoryState(safeNewApps)
    }
  }

  // 👇 SCREENS
  const SCREENS = {
    dashboard: DashboardScreen,
    agenda: AgendaScreen,
    patients: PatientsScreen,
    kanban: KanbanScreen,
    financial: FinancialScreen,
    pending: PendingPaymentsScreen,
    products: ProductsScreen,
    expenses: ExpensesScreen,
    settings: SettingsScreen,
    new: NewAppointmentScreen,
    detail: AppointmentDetailScreen,
    patientDetail: PatientDetailScreen,
    audit: AuditLogScreen,
    emprendedor: EmprendedorPanel,
    reports: ReportsScreen
  }

  // ========== RENDERIZADO CON VERIFICACIÓN DE LICENCIA ==========
  if (!licenseChecked) return null
  
  if (licenseStatus?.status === 'expired') {
    return (
      <LicenseScreen 
        licenseStatus={licenseStatus} 
        onActivate={handleActivateLicense} 
      />
    )
  }
  
  if (showSplash) {
    return <Splash onFinish={() => setShowSplash(false)} />
  }

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`} data-theme={theme}>
      <WindowControls />
      
      {/* BANNER DE TRIAL */}
      {licenseStatus?.status === 'trial' && (
        <div style={{
          background: licenseStatus.trialDaysLeft <= 2 
            ? 'linear-gradient(90deg, rgba(239,68,68,0.12), rgba(239,68,68,0.06))' 
            : 'linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.06))',
          borderBottom: `0.5px solid ${licenseStatus.trialDaysLeft <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
        }}>
          <span style={{ color: licenseStatus.trialDaysLeft <= 2 ? 'var(--accent-red)' : '#b45309', fontWeight: 500 }}>
            {licenseStatus.trialDaysLeft <= 2 ? '⚠️' : '⏳'} 
            {' '}Período de prueba — {licenseStatus.trialDaysLeft === 1 ? 'queda 1 día' : `quedan ${licenseStatus.trialDaysLeft} días`}
          </span>
          <button
            onClick={() => setLicenseStatus({ status: 'expired' })}
            style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '20px',
              border: '0.5px solid rgba(245,158,11,0.4)',
              background: 'transparent',
              color: '#b45309',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Activar licencia
          </button>
        </div>
      )}
      
      <div className="app-container">
        <Sidebar 
          activeTab={activeTab} 
          onSwitchTab={(t) => { setActiveTab(t); nav.goToRoot(t) }} 
          canGoBack={nav.canGoBack} 
          userMode={userMode} 
        />
        
        <main className="main-content">
          {/* Barra de herramientas SOLO para modo profesional */}
          {userMode !== 'entrepreneur' && (
            <div className="global-search-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <GlobalSearch 
                appointments={sharedProps.appointments} 
                patients={sharedProps.patients} 
                products={sharedProps.products} 
                onSelectResult={handleGlobalSearch} 
              />
              <NotificationCenter nav={nav} />
              <ReminderPanel nav={nav} patients={sharedProps.patients} />
            </div>
          )}
          
          {/* BackupManager SIEMPRE VISIBLE */}
          <div style={{ 
            display: 'flex', 
            justifyContent: userMode === 'entrepreneur' ? 'flex-end' : 'flex-start',
            marginBottom: '16px'
          }}>
            <BackupManager 
              products={sharedProps.products}
              clients={sharedProps.patients}
              appointments={sharedProps.appointments}
              expenses={sharedProps.expenses}
              settings={{ workingHours, consultationConfig }}
              setProducts={setProducts}
              setClients={setPatients}
              setAppointments={sharedProps.setAppointments}
              setExpenses={setExpenses}
              setSettings={(newSettings) => {
                if (newSettings.workingHours) setWorkingHours(newSettings.workingHours)
                if (newSettings.consultationConfig) setConsultationConfig(newSettings.consultationConfig)
              }}
            />
          </div>
          
          <div className="screens-container">
            {nav.stack.map((id, i) => {
              const S = SCREENS[id]
              if (!S) return null
              return (
                <div key={i} className={`screen ${i === nav.stack.length - 1 ? 'active' : ''}`}>
                  <S {...sharedProps} params={nav.params[id] || {}} />
                </div>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}

// ─── EXPORT DEFAULT ───────────────────────────────────────────────────
export default function App() {
  return (
    <ToastProvider>
      <NotificationProvider>
        <ReminderProvider>
          <ConfirmProvider>        
            <AppContent />
          </ConfirmProvider>       
        </ReminderProvider>
      </NotificationProvider>
    </ToastProvider>
  )
}