import React, { useState, useEffect, useCallback, useMemo, useReducer, useRef } from 'react'
import './App.css'
import './Splash.css'

// NOTA: migrateLocalStorageToFirestore y firestore imports eliminados por no usarse
import { useFirestoreSync } from './hooks/useFirestoreSync'
import { useBusinessId } from './hooks/useBusinessId'

// Contexts
import { ToastProvider, useToast } from './contexts/ToastContext'
import { ConfirmProvider, useConfirm } from './contexts/ConfirmContext'
import { NotificationProvider, useNotifications } from './contexts/NotificationContext'
import { ReminderProvider, useReminders } from './contexts/ReminderContext'

// Hooks
import { useNavigator } from './hooks/useNavigator'
import { useHistory } from './hooks/useHistory'
import { useSyncListener } from './hooks/useSyncListener'

// Utils
import { DEFAULT_CONSULTATION_CONFIG, USER_MODES, ACTIVE_STATUSES, COMPLETED_STATUSES } from './utils/constants'
import { hasConflict, hasAnyConflict, playDone, formatCurrency, normalizeEntities, newId, dateInputToISO, diffColeccion } from './utils/helpers'
import { generarEjemplos, sinEjemplos, contarEjemplos } from './utils/datosDeEjemplo'
import { MEDIO_POR_DEFECTO, CLAVE_ULTIMO_MEDIO } from './utils/mediosDePago'
import { CargandoPantalla } from './components/common/CargandoPantalla'
import { AvisoDeError } from './components/common/AvisoDeError'
import { copiarAlPortapapeles } from './utils/helpers'
import { armarAlertas } from './utils/alertas'
import { addAuditLog } from './utils/audit'
import { readJSON, readArray, writeJSON, writeCollection, onStorageError, getUsage } from './utils/safeStorage'

// Layout
import { ErrorBoundary } from './components/common/ErrorBoundary'
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
import { AlertasScreen } from './components/screens/AlertasScreen'
import { LicenseScreen } from './components/screens/licenseScreen.jsx'
import { PersonalAgendaScreen } from './components/screens/PersonalAgendaScreen'
import { BusinessSetupScreen } from './components/screens/BusinessSetupScreen'

// Auth
import { LoginScreen } from './components/screens/LoginScreen'
import { auth } from './firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'

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
    const patients = normalizeEntities(readArray(key))
    if (patients.length === 0) return []
    
    const unique = []
    const seen = new Set()
    
    // Las dos ramas hacen push, asi que unique.length SIEMPRE era igual a
    // patients.length y el writeJSON de abajo era inalcanzable: los ids nuevos
    // que se le asignaban a los duplicados no se guardaban nunca y en cada
    // arranque recibian otros distintos. Se lleva una bandera.
    let huboCambios = false
    patients.forEach(p => {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        if (!p.kanbanStatus) { p.kanbanStatus = 'prospect'; huboCambios = true }
        unique.push(p)
      } else {
        const newP = { ...p, id: newId() }
        if (!newP.kanbanStatus) newP.kanbanStatus = 'prospect'
        unique.push(newP)
        huboCambios = true
      }
    })

    if (huboCambios) {
      writeJSON(key, unique)
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
    const products = readArray(productsKey)
    
    const needsRepair = products.some(p => typeof p.id !== 'string' || typeof p.stock !== 'number')
    if (needsRepair) {
      const fixedProducts = products.map(p => ({
        ...p,
        id: String(p.id),
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0
      }))
      writeJSON(productsKey, fixedProducts)
    }
    
    const appointmentsKey = getStorageKey('appointments', mode)
    const appointments = readArray(appointmentsKey)
    
    const needsAppointmentsRepair = appointments.some(a => a.productId && typeof a.productId !== 'string')
    if (needsAppointmentsRepair) {
      const fixedAppointments = appointments.map(a => ({
        ...a,
        productId: a.productId ? String(a.productId) : a.productId
      }))
      writeJSON(appointmentsKey, fixedAppointments)
    }
  } catch (error) {
    console.error('Error reparando datos:', error)
  }
}

