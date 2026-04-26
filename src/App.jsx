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
import { useSyncListener } from './hooks/useSyncListener'

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
import { PersonalAgendaScreen } from './components/screens/PersonalAgendaScreen'

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
    
    const needsRepair = products.some(p => typeof p.id !== 'string' || typeof p.stock !== 'number')
    if (needsRepair) {
      const fixedProducts = products.map(p => ({
        ...p,
        id: String(p.id),
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0
      }))
      localStorage.setItem(productsKey, JSON.stringify(fixedProducts))
    }
    
    const appointmentsKey = getStorageKey('appointments', mode)
    const appointments = JSON.parse(localStorage.getItem(appointmentsKey) || '[]')
    
    const needsAppointmentsRepair = appointments.some(a => a.productId && typeof a.productId !== 'string')
    if (needsAppointmentsRepair) {
      const fixedAppointments = appointments.map(a => ({
        ...a,
        productId: a.productId ? String(a.productId) : a.productId
      }))
      localStorage.setItem(appointmentsKey, JSON.stringify(fixedAppointments))
    }
  } catch (error) {
    console.error('Error reparando datos:', error)
  }
}

// ========== MIGRACIÓN: agregar deliveredAt a pedidos entregados ==========
function migrateDeliveredAt(mode) {
  try {
    const key = `zenday-${mode}-appointments`
    const appointments = JSON.parse(localStorage.getItem(key) || '[]')
    
    let changed = false
    const completingStatuses = ['completed', 'delivered', 'picked']
    
    const migrated = appointments.map(a => {
      if (a.deliveredAt) return a  // ya tiene el campo, no tocar
      
      if (completingStatuses.includes(a.status)) {
        changed = true
        return {
          ...a,
          deliveredAt: a.paymentDate || a.startTime
        }
      }
      
      return a
    })
    
    if (changed) {
      localStorage.setItem(key, JSON.stringify(migrated))
      console.log(`[Migration] deliveredAt migrado para modo ${mode}`)
    }
  } catch (err) {
    console.error('[Migration] Error en migrateDeliveredAt:', err)
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
  const [updateReady, setUpdateReady] = useState(false)  // ← estado para actualización
  
  const [showSplash, setShowSplash] = useState(true)
  const [theme, setTheme] = useState('violet')
  const [appointments, dispatch] = useReducer(appointmentsReducer, [])
  const [patientsPro, setPatientsPro] = useState([])       // modo professional
  const [patientsEnt, setPatientsEnt] = useState([])       // modo entrepreneur
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [darkMode, setDark] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [activeTab, setActiveTab] = useState('dashboard')
  const [userMode, setUserMode] = useState(() => localStorage.getItem('zenday-user-mode') || 'professional')
  const [workingHours, setWorkingHours] = useState(() => JSON.parse(localStorage.getItem(getStorageKey('working-hours', localStorage.getItem('zenday-user-mode') || 'professional'))) || { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' })
  const [consultationConfig, setConsultationConfig] = useState(() => JSON.parse(localStorage.getItem(getStorageKey('consultation-config', localStorage.getItem('zenday-user-mode') || 'professional'))) || DEFAULT_CONSULTATION_CONFIG)

  // Obtener pacientes según el modo actual
  const patients = userMode === 'entrepreneur' ? patientsEnt : patientsPro

  const nav = useNavigator()
  const { state: historyState, setState: setHistoryState } = useHistory(appointments)

  // Refs para evitar stale closures y resetear notificaciones
  const initialNotificationsSent = useRef(false)
  const lowStockNotified = useRef(new Set())
  const outOfStockNotified = useRef(new Set())
  const todayNotified = useRef(false)
  const appointmentsRef = useRef(appointments)

  // Sincronizar ref con appointments actuales
  useEffect(() => {
    appointmentsRef.current = appointments
  }, [appointments])

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

  // ========== NUEVO: ESCUCHAR ACTUALIZACIONES ==========
  useEffect(() => {
    const cleanup = window.electronAPI?.onUpdateDownloaded?.(() => {
      setUpdateReady(true)
    })
    return () => cleanup?.()
  }, [])

  // Hook de sync listener
  const { reconnect } = useSyncListener({
    products,
    setProducts,
    onChanges: (integrationName, changes, mode) => {
      changes.forEach(c => {
        addNotification(
          c.after < c.before ? 'warning' : 'success',
          `🔄 Stock actualizado — ${integrationName}`,
          `${c.name}: ${c.before} → ${c.after} uds ${mode === 'realtime' ? '(tiempo real)' : '(sync)'}`,
          { screen: 'products' }
        )
      })
    }
  })

  // ========== CORREGIDO Bug 1: setAppointmentsDirect con ref ==========
  const setAppointmentsDirect = useCallback((updater) => {
    const current = Array.isArray(appointmentsRef.current) ? appointmentsRef.current : []
    const next = typeof updater === 'function' ? updater(current) : (Array.isArray(updater) ? updater : [])
    localStorage.setItem(getStorageKey('appointments', userMode), JSON.stringify(next))
    dispatch({ type: 'SET_APPOINTMENTS', payload: next })
    setHistoryState(next)
  }, [userMode, setHistoryState])

  // ========== CORREGIDO Bug 2,3,4,5: useEffect de carga de datos ==========
  useEffect(() => {
    setLoaded(false)
    
    initialNotificationsSent.current = false
    lowStockNotified.current = new Set()
    outOfStockNotified.current = new Set()
    todayNotified.current = false
    
    localStorage.setItem('zenday-user-mode', userMode)
    
    const loadDataForMode = () => {
      console.log(`[App] Cargando datos para modo: ${userMode}`)
      
      repairProductsAndAppointments(userMode)
      migrateDeliveredAt(userMode)
      const appointmentsKey = getStorageKey('appointments', userMode)
      const productsKey     = getStorageKey('products', userMode)
      const expensesKey     = getStorageKey('expenses', userMode)
      const workingHoursKey = getStorageKey('working-hours', userMode)
      const configKey       = getStorageKey('consultation-config', userMode)
      
      // Cargar appointments
      try {
        const savedAppointments = JSON.parse(localStorage.getItem(appointmentsKey) || '[]')
        console.log(`[App] Cargados ${savedAppointments.length} appointments para ${userMode}`)
        dispatch({ type: 'SET_APPOINTMENTS', payload: savedAppointments })
        setHistoryState(savedAppointments, false)
      } catch (err) {
        console.error(`[App] Error cargando appointments para ${userMode}:`, err)
        dispatch({ type: 'SET_APPOINTMENTS', payload: [] })
        setHistoryState([], false)
      }
      
      // Cargar pacientes según modo
      try {
        if (userMode === 'entrepreneur') {
          const repairedPatients = repairPatientsData('entrepreneur')
          console.log(`[App] Cargados ${repairedPatients.length} pacientes para entrepreneur`)
          setPatientsEnt(repairedPatients)
        } else {
          const repairedPatients = repairPatientsData('professional')
          console.log(`[App] Cargados ${repairedPatients.length} pacientes para professional`)
          setPatientsPro(repairedPatients)
        }
      } catch (err) {
        console.error(`[App] Error cargando pacientes para ${userMode}:`, err)
        if (userMode === 'entrepreneur') setPatientsEnt([])
        else setPatientsPro([])
      }
      
      // Cargar productos
      try {
        const savedProducts = JSON.parse(localStorage.getItem(productsKey) || '[]')
        console.log(`[App] Cargados ${savedProducts.length} productos para ${userMode}`)
        setProducts(savedProducts)
      } catch (err) {
        console.error(`[App] Error cargando productos para ${userMode}:`, err)
        setProducts([])
      }
      
      // Cargar gastos
      try {
        const savedExpenses = JSON.parse(localStorage.getItem(expensesKey) || '[]')
        setExpenses(savedExpenses)
      } catch (err) {
        console.error(`[App] Error cargando gastos para ${userMode}:`, err)
        setExpenses([])
      }
      
      // Cargar horarios
      try {
        const savedWorkingHours = JSON.parse(localStorage.getItem(workingHoursKey))
        if (savedWorkingHours) setWorkingHours(savedWorkingHours)
      } catch (err) {
        console.error(`[App] Error cargando horarios para ${userMode}:`, err)
      }
      
      // Cargar configuración
      try {
        const savedConfig = JSON.parse(localStorage.getItem(configKey))
        if (savedConfig) setConsultationConfig(savedConfig)
      } catch (err) {
        console.error(`[App] Error cargando configuración para ${userMode}:`, err)
      }
      
      setLoaded(true)
    }
    
    loadDataForMode()
    nav.goToRoot('dashboard')
    setSelectedDate(new Date())
    
  }, [userMode])

  // ========== Persistencia ==========
  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('patients', 'professional'), JSON.stringify(patientsPro))
  }, [patientsPro, loaded])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('patients', 'entrepreneur'), JSON.stringify(patientsEnt))
  }, [patientsEnt, loaded])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('appointments', userMode), JSON.stringify(appointments))
  }, [appointments, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('products', userMode), JSON.stringify(products))
  }, [products, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('expenses', userMode), JSON.stringify(expenses))
  }, [expenses, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('working-hours', userMode), JSON.stringify(workingHours))
  }, [workingHours, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(getStorageKey('consultation-config', userMode), JSON.stringify(consultationConfig))
  }, [consultationConfig, loaded, userMode])

  // Tema y modo oscuro
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('zenday-theme', theme)
  }, [theme])

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
  }, [darkMode])

  // Pedir permisos de notificación
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Notificaciones iniciales
  useEffect(() => {
    if (loaded && !initialNotificationsSent.current) {
      initialNotificationsSent.current = true
      const safeProducts = Array.isArray(products) ? products : []
      const safeAppointments = Array.isArray(appointments) ? appointments : []
      
      safeProducts.filter(p => p.stock === 0).forEach(p => {
        if (!outOfStockNotified.current.has(p.id)) {
          outOfStockNotified.current.add(p.id)
          addNotification('error', `⚠️ SIN STOCK`, `${p.name} se ha agotado`, { screen: 'products' })
        }
      })
      
      safeProducts.filter(p => p.stock > 0 && p.stock < 5).forEach(p => {
        if (!lowStockNotified.current.has(p.id)) {
          lowStockNotified.current.add(p.id)
          addNotification('warning', `📦 Stock bajo`, `${p.name}: quedan ${p.stock} unidades`, { screen: 'products' })
        }
      })
      
      const todayApps = safeAppointments.filter(a => new Date(a.startTime).toDateString() === new Date().toDateString())
      if (todayApps.length > 0 && !todayNotified.current) {
        todayNotified.current = true
        addNotification('info', `📅 Agenda de hoy`, `${todayApps.length} cita(s) programadas para hoy`, { screen: 'agenda' })
      }
    }
  }, [loaded, products, appointments, addNotification])

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
    return true
  }, [appointments, setHistoryState, addNotification])

  const addMultipleAppointments = useCallback((data) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    if (hasAnyConflict(safeAppointments, data)) return false
    dispatch({ type: 'ADD_MULTIPLE_APPOINTMENTS', payload: data })
    setHistoryState([...safeAppointments, ...data])
    playDone()
    addNotification('success', '✅ Citas múltiples', `${data.length} citas agregadas correctamente`, { screen: 'agenda' })
    return true
  }, [appointments, setHistoryState, addNotification])

  const updateAppointment = useCallback((id, upd) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    dispatch({ type: 'UPDATE_APPOINTMENT', id, payload: upd })
    setHistoryState(safeAppointments.map(a => a.id === id ? { ...a, ...upd } : a))
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
    const wasCompleted  = completingStatuses.includes(oldStatus)
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
        if (newStock === 0)    addNotification('error',   `⚠️ "${product.name}" agotado`, `Stock: 0 unidades`, { screen: 'products' })
        else if (newStock < 5) addNotification('warning', `📦 Stock bajo: ${product.name}`, `Quedan ${newStock} unidades`, { screen: 'products' })
        addNotification('success', '✅ Pedido completado', `${product.name} entregado a ${appointment.patientName}`, { screen: 'agenda' })
        return prev.map(p => String(p.id) === String(appointment.productId) ? { ...p, stock: newStock } : p)
      })
    }
    if (wasCompleted && !isNowCompleted && appointment.productId) {
      setProducts(prev => {
        const product = prev.find(p => String(p.id) === String(appointment.productId))
        if (!product) return prev
        const newStock = (product.stock || 0) + 1
        addNotification('info', '🔄 Pedido revertido', `Stock de ${product.name} restaurado a ${newStock}`, { screen: 'products' })
        return prev.map(p => String(p.id) === String(appointment.productId) ? { ...p, stock: newStock } : p)
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
    const n = { id: Date.now() + '-' + Math.random().toString(36).substr(2, 9), ...data, totalVisits: 0, kanbanStatus: data.kanbanStatus || 'prospect' }
    if (userMode === 'entrepreneur') {
      setPatientsEnt(p => [...p, n])
    } else {
      setPatientsPro(p => [...p, n])
    }
    addAuditLog('CREAR', 'Cliente', n.id, { name: data.name })
    addNotification('success', '👤 Cliente agregado', `${data.name} se ha registrado correctamente`, { screen: 'patients' })
    return n
  }, [addNotification, userMode])

  const updatePatient = useCallback((id, upd) => {
    if (userMode === 'entrepreneur') {
      setPatientsEnt(p => p.map(x => x.id === id ? { ...x, ...upd } : x))
    } else {
      setPatientsPro(p => p.map(x => x.id === id ? { ...x, ...upd } : x))
    }
    addAuditLog('ACTUALIZAR', 'Cliente', id)
    addNotification('info', '✏️ Cliente actualizado', `Datos del cliente modificados`, { screen: 'patients' })
  }, [addNotification, userMode])

  const deletePatient = useCallback((id) => {
    if (userMode === 'entrepreneur') {
      setPatientsEnt(p => p.filter(x => x.id !== id))
    } else {
      setPatientsPro(p => p.filter(x => x.id !== id))
    }
    addAuditLog('ELIMINAR', 'Cliente', id)
    addNotification('info', '🗑️ Cliente eliminado', `Cliente eliminado`, { screen: 'patients' })
  }, [addNotification, userMode])

  // Funciones de recordatorios (simplificadas)
  const createPaymentReminder = useCallback((appointment) => {
    if (!appointment.price || appointment.paid) return
  }, [])

  const createMeetingReminder = useCallback((appointment) => {}, [])

  const createCustomReminder = useCallback((appointment, reminderConfig) => null, [])

  const todayAppointments = useMemo(() => {
    return (Array.isArray(appointments) ? appointments : [])
      .filter(a => a && a.startTime && new Date(a.startTime).toDateString() === new Date().toDateString())
  }, [appointments])

  const stats = useMemo(() => {
    const safeToday    = Array.isArray(todayAppointments) ? todayAppointments : []
    const safePatients = Array.isArray(patients)          ? patients          : []
    return {
      todayTotal:     safeToday.length,
      todayCompleted: safeToday.filter(a => ['completed','delivered'].includes(a.status)).length,
      todayPending:   safeToday.filter(a => ['scheduled','confirmed','pending'].includes(a.status)).length,
      revenueToday:   safeToday.filter(a => ['completed','delivered'].includes(a.status) && a.paid).reduce((s, a) => s + (a.price || 0), 0),
      totalPatients:  safePatients.length,
    }
  }, [todayAppointments, patients])

  // Funciones de licencia
  const handleActivateLicense = async (licenseKey) => {
    if (!licenseKey) {
      setLicenseStatus(prev => ({ ...prev, status: 'trial' }))
      return
    }
    try {
      if (window.electronAPI && window.electronAPI.activateLicense) {
        const result = await window.electronAPI.activateLicense(licenseKey)
        if (result.success) {
          const mode = result.plan === 'master'
            ? (localStorage.getItem('zenday-user-mode') || 'professional')
            : (result.plan === 'entrepreneur' ? 'entrepreneur' : 'professional')
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
          const mode = result.plan === 'master'
            ? (localStorage.getItem('zenday-user-mode') || 'professional')
            : (result.plan === 'entrepreneur' ? 'entrepreneur' : 'professional')
          setUserMode(mode)
          localStorage.setItem('zenday-user-mode', mode)
          const status = await window.electronAPI.checkLicense()
          setLicenseStatus(status)
          toast.addToast(`✅ Licencia activada: ${result.plan === 'master' ? 'MASTER' : (result.plan === 'professional' ? 'Profesional' : 'Emprendedor')}`, 'success')
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

  const handleGlobalSearch = (result) => {
    if (result.type === 'patient')  nav.navigate('patientDetail', { patientId: result.id })
    else if (result.type === 'product') nav.navigate('products')
    else nav.navigate('detail', { appointmentId: result.id })
  }

  const sharedProps = {
    appointments:          Array.isArray(appointments) ? appointments : [],
    patients:              Array.isArray(patients)     ? patients     : [],
    products:              Array.isArray(products)     ? products     : [],
    setProducts,
    expenses:              Array.isArray(expenses)     ? expenses     : [],
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
    onActivateLicense:   handleActivateLicenseFromSettings,
    setAppointments: setAppointmentsDirect,
    setAppointmentsRaw: setAppointmentsDirect,
    onIntegrationsChange: reconnect,
  }

  // SCREENS
  const SCREENS = {
    dashboard:    DashboardScreen,
    agenda:       AgendaScreen,
    personal:     PersonalAgendaScreen,
    patients:     PatientsScreen,
    kanban:       KanbanScreen,
    financial:    FinancialScreen,
    pending:      PendingPaymentsScreen,
    products:     ProductsScreen,
    expenses:     ExpensesScreen,
    settings:     SettingsScreen,
    new:          NewAppointmentScreen,
    detail:       AppointmentDetailScreen,
    patientDetail: PatientDetailScreen,
    audit:        AuditLogScreen,
    emprendedor:  EmprendedorPanel,
    reports:      ReportsScreen,
  }

  // ========== RENDERIZADO ==========
  if (!licenseChecked) return null

  if (licenseStatus?.status === 'expired') {
    return <LicenseScreen licenseStatus={licenseStatus} onActivate={handleActivateLicense} />
  }

  if (showSplash) {
    return <Splash onFinish={() => setShowSplash(false)} />
  }

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`} data-theme={theme}>
      <WindowControls />

      {/* BANNER DE ACTUALIZACIÓN (arriba del banner de prueba) */}
      {updateReady && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))',
          borderBottom: '0.5px solid rgba(99,102,241,0.3)',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
        }}>
          <span style={{ color: '#6366f1', fontWeight: 500 }}>
            🆕 Hay una actualización lista para instalar
          </span>
          <button
            onClick={() => window.electronAPI?.installUpdate?.()}
            style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '20px',
              border: '0.5px solid rgba(99,102,241,0.4)',
              background: 'transparent',
              color: '#6366f1',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Instalar y reiniciar
          </button>
        </div>
      )}

      {/* BANNER DE TRIAL */}
      {licenseStatus?.status === 'trial' && (
        <div style={{
          background: licenseStatus.trialDaysLeft <= 2
            ? 'linear-gradient(90deg, rgba(239,68,68,0.12), rgba(239,68,68,0.06))'
            : 'linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.06))',
          borderBottom: `0.5px solid ${licenseStatus.trialDaysLeft <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
          padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px',
        }}>
          <span style={{ color: licenseStatus.trialDaysLeft <= 2 ? 'var(--accent-red)' : '#b45309', fontWeight: 500 }}>
            {licenseStatus.trialDaysLeft <= 2 ? '⚠️' : '⏳'}{' '}
            Período de prueba — {licenseStatus.trialDaysLeft === 1 ? 'queda 1 día' : `quedan ${licenseStatus.trialDaysLeft} días`}
          </span>
          <button
            onClick={() => setLicenseStatus({ status: 'expired' })}
            style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '20px', border: '0.5px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#b45309', cursor: 'pointer', fontFamily: 'inherit' }}
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
          {/* GlobalSearch condicional */}
          {userMode !== 'entrepreneur' ? (
            <div className="global-search-container" style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              marginBottom: '16px'
            }}>
              <GlobalSearch
                appointments={sharedProps.appointments}
                patients={sharedProps.patients}
                products={sharedProps.products}
                onSelectResult={handleGlobalSearch}
              />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <NotificationCenter nav={nav} userMode={userMode} />
                <ReminderPanel nav={nav} patients={sharedProps.patients} />
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              gap: '8px', padding: '16px 24px 0', marginBottom: '8px'
            }}>
              <NotificationCenter nav={nav} userMode={userMode} />
              <ReminderPanel nav={nav} patients={sharedProps.patients} />
            </div>
          )}

          {/* BackupManager */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <BackupManager
              products={sharedProps.products}
              clients={sharedProps.patients}
              appointments={sharedProps.appointments}
              expenses={sharedProps.expenses}
              settings={{ workingHours, consultationConfig }}
              setProducts={setProducts}
              setClients={userMode === 'entrepreneur' ? setPatientsEnt : setPatientsPro}
              setAppointments={sharedProps.setAppointments}
              setExpenses={setExpenses}
              setSettings={(s) => {
                if (s.workingHours) setWorkingHours(s.workingHours)
                if (s.consultationConfig) setConsultationConfig(s.consultationConfig)
              }}
              orders={[]}
              stockMovements={[]}
              categories={[]}
              recurringRules={[]}
              whatsappConfig={null}
              setOrders={() => {}}
              setStockMovements={() => {}}
              setCategories={() => {}}
              setRecurringRules={() => {}}
              setWhatsappConfig={() => {}}
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