// ========== MIGRACIÓN: agregar deliveredAt a pedidos entregados ==========
function migrateDeliveredAt(mode) {
  try {
    const key = `zenday-${mode}-appointments`
    const appointments = readArray(key)
    
    let changed = false
    const completingStatuses = ['completed', 'delivered', 'picked']
    
    const migrated = appointments.map(a => {
      if (a.deliveredAt) return a
      
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
      writeJSON(key, migrated)
      console.log(`[Migration] deliveredAt migrado para modo ${mode}`)
    }
  } catch (err) {
    console.error('[Migration] Error en migrateDeliveredAt:', err)
  }
}

// ========== HELPERS DE NORMALIZACIÓN ==========
const normalizeId = (id) => id != null ? String(id) : null

// ACTIVE_STATUSES y COMPLETED_STATUSES viven en utils/constants.js:
// tenerlos duplicados acá fue lo que dejó que las tres copias divergieran.

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
function AppContent({ user, onLogout, businessId: propBusinessId, onBusinessChange }) {
  const toast = useToast()
  const { confirm } = useConfirm()
  const { addNotification } = useNotifications()
  const { addReminder } = useReminders()
  
  // ========== ESTADO DE LICENCIA ==========
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseChecked, setLicenseChecked] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)
  
  const [showSplash, setShowSplash] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('zenday-theme') || 'violet')
  const [appointments, dispatch] = useReducer(appointmentsReducer, [])
  const [patientsPro, setPatientsPro] = useState([])
  const [patientsEnt, setPatientsEnt] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loaded, setLoaded] = useState(false)
  // Sin esto el reporte de problema no dice que version fallo, que es el
  // primer dato que uno necesita cuando un cliente escribe "no anda".
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setAppVersion).catch(() => {})
  }, [])
  const [darkMode, setDark] = useState(() => localStorage.getItem('zenday-dark-mode') === 'true')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [activeTab, setActiveTab] = useState('dashboard')
  const [userMode, setUserMode] = useState(() => {
    const guardado = localStorage.getItem('zenday-user-mode')

    // 'merchant' se eliminó de USER_MODES. Si alguien lo tenía elegido, sacarlo
    // del catálogo lo dejaría en un modo que ya no aparece en el desplegable,
    // con la app vacía (las claves son `zenday-${modo}-...`) y sin forma de
    // volver. Se lo pasa a 'entrepreneur', que es como se comportaba igual.
    //
    // Los datos que hubiera bajo las claves `zenday-merchant-*` NO se tocan:
    // quedan en el disco por si alguna vez hicieran falta.
    if (guardado === 'merchant') {
      localStorage.setItem('zenday-user-mode', 'entrepreneur')
      return 'entrepreneur'
    }

    return guardado || 'professional'
  })
  // Estos dos inicializadores hacían JSON.parse sin protección. Si la clave
  // quedaba con JSON corrupto (una escritura cortada por falta de espacio),
  // la excepción caía dentro de un useState y React no podía montar: ventana
  // en blanco, sin mensaje. readJSON nunca lanza.
  const [workingHours, setWorkingHours] = useState(() =>
    readJSON(
      getStorageKey('working-hours', localStorage.getItem('zenday-user-mode') || 'professional'),
      { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' }
    )
  )
  const [consultationConfig, setConsultationConfig] = useState(() =>
    readJSON(
      getStorageKey('consultation-config', localStorage.getItem('zenday-user-mode') || 'professional'),
      DEFAULT_CONSULTATION_CONFIG
    )
  )

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
  const patientsRef = useRef(patients)  // ← AGREGADO
  const workingHoursRef = useRef(workingHours)  // ← AGREGADO
  const addPatientRef = useRef(null)
  const addAppointmentRef = useRef(null)
  
  // Actualizar refs cuando cambian
  useEffect(() => {
    appointmentsRef.current = appointments
  }, [appointments])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  useEffect(() => {
    workingHoursRef.current = workingHours
  }, [workingHours])

  // ── Avisos de almacenamiento ───────────────────────────────
  // localStorage tiene un tope de ~5-10 MB. Cuando se llena, setItem lanza
  // QuotaExceededError; antes nadie lo capturaba, así que la app seguía
  // andando y dejaba de guardar en silencio. Ahora el usuario se entera.
  useEffect(() => {
    onStorageError(({ message }) => toast.addToast(message, 'error'))

    const usage = getUsage()
    if (usage.nearLimit) {
      toast.addToast(
        `El almacenamiento local va por ${usage.megabytes.toFixed(1)} MB. Conviene exportar un respaldo y archivar datos viejos.`,
        'warning'
      )
    }
    return () => onStorageError(null)
  }, [toast])

  // ── Firebase sync ──────────────────────────────────────────
  const businessId = propBusinessId
  const {
    saveDoc: saveDocRaw, saveMany, deleteDoc: deleteFireDocRaw, subscribe, getAll,
  } = useFirestoreSync(businessId, userMode)
  const [migrationDone, setMigrationDone] = useState(false)

  // saveDoc/deleteDoc de useFirestoreSync devuelven { ok, error } en vez de tirar
  // excepción — pero en este archivo se llaman "al pasar" (sin await, para no
  // bloquear la UI en la escritura optimista). Sin envolverlos acá, ese { ok,
  // error } no lo mira nadie y una escritura que Firestore rechazó (permisos,
  // sin red) queda indistinguible de una exitosa: el dato desaparece de la
  // pantalla o se muestra como guardado, y en el server nunca llegó a estar.
  // Envolver una sola vez acá cubre TODOS los call sites existentes sin tener
  // que tocar cada uno.
  const saveDoc = useCallback((collectionName, id, data) => {
    return saveDocRaw(collectionName, id, data).then(r => {
      if (!r.ok) {
        addNotification(
          'error',
          '⚠️ No se guardó en la nube',
          `Los cambios de "${collectionName}" quedaron solo en este equipo (${r.error || 'sin conexión'}). Se reintenta al reconectar.`,
          { screen: 'settings' }
        )
      }
      return r
    })
  }, [saveDocRaw, addNotification])

  const deleteFireDoc = useCallback((collectionName, id) => {
    return deleteFireDocRaw(collectionName, id).then(r => {
      if (!r.ok) {
        addNotification(
          'error',
          '⚠️ No se borró en la nube',
          `El borrado en "${collectionName}" no llegó al servidor (${r.error || 'sin conexión'}) y puede reaparecer al sincronizar.`,
          { screen: 'settings' }
        )
      }
      return r
    })
  }, [deleteFireDocRaw, addNotification])

  // ═══════════════════════════════════════════════════════════════════════
  //  SINCRONIZACIÓN DE COLECCIONES
  //
  //  El agujero que tapa esto: productos y gastos se editaban SOLO en memoria
  //  y en localStorage. ProductsScreen crea, edita, importa y borra artículos
  //  con `setProducts` a secas; de `expenses` no había una sola escritura a
  //  Firestore en todo el proyecto.
  //
  //  Y del otro lado sí hay un listener que pisa el estado local con lo que
  //  hay en el servidor. O sea: cargabas un artículo, salía el toast verde,
  //  llegaba un snapshot y el artículo desaparecía de la pantalla.
  //
  //  En vez de tocar los ~15 lugares que llaman a setProducts/setExpenses (y
  //  que el próximo se olvide), se envuelve el setter: compara la lista de
  //  antes con la de después y emite las escrituras que correspondan.
  // ═══════════════════════════════════════════════════════════════════════
  const sincronizarColeccion = useCallback((coleccion, antes, despues) => {
    if (!businessId || !migrationDone) return
    // El cálculo vive en helpers.js (diffColeccion) para poder testearlo sin
    // levantar React ni Firestore. Acá sólo se emiten las escrituras.
    const { guardar, borrar } = diffColeccion(antes, despues)
    for (const item of guardar) saveDoc(coleccion, item.id, item)
    for (const item of borrar)  deleteFireDoc(coleccion, item.id)
  }, [businessId, migrationDone, saveDoc, deleteFireDoc])

  // Los refs evitan el anti-patrón de meter el efecto DENTRO del updater de
  // setState: eso es impuro y React lo ejecuta dos veces en StrictMode, así
  // que cada guardado se mandaría por duplicado. Se calcula `next` afuera.
  const productsRef = useRef(products)
  const expensesRef = useRef(expenses)
  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => { expensesRef.current = expenses }, [expenses])

  const hacerSetterSincronizado = (coleccion, ref, setter) => (updater) => {
    const previo = Array.isArray(ref.current) ? ref.current : []
    const next = typeof updater === 'function' ? updater(previo) : updater
    if (!Array.isArray(next)) {
      console.error(`[sync:${coleccion}] El resultado no es un array:`, next)
      return
    }
    ref.current = next
    setter(next)
    sincronizarColeccion(coleccion, previo, next)
  }

  const setProductsSync = useCallback(
    hacerSetterSincronizado('products', productsRef, setProducts),
    [sincronizarColeccion])
  const setExpensesSync = useCallback(
    hacerSetterSincronizado('expenses', expensesRef, setExpenses),
    [sincronizarColeccion])

  // ========== appointmentsByMode ==========
  const appointmentsByMode = useMemo(() => {
    const all = Array.isArray(appointments) ? appointments : []
    if (userMode === 'entrepreneur') {
      // `fromWhatsApp` sigue acá a propósito aunque el bot ya no exista: las
      // citas que creó en su momento llevan esa marca, y sacarla del filtro
      // las haría desaparecer de esta vista. Es historial del usuario.
      return all.filter(a => a.fromEmprendedor || a.fromWeb || a.fromMercadoPago || a.fromWhatsApp)
    }
    return all.filter(a => !a.fromEmprendedor && !a.fromWeb && !a.fromMercadoPago)
  }, [appointments, userMode])

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

  // ========== ESCUCHAR ACTUALIZACIONES ==========
  useEffect(() => {
    const cleanup = window.electronAPI?.onUpdateDownloaded?.((info) => {
      console.log('[Update] 📨 Evento recibido en frontend:', JSON.stringify(info, null, 2))
      
      if (info && info.downloadUrl && typeof info.downloadUrl === 'string' && info.downloadUrl.startsWith('http')) {
        setUpdateReady(true)
        setUpdateInfo(info)
        console.log('[Update] ✅ Banner activado con URL válida:', info.downloadUrl)
      } else {
        console.error('[Update] ❌ Info inválida recibida:', info)
        console.error('[Update] ❌ downloadUrl:', info?.downloadUrl)
      }
    })
    return () => cleanup?.()
  }, [])

  // ========== setAppointmentsDirect (VERSIÓN MEJORADA) ==========
  const setAppointmentsDirect = useCallback((updater) => {
    try {
      const current = Array.isArray(appointmentsRef.current) ? appointmentsRef.current : []
      const next = typeof updater === 'function' ? updater(current) : (Array.isArray(updater) ? updater : [])
      
      if (!Array.isArray(next)) {
        console.error('[setAppointmentsDirect] El resultado no es un array:', next)
        return
      }
      
      writeJSON(getStorageKey('appointments', userMode), next)
      dispatch({ type: 'SET_APPOINTMENTS', payload: next })
      setHistoryState(next)

      // FIX: antes esto terminaba acá. Lo usan editar el precio de un pedido,
      // eliminar un pedido pendiente y registrar una entrega — tres cosas que
      // quedaban sólo en este equipo mientras el listener de Firestore seguía
      // pisando el estado con la versión del servidor. El precio corregido
      // volvía al viejo, el pedido borrado reaparecía y la entrega se perdía,
      // con el toast verde ya mostrado.
      sincronizarColeccion('appointments', current, next)
      
      console.log('[setAppointmentsDirect] Actualizados:', next.length, 'pedidos')
    } catch (err) {
      console.error('[setAppointmentsDirect] Error:', err)
      toast.addToast('❌ Error al actualizar los pedidos', 'error')
    }
  }, [userMode, setHistoryState, toast, sincronizarColeccion])

  // ========== CARGA DE DATOS (PRIORIDAD FIRESTORE) ==========
  useEffect(() => {
    // Este efecto lanza una función async que tarda, pero antes no devolvía
    // limpieza. Si el usuario cambiaba de modo mientras la carga anterior seguía
    // en vuelo, la vieja terminaba después y escribía los datos del modo anterior
    // sobre el estado del nuevo. Con `cancelled` la carga obsoleta se descarta.
    let cancelled = false

    setLoaded(false)
    setMigrationDone(false)

    initialNotificationsSent.current = false
    lowStockNotified.current = new Set()
    outOfStockNotified.current = new Set()
    todayNotified.current = false

    localStorage.setItem('zenday-user-mode', userMode)

    const applyLocalOnly = () => {
      dispatch({ type: 'SET_APPOINTMENTS', payload: normalizeEntities(readArray(getStorageKey('appointments', userMode))) })
      setHistoryState(normalizeEntities(readArray(getStorageKey('appointments', userMode))), false)
      const pts = repairPatientsData(userMode)
      if (userMode === 'entrepreneur') setPatientsEnt(pts)
      else setPatientsPro(pts)
      setProducts(normalizeEntities(readArray(getStorageKey('products', userMode))))
      setExpenses(normalizeEntities(readArray(getStorageKey('expenses', userMode))))
      setMigrationDone(true)
    }

    const loadDataForMode = async () => {
      repairProductsAndAppointments(userMode)
      migrateDeliveredAt(userMode)

      if (businessId) {
        const [rApts, rPatients, rProducts, rExpenses] = await Promise.all([
          getAll('appointments'),
          getAll('patients'),
          getAll('products'),
          getAll('expenses'),
        ])

        if (cancelled) return

        // getAll ahora devuelve { ok, items, error }. Antes devolvía [] tanto si
        // la colección estaba vacía como si la lectura fallaba, y la decisión de
        // abajo se tomaba con .length: un error de permisos se leía como "la nube
        // está vacía" y disparaba la re-subida sobre un estado desconocido.
        const allOk = rApts.ok && rPatients.ok && rProducts.ok && rExpenses.ok

        if (!allOk) {
          console.error('[App] Lectura de Firestore incompleta, se usa la copia local')
          toast.addToast('No se pudo leer la nube. Estás trabajando con los datos de este equipo.', 'warning')
          applyLocalOnly()
        } else {
          // Sube en lotes de 500 en vez de una escritura de red por registro.
          const hydrate = async (col, remote, apply) => {
            if (remote.items.length > 0) {
              apply(normalizeEntities(remote.items))
              writeCollection(getStorageKey(col, userMode), remote.items)
              return
            }
            const local = col === 'patients'
              ? repairPatientsData(userMode)
              : normalizeEntities(readArray(getStorageKey(col, userMode)))
            apply(local)
            if (local.length > 0) {
              const res = await saveMany(col, local)
              if (!res.ok) toast.addToast(`No se pudieron subir todos los datos de ${col}.`, 'error')
            }
          }

          await hydrate('appointments', rApts, (list) => {
            dispatch({ type: 'SET_APPOINTMENTS', payload: list })
            setHistoryState(list, false)
          })
          await hydrate('patients', rPatients, (list) => {
            if (userMode === 'entrepreneur') setPatientsEnt(list)
            else setPatientsPro(list)
          })
          await hydrate('products', rProducts, setProducts)
          await hydrate('expenses', rExpenses, setExpenses)

          if (cancelled) return
          setMigrationDone(true)
        }

      } else {
        applyLocalOnly()
      }

      if (cancelled) return

      const wh = readJSON(getStorageKey('working-hours', userMode), null)
      if (wh) setWorkingHours(wh)
      const cfg = readJSON(getStorageKey('consultation-config', userMode), null)
      if (cfg) setConsultationConfig(cfg)

      setLoaded(true)
    }

    loadDataForMode().catch(err => {
      // Red de contención: antes una excepción inesperada dejaba loaded=false
      // para siempre y la app se quedaba colgada en la pantalla de carga.
      console.error('[App] Error inesperado cargando datos:', err)
      if (cancelled) return
      applyLocalOnly()
      setLoaded(true)
    })

    nav.goToRoot('dashboard')
    setSelectedDate(new Date())

    return () => { cancelled = true }
  }, [userMode, businessId, user])

  // ========== LISTENERS FIRESTORE (siempre actualizan) ==========
  useEffect(() => {
    if (!businessId || !migrationDone || !loaded) return

    const onSyncError = (col) => (error) => {
      console.error(`[Sync] ${col}:`, error.code || error.message)
      if (error.code === 'permission-denied') {
        toast.addToast('Sin permiso para sincronizar. Tus datos locales están intactos.', 'error')
      }
    }

    // Un snapshot vacío que llega del servidor cuando acá hay registros es casi
    // siempre un síntoma (permisos, businessId a medio resolver), no un borrado
    // real. Antes ese [] pisaba el estado Y la copia de localStorage, y no
    // quedaba ninguna copia de los datos en el equipo.
    const guard = (col, apply) => (data, meta) => {
      const previous = readArray(getStorageKey(col, userMode))
      if (data.length === 0 && previous.length > 0 && !meta?.fromCache) {
        console.warn(`[Sync] Snapshot vacío de ${col} con ${previous.length} registros locales: se ignora`)
        toast.addToast('El servidor devolvió una lista vacía. Se mantienen los datos de este equipo.', 'warning')
        return
      }
      const normalized = normalizeEntities(data)
      apply(normalized)
      writeCollection(getStorageKey(col, userMode), normalized)
    }

    const unsubApt = subscribe(
      'appointments',
      guard('appointments', (data) => dispatch({ type: 'SET_APPOINTMENTS', payload: data })),
      onSyncError('appointments')
    )

    const unsubPat = subscribe(
      'patients',
      guard('patients', (data) => {
        if (userMode === 'entrepreneur') setPatientsEnt(data)
        else setPatientsPro(data)
      }),
      onSyncError('patients')
    )

    const unsubProd = subscribe('products', guard('products', setProducts), onSyncError('products'))
    const unsubExp  = subscribe('expenses', guard('expenses', setExpenses),  onSyncError('expenses'))

    return () => {
      unsubApt()
      unsubPat()
      unsubProd()
      unsubExp()
    }
  }, [businessId, userMode, migrationDone, loaded, subscribe, toast])

  // ========== Hook de sync listener ==========
  const onNewOrder = useCallback(({ nombre, monto, productos: prods }) => {
    const existing = patients.find(p =>
      p.name?.toLowerCase() === nombre.toLowerCase()
    )
    if (!existing && addPatientRef.current) {
      addPatientRef.current({
        name: nombre,
        phone: '',
        email: '',
        // Un ARRAY con una nota, no un string.
        // Guardarlo como texto era el origen del bug: el resto del código
        // asume array, así que `notes.length` contaba caracteres y
        // `[...notes]` desarmaba el texto letra por letra.
        notes: [{
          id: newId(),
          content: `Cliente web — primer pedido: ${prods}`,
          date: new Date().toISOString(),
          dateFormatted: new Date().toLocaleString('es-UY'),
        }],
        fromWeb: true,
        kanbanStatus: 'client'
      })
    }
    addNotification(
      'success',
      `🛒 Nuevo pedido web — ${nombre}`,
      `${prods} — $U ${monto?.toLocaleString('es-UY') || '?'}`,
      { screen: 'emprendedor' }
    )
  }, [patients, addNotification])

  const onChanges = useCallback((integrationName, changes, mode) => {
    changes.forEach(c => {
      addNotification(
        c.after < c.before ? 'warning' : 'success',
        `🔄 Stock actualizado — ${integrationName}`,
        `${c.name}: ${c.before} → ${c.after} uds ${mode === 'realtime' ? '(tiempo real)' : '(sync)'}`,
        { screen: 'products' }
      )
    })
  }, [addNotification])

  const { reconnect } = useSyncListener({
    products,
    // Un pedido web que descuenta stock tiene que quedar guardado, no sólo
    // en la memoria de esta máquina.
    setProducts: setProductsSync,
    setAppointments: setAppointmentsDirect,
    onNewOrder,
    onChanges,
  })

  // ========== PERSISTENCIA LOCAL ==========
  // ─────────────────────────────────────────────────────────────────────────
  //  PERDIDA DE DATOS: esto borraba los clientes del OTRO modo en cada arranque.
  //
  //  Antes eran dos efectos que escribian las dos listas SIEMPRE:
  //
  //      writeJSON(getStorageKey('patients', 'professional'),  patientsPro)
  //      writeJSON(getStorageKey('patients', 'entrepreneur'), patientsEnt)
  //
  //  Pero los ocho lugares que cargan clientes hacen todos lo mismo:
  //
  //      if (userMode === 'entrepreneur') setPatientsEnt(...)
  //      else                             setPatientsPro(...)
  //
  //  o sea que SOLO se llena la lista del modo actual. La otra se queda en el
  //  [] con el que arranca el useState: nadie la carga nunca.
  //
  //  Entonces, abriendo la app en profesional: apenas `loaded` pasaba a true,
  //  el segundo efecto escribia [] sobre `zenday-entrepreneur-patients` y se
  //  llevaba puestos todos los clientes de emprendedor. Y al reves igual.
  //
  //  No avisaba nada. Cambiabas de modo y no habia nadie.
  //
  //  Ahora se guarda UNICAMENTE la lista del modo que de verdad se cargo. La
  //  del otro modo no se toca: sigue en el disco como quedo la ultima vez que
  //  se estuvo ahi.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return
    const lista = userMode === 'entrepreneur' ? patientsEnt : patientsPro
    writeJSON(getStorageKey('patients', userMode), lista)
  }, [patientsPro, patientsEnt, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    writeJSON(getStorageKey('appointments', userMode), appointments)
  }, [appointments, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    writeJSON(getStorageKey('products', userMode), products)
  }, [products, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    writeJSON(getStorageKey('expenses', userMode), expenses)
  }, [expenses, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    writeJSON(getStorageKey('working-hours', userMode), workingHours)
  }, [workingHours, loaded, userMode])

  useEffect(() => {
    if (!loaded) return
    writeJSON(getStorageKey('consultation-config', userMode), consultationConfig)
  }, [consultationConfig, loaded, userMode])

  // Tema y modo oscuro
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('zenday-theme', theme)
  }, [theme])

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
    localStorage.setItem('zenday-dark-mode', darkMode)
    // FIX: sin este cleanup la clase quedaba pegada al desmontar AppContent
    // (logout, cambio de negocio). LoginScreen y BusinessSetupScreen viven fuera
    // de este componente, así que aparecían con tarjeta blanca e inputs negros.
    return () => document.body.classList.remove('dark')
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
    const n = { id: newId(), ...data, createdAt: new Date().toISOString() }
    dispatch({ type: 'ADD_APPOINTMENT', payload: n })
    setHistoryState([...safeAppointments, n])
    
    if (businessId && migrationDone) saveDoc('appointments', n.id, n)
    
    playDone()
    addAuditLog('CREAR', 'Pedido', n.id, { patient: data.patientName })
    addNotification('success', '✅ Cita creada', `Cita con ${data.patientName} agendada correctamente`, { screen: 'agenda' })
    return true
  }, [appointments, setHistoryState, addNotification, businessId, migrationDone, saveDoc])

  const addMultipleAppointments = useCallback((data) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    if (hasAnyConflict(safeAppointments, data)) return false
    dispatch({ type: 'ADD_MULTIPLE_APPOINTMENTS', payload: data })
    setHistoryState([...safeAppointments, ...data])
    
    if (businessId && migrationDone) {
      data.forEach(n => saveDoc('appointments', n.id, n))
    }
    
    playDone()
    addNotification('success', '✅ Citas múltiples', `${data.length} citas agregadas correctamente`, { screen: 'agenda' })
    return true
  }, [appointments, setHistoryState, addNotification, businessId, migrationDone, saveDoc])

  const updateAppointment = useCallback((id, upd) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const appointment = safeAppointments.find(a => normalizeId(a.id) === normalizeId(id))

    if (!appointment) {
      toast.addToast('No se encontró la cita que querías modificar', 'error')
      return false
    }

    const updatedAppointment = { ...appointment, ...upd }

    // FIX: el reducer rechaza el cambio si hay solapamiento y devuelve el estado
    // sin tocar, pero acá se seguía de largo: setHistoryState guardaba la versión
    // nueva, saveDoc la subía a Firestore y el toast decía "✅ Cita reprogramada".
    // Resultado: la agenda mostraba el horario viejo, Firestore tenía el nuevo, y
    // el usuario creía que se había guardado. Ahora se chequea ANTES.
    if (hasConflict(safeAppointments, updatedAppointment, id)) {
      toast.addToast('❌ Ya hay otra cita en ese horario', 'error')
      return false
    }

    dispatch({ type: 'UPDATE_APPOINTMENT', id, payload: upd })
    setHistoryState(safeAppointments.map(a => normalizeId(a.id) === normalizeId(id) ? updatedAppointment : a))

    if (businessId && migrationDone) saveDoc('appointments', id, updatedAppointment)

    addAuditLog('REPROGRAMAR', 'Pedido', id, { changes: upd })
    toast.addToast('✅ Cita reprogramada', 'success')
    addNotification('info', '🔄 Cita reprogramada', `La cita ha sido modificada`, { screen: 'agenda' })
    return true
  }, [appointments, setHistoryState, toast, addNotification, businessId, migrationDone, saveDoc])

  const updateStatus = useCallback((id, newStatus) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const appointment = safeAppointments.find(a => normalizeId(a.id) === normalizeId(id))
    if (!appointment) {
      toast.addToast('No se encontró el pedido', 'error')
      return false
    }
    const oldStatus = appointment.status
    const updatedAppointment = { ...appointment, status: newStatus }
    dispatch({ type: 'UPDATE_STATUS', id, status: newStatus })
    setHistoryState(safeAppointments.map(a => normalizeId(a.id) === normalizeId(id) ? updatedAppointment : a))
    
    if (businessId && migrationDone) saveDoc('appointments', id, updatedAppointment)
    
    addAuditLog('CAMBIAR_ESTADO', 'Pedido', id, { oldStatus, newStatus })
    
    const completingStatuses = ['completed', 'delivered', 'picked']
    const wasCompleted  = completingStatuses.includes(oldStatus)
    const isNowCompleted = completingStatuses.includes(newStatus)
    
    if (!wasCompleted && isNowCompleted && appointment.productId) {
      setProducts(prev => {
        const product = prev.find(p => normalizeId(p.id) === normalizeId(appointment.productId))
        if (!product) return prev
        const currentStock = product.stock || 0
        if (currentStock <= 0) {
          toast.addToast(`⚠️ "${product.name}" sin stock`, 'warning')
          addNotification('error', '❌ Sin stock', `No se puede completar: ${product.name} agotado`, { screen: 'products' })
          return prev
        }
        // FIX: descontaba 1 fijo aunque el pedido fuera de 5 unidades.
        // `quantity` ya venía guardada en el pedido y hasta se validaba en
        // checkProductStock — sólo faltaba usarla acá.
        const cantidad = Number(appointment.quantity) || 1
        const newStock = Math.max(0, currentStock - cantidad)
        const updatedProduct = { ...product, stock: newStock }
        if (newStock === 0)    addNotification('error',   `⚠️ "${product.name}" agotado`, `Stock: 0 unidades`, { screen: 'products' })
        else if (newStock < 5) addNotification('warning', `📦 Stock bajo: ${product.name}`, `Quedan ${newStock} unidades`, { screen: 'products' })
        addNotification('success', '✅ Pedido completado', `${product.name} entregado a ${appointment.patientName}`, { screen: 'agenda' })
        
        if (businessId && migrationDone) saveDoc('products', product.id, updatedProduct)
        
        return prev.map(p => normalizeId(p.id) === normalizeId(appointment.productId) ? updatedProduct : p)
      })
    }
    if (wasCompleted && !isNowCompleted && appointment.productId) {
      setProducts(prev => {
        const product = prev.find(p => normalizeId(p.id) === normalizeId(appointment.productId))
        if (!product) return prev
        // Al revertir hay que devolver la misma cantidad que se descontó.
        const cantidad = Number(appointment.quantity) || 1
        const newStock = (product.stock || 0) + cantidad
        const updatedProduct = { ...product, stock: newStock }
        addNotification('info', '🔄 Pedido revertido', `Stock de ${product.name} restaurado a ${newStock}`, { screen: 'products' })
        
        if (businessId && migrationDone) saveDoc('products', product.id, updatedProduct)
        
        return prev.map(p => normalizeId(p.id) === normalizeId(appointment.productId) ? updatedProduct : p)
      })
    }
    return true
  }, [appointments, setHistoryState, setProducts, toast, addNotification, businessId, migrationDone, saveDoc])

  const deleteAppointment = useCallback(async (id) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const appointment = safeAppointments.find(a => normalizeId(a.id) === normalizeId(id))
    
    // FIX: el guard usaba ACTIVE_STATUSES — que son justamente los estados con
    // los que NACEN todas las citas ('scheduled', 'pending') — así que ninguna
    // cita nueva se podía borrar jamás. La intención era proteger los pedidos ya
    // entregados y sin cobrar: eso es COMPLETED_STATUSES, definido y sin usar.
    if (appointment && !appointment.paid &&
        COMPLETED_STATUSES.has(appointment.status)) {
      addNotification(
        'error',
        '❌ No se puede eliminar',
        `Este pedido tiene un pago pendiente. Registrá el pago primero o cambiá el estado.`,
        { screen: 'agenda' }
      )
      return false
    }

    // Era window.confirm, el cartel gris del sistema operativo. Para borrar
    // datos de un cliente eso queda muy pobre al lado del resto de la app.
    // Ojo: confirm() devuelve una promesa, asi que esta funcion ahora es
    // async y quien la llama TIENE que await-earla. Sin el await,
    // `=== false` compara contra una promesa y nunca da true: el borrado
    // se daria por hecho aunque el usuario hubiera cancelado.
    const ok = await confirm(
      `¿Eliminar el pedido de ${appointment?.patientName || 'este cliente'}?`,
      'Eliminar pedido'
    )
    if (ok) {
      dispatch({ type: 'DELETE_APPOINTMENT', id })
      setHistoryState(safeAppointments.filter(a => normalizeId(a.id) !== normalizeId(id)))
      
      if (businessId && migrationDone) deleteFireDoc('appointments', id)
      
      addAuditLog('ELIMINAR', 'Pedido', id)
      toast.addToast('🗑️ Pedido eliminado', 'info')
      addNotification('info', '🗑️ Pedido eliminado', 'La cita ha sido eliminada', { screen: 'agenda' })
      return true
    }
    return false
  }, [appointments, setHistoryState, toast, addNotification, businessId, migrationDone, deleteFireDoc, confirm])

  // ========== MARK AS PAID CON FECHA PERSONALIZABLE ==========
  // El tercer argumento es el medio de pago. Cuando no viene —los botones de
  // "cobrado" del Panel y de la Agenda son UN click, sin modal— se usa el
  // ultimo que se haya elegido.
  //
  // Es una decision con filo y la dejo escrita: registrar el ultimo medio puede
  // guardar uno equivocado en silencio. La alternativa era dejarlo vacio, y ahi
  // el cierre de caja no cierra, que es justo lo que esto viene a resolver. Un
  // local cobra casi siempre igual, asi que el ultimo acierta casi siempre; y
  // si no, se corrige desde el detalle del pedido.
  const markAsPaid = useCallback((id, customPaymentDate = null, metodo = null) => {
    const safeAppointments = Array.isArray(appointments) ? appointments : []
    const appointment = safeAppointments.find(a => normalizeId(a.id) === normalizeId(id))
    if (!appointment) {
      toast.addToast('No se encontró el pedido que querías cobrar', 'error')
      return false
    }

    // FIX: `new Date('2026-08-20')` se parsea como medianoche UTC, que en UTC-3
    // es el 19 a las 21:00. Un pago registrado el 20 figuraba el 19 en el detalle
    // y en los reportes. dateInputToISO ancla al mediodía local.
    const paymentDate = customPaymentDate
      ? dateInputToISO(customPaymentDate)
      : new Date().toISOString()
    
    const medioUsado = metodo || (() => {
      try { return localStorage.getItem(CLAVE_ULTIMO_MEDIO) || MEDIO_POR_DEFECTO }
      catch { return MEDIO_POR_DEFECTO }
    })()

    const updatedAppointment = { ...appointment, paid: true, paymentDate, paymentMethod: medioUsado }
    
    // La fecha va EN la accion. Antes se despachaba solo el id y el reducer
    // ponia la de hoy: el usuario elegia el 15 de agosto, Firestore guardaba
    // el 15 y el estado local el dia de hoy. Y al corregir una fecha ya
    // cargada el reducer conservaba la vieja, sin cambiar nada.
    dispatch({ type: 'MARK_PAID', id, paymentDate, paymentMethod: medioUsado })
    setHistoryState(safeAppointments.map(a => normalizeId(a.id) === normalizeId(id) ? updatedAppointment : a))
    
    if (businessId && migrationDone) saveDoc('appointments', id, updatedAppointment)
    
    addAuditLog('PAGAR', 'Pedido', id)
    toast.addToast('💰 Pago registrado', 'success')
    addNotification('success', '💰 Pago registrado', `Pago recibido correctamente`, { screen: 'financial' })
    return true
  }, [appointments, setHistoryState, toast, addNotification, businessId, migrationDone, saveDoc])

  const addPatient = useCallback((data) => {
    const n = { id: Date.now() + '-' + Math.random().toString(36).substr(2, 9), ...data, totalVisits: 0, kanbanStatus: data.kanbanStatus || 'prospect' }
    if (userMode === 'entrepreneur') {
      setPatientsEnt(p => [...p, n])
    } else {
      setPatientsPro(p => [...p, n])
    }
    
    if (businessId && migrationDone) saveDoc('patients', n.id, n)
    
    addAuditLog('CREAR', 'Cliente', n.id, { name: data.name })
    addNotification('success', '👤 Cliente agregado', `${data.name} se ha registrado correctamente`, { screen: 'patients' })
    return n
  }, [addNotification, userMode, businessId, migrationDone, saveDoc])

  // ESTA FUNCIÓN TENÍA DOS BUGS QUE JUNTOS ROMPÍAN "AGREGAR NOTA":
  //
  // 1. `x.id === id` comparaba estricto. Los ids conviven como número (los viejos,
  //    de `Date.now()`) y como string (los que vuelven de Firestore, donde el id
  //    del documento es siempre texto). Cuando no coincidía el tipo, `find`
  //    devolvía undefined y `{ ...undefined, ...upd }` producía un objeto con
  //    SOLO las notas — sin nombre, sin teléfono — y el `map` no reemplazaba nada.
  //    La nota se veía en pantalla por el setState optimista del componente y
  //    desaparecía al volver a entrar.
  //
  // 2. `updatedPatient` se asignaba DENTRO del updater de setState y se leía
  //    afuera. El updater no corre sincrónicamente de forma garantizada, así que
  //    a veces `updatedPatient` seguía en null y `saveDoc` nunca se llamaba: el
  //    cambio se veía local pero no llegaba a la nube ni a la otra máquina.
  //    Con StrictMode (main.jsx) el updater además corre dos veces.
  const updatePatient = useCallback((id, upd) => {
    const key = normalizeId(id)
    const list = userMode === 'entrepreneur' ? patientsEnt : patientsPro
    const current = list.find(x => normalizeId(x.id) === key)

    if (!current) {
      console.error('[updatePatient] No se encontró el cliente', id)
      toast.addToast('No se encontró el cliente que querías actualizar', 'error')
      return false
    }

    const updatedPatient = { ...current, ...upd, id: current.id }
    const setPatients = userMode === 'entrepreneur' ? setPatientsEnt : setPatientsPro
    setPatients(p => p.map(x => normalizeId(x.id) === key ? updatedPatient : x))

    if (businessId && migrationDone) saveDoc('patients', current.id, updatedPatient)

    addAuditLog('ACTUALIZAR', 'Cliente', id)
    addNotification('info', '✏️ Cliente actualizado', `Datos del cliente modificados`, { screen: 'patients' })
    return true
  }, [addNotification, userMode, patientsEnt, patientsPro, businessId, migrationDone, saveDoc, toast])

  // ========== DELETE PATIENT - VERSIÓN ULTRA SEGURA ==========
  const deletePatient = useCallback(async (id) => {
    const patientId = normalizeId(id)
    
    const patientName = (userMode === 'entrepreneur' ? patientsEnt : patientsPro).find(p => normalizeId(p.id) === patientId)?.name
    
    let emprendedorPedidos = []
    try {
      const saved = localStorage.getItem('zenday-emprendedor-pedidos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          emprendedorPedidos = parsed.filter(p => p && p.id && p.estado !== 'ENTREGADO')
        }
      }
    } catch (e) {
      console.error('[DeletePatient] Error loading emprendedor pedidos:', e)
    }
    
    const currentAppointments = appointmentsRef.current || []
    
    console.log('[DeletePatient] ========== INICIO ==========')
    console.log('[DeletePatient] ID a eliminar:', patientId)
    console.log('[DeletePatient] Nombre del cliente:', patientName)
    console.log('[DeletePatient] Pedidos en appointments:', currentAppointments.length)
    console.log('[DeletePatient] Pedidos activos en emprendedor:', emprendedorPedidos.length)
    
    // FIX: contaba todo el historial del cliente, así que cualquiera con
    // pedidos ya entregados quedaba imposible de borrar. Sólo deben bloquear
    // los pedidos ACTIVOS — igual que hace hasActiveOrders en PatientDetailScreen.
    const pedidosEnAppointments = currentAppointments.filter(a => {
      if (!a.patientId) return false
      return normalizeId(a.patientId) === patientId && ACTIVE_STATUSES.has(a.status)
    })
    
    const pedidosEnEmprendedor = patientName ? emprendedorPedidos.filter(p => {
      return p.cliente === patientName
    }) : []
    
    const totalPedidos = pedidosEnAppointments.length + pedidosEnEmprendedor.length
    
    console.log('[DeletePatient] Pedidos en appointments:', pedidosEnAppointments.length)
    console.log('[DeletePatient] Pedidos en emprendedor:', pedidosEnEmprendedor.length)
    console.log('[DeletePatient] Total pedidos:', totalPedidos)
    
    if (totalPedidos > 0) {
      console.log('[DeletePatient] ❌ BLOQUEADO - Cliente tiene', totalPedidos, 'pedido(s)')
      let mensaje = `Este cliente tiene ${totalPedidos} pedido(s)`
      if (pedidosEnAppointments.length > 0) mensaje += ` (${pedidosEnAppointments.length} en agenda)`
      if (pedidosEnEmprendedor.length > 0) mensaje += ` (${pedidosEnEmprendedor.length} en producción)`
      mensaje += `. Eliminá los pedidos primero.`
      
      addNotification(
        'error',
        '❌ No se puede eliminar',
        mensaje,
        { screen: 'patients' }
      )
      return false
    }

    const okCliente = await confirm(
      '¿Eliminar este cliente?\n\nSe borran también sus datos asociados.',
      'Eliminar cliente'
    )
    if (!okCliente) {
      console.log('[DeletePatient] Cancelado por usuario')
      return false
    }

    console.log('[DeletePatient] ✅ Eliminando cliente...')

    if (userMode === 'entrepreneur') {
      setPatientsEnt(prev => prev.filter(p => normalizeId(p.id) !== patientId))
    } else {
      setPatientsPro(prev => prev.filter(p => normalizeId(p.id) !== patientId))
    }

    if (businessId && migrationDone) {
      deleteFireDoc('patients', id)
    }

    addAuditLog('ELIMINAR', 'Cliente', id)
    addNotification('info', '🗑️ Cliente eliminado', 'Cliente eliminado correctamente', { screen: 'patients' })
    console.log('[DeletePatient] ========== FIN ==========')
    return true
  }, [userMode, businessId, migrationDone, deleteFireDoc, addNotification, patientsPro, patientsEnt, confirm])

  // ========== DELETE PRODUCT - VERSIÓN ULTRA SEGURA ==========
  const deleteProduct = useCallback(async (id) => {
    const productId = normalizeId(id)
    const safeAppointments = Array.isArray(appointmentsRef.current) ? appointmentsRef.current : []

    console.log('[DeleteProduct] ========== INICIO ==========')
    console.log('[DeleteProduct] ID a eliminar:', productId)
    console.log('[DeleteProduct] Total appointments:', safeAppointments.length)

    const pedidosActivos = safeAppointments.filter(a => {
      const apptProductId = normalizeId(a.productId)
      const status = a.status

      return apptProductId === productId && ACTIVE_STATUSES.has(status)
    })

    console.log('[DeleteProduct] Pedidos activos encontrados:', pedidosActivos.length)

    if (pedidosActivos.length > 0) {
      console.log('[DeleteProduct] ❌ BLOQUEADO - Producto tiene', pedidosActivos.length, 'pedido(s) activo(s)')
      addNotification(
        'error',
        '❌ No se puede eliminar',
        `Este producto tiene ${pedidosActivos.length} pedido(s) activo(s). Completá o cancelá los pedidos primero.`,
        { screen: 'products' }
      )
      return false
    }

    const okProducto = await confirm('¿Eliminar este artículo?', 'Eliminar artículo')
    if (!okProducto) {
      console.log('[DeleteProduct] Cancelado por usuario')
      return false
    }

    console.log('[DeleteProduct] ✅ Eliminando producto...')

    setProducts(prev => prev.filter(p => normalizeId(p.id) !== productId))

    if (businessId && migrationDone) {
      deleteFireDoc('products', id)
    }

    addAuditLog('ELIMINAR', 'Producto', id)
    addNotification('info', '🗑️ Producto eliminado', 'Producto eliminado correctamente', { screen: 'products' })
    console.log('[DeleteProduct] ========== FIN ==========')
    return true
  }, [businessId, migrationDone, deleteFireDoc, addNotification, confirm])

  // ========== SINCRONIZAR REFS DE FUNCIONES (DESPUÉS DE DEFINIRLAS) ==========
  useEffect(() => {
    addAppointmentRef.current = addAppointment
  }, [addAppointment])

  useEffect(() => {
    addPatientRef.current = addPatient
  }, [addPatient])


  // ========== todayAppointments y createCustomReminder ==========
  const todayAppointments = useMemo(() => {
    return (Array.isArray(appointments) ? appointments : [])
      .filter(a => a && a.startTime && new Date(a.startTime).toDateString() === new Date().toDateString())
  }, [appointments])

  const createCustomReminder = useCallback((appointment, reminderConfig) => null, [])

  // ========== STATS ==========
  const stats = useMemo(() => {
    const safeToday    = Array.isArray(todayAppointments) ? todayAppointments : []
    const safePatients = Array.isArray(patients)          ? patients          : []
    return {
      todayTotal:     safeToday.length,
      todayCompleted: safeToday.filter(a => COMPLETED_STATUSES.has(a.status)).length,
      todayPending:   safeToday.filter(a => ACTIVE_STATUSES.has(a.status)).length,
      revenueToday:   safeToday.filter(a => COMPLETED_STATUSES.has(a.status) && a.paid).reduce((s, a) => s + (a.price || 0), 0),
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

  // Ctrl+K entendió una frase tipo "lucia jueves 16 corte" y quiere crearla.
  //
  // Abre el formulario ya cargado en vez de guardar directo. Es a propósito:
  // acá se está creando un compromiso con una persona, y una confirmación de
  // un segundo vale más que ahorrarse un Enter. Además hay 14 campos y la
  // frase llena cuatro: el resto se ve de un vistazo antes de guardar.
  const handleAltaRapida = useCallback((prellenado) => {
    nav.navigate('new', { prellenado })
    if (prellenado.faltantes?.length) {
      toast.addToast(`Falta ${prellenado.faltantes.join(' y ')}`, 'info')
    }
  }, [nav, toast])

  // ── Cuántas alertas hay, para el globito del menú ─────────────────────────
  //
  // Se calcula acá y no adentro de la pantalla porque el punto de una alerta es
  // que se vea SIN entrar: si hay que abrir Alertas para enterarse de que hay
  // alertas, no sirve para nada.
  //
  // El cálculo es puro y está memoizado contra las dos listas; adentro indexa
  // las citas una sola vez, así que no escala con clientes × citas.
  const cantidadDeAlertas = useMemo(() => {
    if (userMode === 'personal') return 0        // sin clientes, no hay nada que avisar
    if (!loaded) return 0                        // no anunciar nada sobre datos a medio cargar
    try {
      return armarAlertas(patients, appointments, { hoy: new Date() }).total
    } catch {
      // Un globito nunca puede voltear la app entera.
      return 0
    }
  }, [patients, appointments, userMode, loaded])

  const handleGlobalSearch = (result) => {
    if (result.type === 'patient')  nav.navigate('patientDetail', { patientId: result.id })
    else if (result.type === 'product') nav.navigate('products')
    else nav.navigate('detail', { appointmentId: result.id })
  }

  // ========== Datos para el respaldo ==========
  //
  // Antes acá se hacía [...patientsPro, ...patientsEnt] y se le pasaba a
  // BackupManager como `clients`. Pero al restaurar, setClients escribe TODO
  // en la lista del modo actual: restaurabas estando en profesional y tus
  // clientes comerciales aparecían entre tus pacientes.
  //
  // Un respaldo es de UN modo. El de emprendedor se hace estando en
  // emprendedor.
  const clientesDelModo = useMemo(
    () => (userMode === 'entrepreneur' ? patientsEnt : patientsPro),
    [userMode, patientsPro, patientsEnt])

  // ========== DATOS DE EJEMPLO ==========
  //
  // Quien instala cae en un Panel con todo en $0 y ocho menús vacíos, y tiene
  // 14 días para decidir si paga. Esto le deja ver el programa funcionando.
  //
  // Va acá arriba y no adentro de la pantalla de Configuración porque el estado
  // vive acá: los clientes están partidos en patientsPro/patientsEnt, y los
  // pedidos, artículos y gastos se guardan cada uno por su propio camino.
  //
  // El borrado NO pasa por deletePatient: esa función abre un cartel de
  // confirmación por cada cliente, y serían seis carteles seguidos.

  const setPatientsDelModo = useCallback((next) => {
    const previo = userMode === 'entrepreneur' ? patientsEnt : patientsPro
    const lista = typeof next === 'function' ? next(previo) : next
    if (userMode === 'entrepreneur') setPatientsEnt(lista)
    else setPatientsPro(lista)
    // sincronizarColeccion hace el diff y emite sólo las altas y bajas reales.
    sincronizarColeccion('patients', previo, lista)
  }, [userMode, patientsPro, patientsEnt, sincronizarColeccion])

  const cargarDatosDeEjemplo = useCallback(() => {
    const datos = generarEjemplos({ userMode, hoy: new Date() })
    // `sinEjemplos` primero: cargar dos veces reemplaza, no duplica.
    setPatientsDelModo(p => [...sinEjemplos(p), ...datos.patients])
    setAppointmentsDirect(a => [...sinEjemplos(a), ...datos.appointments])
    setProductsSync(p => [...sinEjemplos(p), ...datos.products])
    setExpensesSync(e => [...sinEjemplos(e), ...datos.expenses])
    addAuditLog('CREAR', 'Datos de ejemplo', 'ejemplos')
    toast.addToast('✨ Datos de ejemplo cargados', 'success')
  }, [userMode, setPatientsDelModo, setAppointmentsDirect, setProductsSync,
      setExpensesSync, addAuditLog, toast])

  const borrarDatosDeEjemplo = useCallback(() => {
    // Filtra por la marca `origenEjemplo` y por nada más. Un cliente real que
    // se llame igual que uno de ejemplo no se toca.
    setPatientsDelModo(sinEjemplos)
    setAppointmentsDirect(sinEjemplos)
    setProductsSync(sinEjemplos)
    setExpensesSync(sinEjemplos)
    addAuditLog('ELIMINAR', 'Datos de ejemplo', 'ejemplos')
    toast.addToast('🧹 Datos de ejemplo borrados', 'info')
  }, [setPatientsDelModo, setAppointmentsDirect, setProductsSync,
      setExpensesSync, addAuditLog, toast])

  const cuantosEjemplos = useMemo(
    () => contarEjemplos(patients) + contarEjemplos(appointmentsByMode)
        + contarEjemplos(products) + contarEjemplos(expenses),
    [patients, appointmentsByMode, products, expenses])

  // ========== SHARED PROPS ==========
  const sharedProps = {
    appointments:          appointmentsByMode,  // ← reemplazar Array.isArray(appointments) ? appointments : []
    patients:              Array.isArray(patients)     ? patients     : [],
    products:              Array.isArray(products)     ? products     : [],
    // Los setters que llegan a las pantallas son los sincronizados. Los crudos
    // se reservan para los caminos que ya escriben a Firestore por su cuenta
    // (el listener, la carga inicial, updateStatus) — si el listener usara el
    // sincronizado, cada snapshot del servidor se devolvería al servidor.
    setProducts:           setProductsSync,
    expenses:              Array.isArray(expenses)     ? expenses     : [],
    setExpenses:           setExpensesSync,
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
    deleteProduct,
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
    appVersion,
    cargarDatosDeEjemplo,
    borrarDatosDeEjemplo,
    cuantosEjemplos,
    user,
    onLogout,
    businessId,
    onBusinessChange,
    toast,
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
    alertas:      AlertasScreen,
  }

  // ========== RENDERIZADO CON WINDOWCONTROLS MODIFICADO ==========
  if (!licenseChecked) return null

  if (licenseStatus?.status === 'expired' || licenseStatus?.status === 'invalid') {
    return <LicenseScreen licenseStatus={licenseStatus} onActivate={handleActivateLicense} />
  }

  if (showSplash) {
    return <Splash onFinish={() => setShowSplash(false)} />
  }

  const windowControlsActions = (
    <>
      <AvisoDeError
        copiar={copiarAlPortapapeles}
        version={appVersion}
        userMode={userMode}
        plan={licenseStatus?.plan || licenseStatus?.status}
      />
      <NotificationCenter nav={nav} userMode={userMode} />
      <ReminderPanel nav={nav} patients={sharedProps.patients} />
      <BackupManager
        products={sharedProps.products}
        clients={clientesDelModo}
        // `sharedProps.appointments` es appointmentsByMode: la lista FILTRADA
        // por modo. El respaldo se la llevaba filtrada, pero al restaurar se
        // reemplaza el array completo — así que restaurar un respaldo hecho en
        // profesional borraba todos los pedidos de emprendedor, del estado y
        // de localStorage. Acá va el array entero.
        appointments={Array.isArray(appointments) ? appointments : []}
        expenses={sharedProps.expenses}
        settings={{ workingHours, consultationConfig }}
        setProducts={(restored) => {
          setProducts(restored)
          writeCollection(`zenday-${userMode}-products`, restored, { allowEmpty: true })
        }}
        setClients={(restored) => {
          if (userMode === 'entrepreneur') setPatientsEnt(restored)
          else setPatientsPro(restored)
          writeCollection(`zenday-${userMode}-patients`, restored, { allowEmpty: true })
        }}
        setAppointments={(restored) => {
          sharedProps.setAppointments(restored)
          writeCollection(`zenday-${userMode}-appointments`, restored, { allowEmpty: true })
        }}
        setExpenses={(restored) => {
          setExpenses(restored)
          writeCollection(`zenday-${userMode}-expenses`, restored, { allowEmpty: true })
        }}
        setSettings={(s) => {
          if (s.workingHours) setWorkingHours(s.workingHours)
          if (s.consultationConfig) setConsultationConfig(s.consultationConfig)
        }}
        orders={sharedProps.appointments}
        setOrders={(restored) => {
          sharedProps.setAppointments(restored)
          writeCollection(`zenday-${userMode}-appointments`, restored, { allowEmpty: true })
        }}
        stockMovements={[]}
        categories={[]}
        recurringRules={[]}
        setStockMovements={() => {}}
        setCategories={() => {}}
        setRecurringRules={() => {}}
        businessId={businessId}
        userMode={userMode}
      />
    </>
  )

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`} data-theme={theme}>
      <WindowControls actions={windowControlsActions} />

      {updateReady && updateInfo && updateInfo.downloadUrl && (
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
            🆕 Nueva versión {updateInfo.version} disponible — {updateInfo.releaseNotes || 'Mejoras y correcciones'}
          </span>
          <button
            onClick={async () => {
              const url = updateInfo.downloadUrl
              console.log('[Update] 🔗 Abriendo URL:', url)
              if (url && url.startsWith('http')) {
                try {
                  await window.electronAPI?.openExternal?.(url)
                } catch (err) {
                  console.error('[Update] Error abriendo URL:', err)
                }
              } else {
                console.error('[Update] URL inválida:', url)
              }
            }}
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
            Descargar actualización
          </button>
        </div>
      )}

      {licenseStatus?.status === 'trial' && (() => {
        // checkLicense() devuelve daysLeft; el código leía trialDaysLeft (undefined).
        // Se acepta cualquiera de los dos por compatibilidad con builds viejos.
        const trialDays = licenseStatus.daysLeft ?? licenseStatus.trialDaysLeft ?? 0
        return (
        <div style={{
          background: trialDays <= 2
            ? 'linear-gradient(90deg, rgba(239,68,68,0.12), rgba(239,68,68,0.06))'
            : 'linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.06))',
          borderBottom: `0.5px solid ${trialDays <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
          padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px',
        }}>
          <span style={{ color: trialDays <= 2 ? 'var(--accent-red)' : '#b45309', fontWeight: 500 }}>
            {trialDays <= 2 ? '⚠️' : '⏳'}{' '}
            Período de prueba — {trialDays === 1 ? 'queda 1 día' : `quedan ${trialDays} días`}
          </span>
          <button
            onClick={() => setLicenseStatus({ status: 'expired' })}
            style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '20px', border: '0.5px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#b45309', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Activar licencia
          </button>
        </div>
        )
      })()}

      <div className="app-container">
        <Sidebar
          activeTab={activeTab}
          onSwitchTab={(t) => { setActiveTab(t); nav.goToRoot(t) }}
          canGoBack={nav.canGoBack}
          userMode={userMode}
          user={user}
          onLogout={onLogout}
          alertas={cantidadDeAlertas}
        />

        <main className="main-content">
          {userMode !== 'entrepreneur' && (
            <div className="global-search-container">
              <GlobalSearch
                appointments={sharedProps.appointments}
                patients={sharedProps.patients}
                products={sharedProps.products}
                onSelectResult={handleGlobalSearch}
                onAltaRapida={handleAltaRapida}
              />
            </div>
          )}

          <div className="screens-container">
            {nav.stack.map((id, i) => {
              const S = SCREENS[id]
              if (!S) return null
              return (
                <div key={i} className={`screen ${i === nav.stack.length - 1 ? 'active' : ''}`}>
                  {/* Un error de render en una pantalla ya no desmonta toda la app.
                      key={id} hace que el boundary se limpie solo al navegar,
                      en vez de quedar trabado en el estado de error. */}
                  <ErrorBoundary key={id} scope={id} onReset={() => nav.goToRoot('dashboard')}>
                    {/* `loaded` existía desde siempre y NUNCA salía de App.jsx.
                        Mientras los datos venían en camino, cada pantalla se
                        dibujaba con los arrays vacíos: el Panel mostraba $0 en
                        los tres KPI, "↓ 0% vs anterior" y "No hay consultas para
                        hoy", y medio segundo después aparecían los números reales.

                        O sea que el programa le decía al usuario que su negocio no
                        había facturado nada, y después se corregía solo. Cada vez
                        que lo abría.

                        El gate va acá y no adentro de cada pantalla: es un solo
                        lugar y así ninguna queda afuera por olvido. Sólo aplica a
                        la carga inicial y al cambio de modo, que es cuando
                        `loaded` se apaga; navegar entre pantallas no lo dispara. */}
                    {loaded
                      ? <S {...sharedProps} params={nav.params[id] || {}} />
                      : <CargandoPantalla />}
                  </ErrorBoundary>
                </div>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}

// ─── COMPONENTE CON BUSINESS SETUP ───────────────────────────────────
function AppWithBusiness({ user, onLogout }) {
  const { businessId, loading, error } = useBusinessId(user)
  const [finalBusinessId, setFinalBusinessId] = useState(null)
  const [setupDone, setSetupDone] = useState(false)

  useEffect(() => {
    if (!loading && businessId) {
      setFinalBusinessId(businessId)
      const setupKey = `zenday-setup-done-${user.uid}`
      localStorage.setItem(setupKey, 'true')
      setSetupDone(true)
      console.log('[AppWithBusiness] BusinessId desde Firestore:', businessId)
    }
  }, [businessId, loading, user.uid])

  // Antes esto era `if (loading || !businessId) return null` y se descartaba el
  // error del hook. useBusinessId esta escrito a proposito para NO crear un
  // negocio nuevo cuando falla la lectura: ante un corte de red deja businessId
  // en null y devuelve un mensaje. Ese mensaje no lo leia nadie, asi que abrir
  // ZenDay sin internet daba una ventana en blanco: sin spinner, sin texto, sin
  // boton. Los datos locales estaban intactos y no habia forma de llegar a ellos.
  if (loading) return null

  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', gap: 12,
        padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40 }}>📡</div>
        <h2 style={{ margin: 0 }}>No se pudo conectar</h2>
        <p style={{ margin: 0, maxWidth: 420 }}>
          {error.message || 'No se pudo contactar con el servidor.'}
        </p>
        <p style={{ margin: 0, maxWidth: 420, opacity: 0.7, fontSize: 14 }}>
          Tus datos siguen guardados en esta computadora. Reintentá cuando
          tengas conexión.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reintentar
          </button>
          <button className="btn-secondary" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (!businessId) return null

  if (!setupDone) {
    return (
      <BusinessSetupScreen
        user={user}
        businessId={businessId}
        onComplete={(bid) => {
          const setupKey = `zenday-setup-done-${user.uid}`
          localStorage.setItem(setupKey, 'true')
          setFinalBusinessId(bid)
          setSetupDone(true)
        }}
      />
    )
  }

  return (
    <AppContent
      user={user}
      onLogout={onLogout}
      businessId={finalBusinessId}
      onBusinessChange={(newId) => {
        const setupKey = `zenday-setup-done-${user.uid}`
        localStorage.removeItem(setupKey)
        setFinalBusinessId(newId)
        setSetupDone(false)
      }}
    />
  )
}

// ─── EXPORT DEFAULT CON AUTENTICACIÓN ─────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthChecked(true)
    })
    return () => unsub()
  }, [])

  if (!authChecked) return null

  if (!user) {
    return (
      <ToastProvider>
        <LoginScreen onLogin={setUser} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <NotificationProvider>
        <ReminderProvider>
          <ConfirmProvider>
            <AppWithBusiness user={user} onLogout={() => signOut(auth)} />
          </ConfirmProvider>
        </ReminderProvider>
      </NotificationProvider>
    </ToastProvider>
  )
}