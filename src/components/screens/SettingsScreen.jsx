import React, { useState, useRef, useEffect, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { copiarAlPortapapeles } from '../../utils/helpers'
import { armarReporte, ultimosErrores } from '../../utils/reporteDeErrores'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { USER_MODES } from '../../utils/constants'
import {
  exportPatientsToPDF, exportProductsToPDF, exportAppointmentsToPDF,
  exportPatientsToExcel, exportProductsToExcel, exportAppointmentsToExcel,
  downloadPatientTemplate, downloadProductTemplate
} from '../../utils/exportImport'
import { leaveBusiness, joinBusiness, removeMember, setMemberRole } from '../../hooks/useBusinessId'
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, rolDe } from '../../utils/businessRoles'
import { esMobil } from '../../utils/platform'

// ─── CONSTANTES (fuera del componente) ───────────────────────────────────────

const BUSINESS_RULES = {
  MIN_PRICE:       0,
  MAX_PRICE:       999_999,
  MIN_DURATION:    5,
  MAX_DURATION:    480,
  MIN_HOURLY_RATE: 0,
  MAX_HOURLY_RATE: 99_999,
  MAX_BACKUPS:     5,
}

const SECTIONS = [
  { id: 'general',    label: 'General',    icon: '⚙️' },
  { id: 'appearance', label: 'Apariencia', icon: '🎨' },
  { id: 'business',   label: 'Negocio',    icon: '💼' },
  { id: 'license',    label: 'Licencia',   icon: '🔑' },
  { id: 'data',       label: 'Datos',      icon: '📦' },
]

// Los swatches usan los tokens FIJOS (--indigo, --rose, etc.), no
// --accent-blue/--accent-green: esos dos cambian con el tema activo, así que
// si se usaran acá, la vista previa de "Violeta" mostraría el color del tema
// que ya está puesto en vez del que representa cada opción.
const THEME_COLORS = [
  { id: 'violet',  name: 'Violeta',    color: 'var(--indigo)' },
  { id: 'rose',    name: 'Rosa',       color: 'var(--rose)' },
  { id: 'cyan',    name: 'Cyan',       color: 'var(--sky)' },
  { id: 'amber',   name: 'Ámbar',      color: 'var(--amber)' },
  { id: 'emerald', name: 'Esmeralda',  color: 'var(--emerald)' },
]

const LICENSE_KEY_PATTERN = /^ZENDAY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

const CONFIG_BACKUP_KEY = 'zenday-config-backups'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const backupCurrentConfig = (consultationConfig, workingHours) => {
  try {
    const backups = JSON.parse(localStorage.getItem(CONFIG_BACKUP_KEY) || '[]')
    backups.unshift({ timestamp: new Date().toISOString(), config: consultationConfig, workingHours })
    if (backups.length > BUSINESS_RULES.MAX_BACKUPS) backups.pop()
    localStorage.setItem(CONFIG_BACKUP_KEY, JSON.stringify(backups))
  } catch (err) {
    console.error('[BACKUP] Failed:', err)
  }
}

const validateBusinessConfig = (config) => {
  const errors = []
  if (typeof config.defaultDuration !== 'number' ||
      config.defaultDuration < BUSINESS_RULES.MIN_DURATION ||
      config.defaultDuration > BUSINESS_RULES.MAX_DURATION) {
    errors.push(`Duración debe estar entre ${BUSINESS_RULES.MIN_DURATION} y ${BUSINESS_RULES.MAX_DURATION} min`)
  }
  if (typeof config.defaultPrice !== 'number' ||
      config.defaultPrice < BUSINESS_RULES.MIN_PRICE ||
      config.defaultPrice > BUSINESS_RULES.MAX_PRICE) {
    errors.push(`Precio debe estar entre $${BUSINESS_RULES.MIN_PRICE} y $${BUSINESS_RULES.MAX_PRICE}`)
  }
  if (config.pricePerHour &&
     (typeof config.hourlyRate !== 'number' ||
      config.hourlyRate < BUSINESS_RULES.MIN_HOURLY_RATE ||
      config.hourlyRate > BUSINESS_RULES.MAX_HOURLY_RATE)) {
    errors.push(`Tarifa por hora debe estar entre $${BUSINESS_RULES.MIN_HOURLY_RATE} y $${BUSINESS_RULES.MAX_HOURLY_RATE}`)
  }
  return errors
}

const sanitizeBusinessConfig = (config) => ({
  ...config,
  defaultDuration: Math.min(BUSINESS_RULES.MAX_DURATION, Math.max(BUSINESS_RULES.MIN_DURATION, parseInt(config.defaultDuration) || 30)),
  defaultPrice:    Math.min(BUSINESS_RULES.MAX_PRICE,    Math.max(BUSINESS_RULES.MIN_PRICE,    parseInt(config.defaultPrice)    || 0)),
  hourlyRate: config.pricePerHour
    ? Math.min(BUSINESS_RULES.MAX_HOURLY_RATE, Math.max(BUSINESS_RULES.MIN_HOURLY_RATE, parseInt(config.hourlyRate) || 0))
    : 0,
})

const auditLog = (action, details, userId) => {
  const entry = { timestamp: new Date().toISOString(), action, userId: userId || 'unknown', details, component: 'SettingsScreen' }
  console.info('[AUDIT]', entry)
  try {
    const logs = JSON.parse(localStorage.getItem('audit-logs') || '[]')
    logs.push(entry)
    if (logs.length > 1000) logs.shift()
    localStorage.setItem('audit-logs', JSON.stringify(logs))
  } catch { /* sin espacio o storage no disponible: se descarta el log local */ }
  if (['LICENSE_ACTIVATE','LICENSE_DEACTIVATE','CONFIG_CHANGE','USER_ID_COPIED'].includes(action)) {
    window.electronAPI?.sendAuditLog?.(entry)?.catch?.(console.error)
  }
}

// ─── DEBOUNCE HOOK ────────────────────────────────────────────────────────────

function useDebounced(fn, delay) {
  const timer    = useRef(null)
  const fnRef    = useRef(fn)

  // Actualizar el ref en un efecto, no durante el render: mutar un ref
  // mientras se renderiza es inseguro con las funciones concurrentes de React.
  useEffect(() => { fnRef.current = fn }, [fn])

  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fnRef.current(...args), delay)
  }, [delay])
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function SettingsScreen({
  nav, darkMode, setDark, workingHours, setWorkingHours,
  theme, setTheme, userMode, setUserMode,
  consultationConfig, setConsultationConfig,
  patients, products, appointments,
  licenseStatus, onDeactivateLicense, onActivateLicense, user,
  businessId, onBusinessChange, businessDoc, myRole,
  cargarDatosDeEjemplo, borrarDatosDeEjemplo, cuantosEjemplos = 0,
  appVersion,
}) {
  const focusRef = useScreenFocus()
  const toast    = useToast()
  const { confirm }  = useConfirm()

  const [localWorkingHours, setLocalWorkingHours] = useState(workingHours)
  const [localConfig,       setLocalConfig]       = useState(consultationConfig)
  const [userName,          setUserName]           = useState(() => localStorage.getItem('zenday-user-name') || 'Usuario')
  const [activeSection,     setActiveSection]      = useState('general')
  const [showLicenseModal,  setShowLicenseModal]   = useState(false)
  const [newLicenseKey,     setNewLicenseKey]      = useState('')
  const [isActivating,      setIsActivating]       = useState(false)
  const [isDeactivating,    setIsDeactivating]     = useState(false)
  const [isExporting,       setIsExporting]        = useState({})
  
  // Estados para gestión de negocio
  const [showBusinessPanel, setShowBusinessPanel] = useState(false)
  const [copied, setCopied] = useState(false)
  const [leavingBusiness, setLeavingBusiness] = useState(false)
  const [joiningCode, setJoiningCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [memberActionUid, setMemberActionUid] = useState(null) // uid con una acción en curso (expulsar/cambiar rol)

  const activationInProgress = useRef(false)

  const isModeLocked    = licenseStatus?.status === 'active' && licenseStatus?.plan !== 'master'

  // ── Guardar horario ────────────────────────────────────────────────────────
  const saveWorkingHours = useCallback(() => {
    try {
      backupCurrentConfig(consultationConfig, workingHours)
      setWorkingHours(localWorkingHours)
      auditLog('WORKING_HOURS_CHANGED', { from: workingHours, to: localWorkingHours }, user?.uid)
      toast.addToast('✅ Horario guardado', 'success')
    } catch {
      toast.addToast('❌ Error al guardar horario', 'error')
    }
  }, [localWorkingHours, workingHours, consultationConfig, setWorkingHours, user, toast])

  const debouncedSave = useDebounced(saveWorkingHours, 1000)

  // ── Guardar config de negocio ──────────────────────────────────────────────
  const saveConfig = useCallback(() => {
    const errors = validateBusinessConfig(localConfig)
    if (errors.length > 0) {
      toast.addToast(`❌ ${errors[0]}`, 'error')
      return
    }
    try {
      backupCurrentConfig(consultationConfig, workingHours)
      const sanitized = sanitizeBusinessConfig(localConfig)
      setConsultationConfig(sanitized)
      auditLog('CONFIG_CHANGED', { from: consultationConfig, to: sanitized }, user?.uid)
      toast.addToast('✅ Configuración guardada', 'success')
    } catch {
      toast.addToast('❌ Error al guardar configuración', 'error')
    }
  }, [localConfig, consultationConfig, workingHours, setConsultationConfig, user, toast])

  // ── Guardar nombre ─────────────────────────────────────────────────────────
  const saveUserName = useCallback(() => {
    const name = userName.trim().slice(0, 50)
    localStorage.setItem('zenday-user-name', name)
    setUserName(name)
    auditLog('USER_NAME_CHANGED', { name }, user?.uid)
    toast.addToast('✅ Usuario guardado', 'success')
  }, [userName, user, toast])

  // ── Cambiar modo ───────────────────────────────────────────────────────────
  const handleUserModeChange = useCallback((newMode) => {
    if (isModeLocked) {
      toast.addToast('❌ No se puede cambiar el modo con licencia activa', 'error')
      return
    }
    setUserMode(newMode)
    auditLog('MODE_CHANGED', { from: userMode, to: newMode }, user?.uid)
  }, [isModeLocked, setUserMode, userMode, user, toast])

  // ── Licencia: cambiar ──────────────────────────────────────────────────────
  const handleChangeLicense = useCallback(async () => {
    const ok = await confirm('⚠️ CAMBIAR LICENCIA\n\nAl cambiar la licencia, se perderá la licencia actual.\n\n¿Deseás continuar?', 'Cambiar licencia')
    if (ok) setShowLicenseModal(true)
  }, [confirm])

  // ── Licencia: desactivar ───────────────────────────────────────────────────
  const handleDeactivateLicense = useCallback(async () => {
    if (isDeactivating || !onDeactivateLicense) return
    const ok = await confirm('⚠️ DESACTIVAR LICENCIA\n\nVolverás al modo de prueba.\n\n¿Deseás continuar?', 'Desactivar licencia')
    if (!ok) return

    setIsDeactivating(true)
    try {
      const result = await onDeactivateLicense()
      if (result?.success) {
        toast.addToast('✅ Licencia desactivada', 'success')
        await new Promise(r => setTimeout(r, 500))
        window.location.reload()
      } else {
        toast.addToast('❌ Error al desactivar la licencia', 'error')
      }
    } catch {
      toast.addToast('❌ Error al desactivar la licencia', 'error')
    } finally {
      setIsDeactivating(false)
    }
  }, [isDeactivating, onDeactivateLicense, confirm, toast])

  // ── Licencia: activar ──────────────────────────────────────────────────────
  const handleActivateNewLicense = useCallback(async () => {
    if (activationInProgress.current || isActivating) return
    if (!newLicenseKey.trim()) { toast.addToast('❌ Ingresá una clave de licencia', 'error'); return }
    if (!LICENSE_KEY_PATTERN.test(newLicenseKey.trim())) { toast.addToast('❌ Formato de licencia inválido', 'error'); return }

    activationInProgress.current = true
    setIsActivating(true)
    try {
      const result = await onActivateLicense(newLicenseKey.trim())
      if (result?.success) {
        toast.addToast(`✅ Licencia activada: ${result.plan === 'professional' ? 'Profesional' : 'Emprendedor'}`, 'success')
        setShowLicenseModal(false)
        setNewLicenseKey('')
        setTimeout(() => window.location.reload(), 800)
      } else {
        toast.addToast(result?.message || '❌ Licencia inválida', 'error')
      }
    } catch {
      toast.addToast('❌ Error al activar licencia. Contactá soporte.', 'error')
    } finally {
      activationInProgress.current = false
      setIsActivating(false)
    }
  }, [isActivating, newLicenseKey, onActivateLicense, toast])

  // ── Clipboard ──────────────────────────────────────────────────────────────
  // FIX: el ID se copiaba al portapapeles pero NUNCA se mostraba en pantalla.
  // El usuario apretaba "Copiar ID", veía "✅ ID copiado" y un espacio en blanco:
  // no podía verificar qué copió, ni leérselo a alguien por teléfono, ni
  // enterarse si el portapapeles fallaba. Ahora se muestra siempre.
  const [deviceId, setDeviceId] = useState('')

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const id = await window.electronAPI?.getDeviceId?.()
        if (!cancelado) setDeviceId(id || '')
      } catch {
        if (!cancelado) setDeviceId('')
      }
    })()
    return () => { cancelado = true }
  }, [])

  const handleCopyDeviceId = useCallback(async () => {
    const id = deviceId || await window.electronAPI?.getDeviceId?.()
    if (!id) { toast.addToast('❌ No se pudo obtener el ID del dispositivo', 'error'); return }
    const ok = await copiarAlPortapapeles(id)
    toast.addToast(ok ? '✅ ID copiado' : '❌ No se pudo copiar. Seleccionalo y copialo a mano.', ok ? 'success' : 'error')
  }, [deviceId, toast])

  const handleCopyUserId = useCallback(async () => {
    if (!user?.uid) return
    const ok = await confirm('⚠️ El ID de usuario es información sensible.\n\nSolo compartilo con soporte técnico autorizado.\n\n¿Deseás continuar?', 'Copiar ID de usuario')
    if (!ok) return
    const copied = await copiarAlPortapapeles(user.uid)
    if (copied) { auditLog('USER_ID_COPIED', { prefix: user.uid.slice(0,8)+'...' }, user.uid) }
    toast.addToast(copied ? '✅ ID copiado' : '❌ Error al copiar el ID', copied ? 'success' : 'error')
  }, [user, confirm, toast])

  // ── Gestión de negocio ─────────────────────────────────────────────────────
  // FIX: llamaba a navigator.clipboard.writeText sin await ni catch. Cuando el
  // permiso está denegado eso deja un "Uncaught (in promise) NotAllowedError"
  // en la consola, y encima marcaba "copiado" aunque no hubiera copiado nada.
  const handleCopyCode = async () => {
    const ok = await copiarAlPortapapeles(businessId)
    if (!ok) {
      toast.addToast('No se pudo copiar. Seleccioná el código y usá Ctrl+C.', 'error')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Cargar no pregunta nada: no destruye nada y se deshace con un botón.
  // Borrar sí pregunta, aunque sólo toque lo marcado como ejemplo: quien no
  // sepa qué es un "dato de ejemplo" merece leerlo antes de apretar.
  // El boton que convierte un "no anda" en algo que se puede arreglar.
  //
  // Un cliente no tiene DevTools ni sabe que existe una consola. Sin esto, lo
  // unico que llega es "no funciona" y ahi se termina la conversacion. Con
  // esto llega un texto que dice que fallo, cuando, en que version y en que
  // modo — listo para pegar en un WhatsApp.
  const reportarProblema = async () => {
    const texto = armarReporte({
      version: appVersion,
      userMode,
      plan: licenseStatus?.plan || licenseStatus?.status,
    })
    const ok = await copiarAlPortapapeles(texto)
    toast.addToast(
      ok ? '📋 Reporte copiado. Pegalo donde quieras mandarlo.'
         : '❌ No se pudo copiar. Fijate en Configuración → Datos.',
      ok ? 'success' : 'error')
  }

  const borrarEjemplos = async () => {
    const ok = await confirm(
      `Se borran ${cuantosEjemplos} registros de ejemplo.\n\nTus datos reales no se tocan.`,
      'Borrar los datos de ejemplo'
    )
    if (ok) borrarDatosDeEjemplo?.()
  }

  // Usa el modal propio de la app, no el cartel del sistema operativo.
  const handleLeaveBusiness = async () => {
    const ok = await confirm(
      '⚠️ Vas a perder acceso a los datos compartidos y se te creará un negocio propio vacío.\n\n¿Deseás continuar?',
      'Salir del negocio actual'
    )
    if (!ok) return

    setLeavingBusiness(true)
    try {
      const newId = await leaveBusiness(user, businessId)
      localStorage.removeItem(`zenday-setup-done-${user.uid}`)
      onBusinessChange(newId)
      toast.addToast('✅ Saliste del negocio', 'success')
    } catch (err) {
      console.error('[Settings] Error al salir:', err)
      toast.addToast('❌ Error al salir del negocio', 'error')
    } finally {
      setLeavingBusiness(false)
    }
  }

  // ── Miembros: expulsar y cambiar rol (sólo el dueño ve estos controles;
  // firestore.rules es la barrera real, esto sólo evita ofrecer un botón que
  // el servidor va a rechazar) ─────────────────────────────────────────────
  const handleRemoveMember = async (uid, etiqueta) => {
    const ok = await confirm(
      `¿Expulsar a ${etiqueta} de este negocio?\n\nPierde el acceso de inmediato. Puede volver a unirse si todavía tiene el código.`,
      'Expulsar miembro'
    )
    if (!ok) return

    setMemberActionUid(uid)
    try {
      await removeMember(businessId, uid)
      toast.addToast(`✅ ${etiqueta} ya no tiene acceso`, 'success')
    } catch (err) {
      console.error('[Settings] Error al expulsar:', err)
      toast.addToast('❌ No se pudo expulsar', 'error')
    } finally {
      setMemberActionUid(null)
    }
  }

  const handleChangeRole = async (uid, nuevoRol) => {
    setMemberActionUid(uid)
    try {
      await setMemberRole(businessId, uid, nuevoRol)
      toast.addToast(`✅ Rol actualizado a ${ROLE_LABELS[nuevoRol]}`, 'success')
    } catch (err) {
      console.error('[Settings] Error al cambiar rol:', err)
      toast.addToast('❌ No se pudo cambiar el rol', 'error')
    } finally {
      setMemberActionUid(null)
    }
  }

  // ── Exportar ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(async (type, exportFn, ...args) => {
    setIsExporting(prev => {
      if (prev[type]) return prev
      return { ...prev, [type]: true }
    })

    try {
      toast.addToast(`📊 Generando ${type}…`, 'info')
      await exportFn(...args)
      toast.addToast(`✅ ${type} exportado`, 'success')
    } catch (err) {
      toast.addToast(`❌ Error al exportar ${type}`, 'error')
    } finally {
      setIsExporting(prev => ({ ...prev, [type]: false }))
    }
  }, [toast])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="settings-screen-premium">
      <div className="settings-header">
        <BackButton onClick={() => nav.goBack()} />
        <h1 className="settings-title">Configuración</h1>
        <div className="settings-header-placeholder" />
      </div>

      <div className="settings-layout">

        {/* Sidebar */}
        <div className="settings-sidebar">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              <span className="nav-icon">{s.icon}</span>
              <span className="nav-label">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="settings-content">

          {/* ── GENERAL ──────────────────────────────────────────────────── */}
          {activeSection === 'general' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>General</h2>
                <p>Configuración básica de tu cuenta</p>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>👤 Usuario</label>
                  <span className="setting-hint">Tu cuenta de ZenDay</span>
                </div>
                <div className="user-info-display">
                  <div className="user-name">{user?.displayName ?? user?.email?.split('@')[0] ?? 'Usuario'}</div>
                  {user?.email && <div className="user-email">{user.email}</div>}
                </div>
              </div>

              {user?.uid && (
                <div className="setting-row">
                  <div className="setting-info">
                    <label>🆔 ID de usuario</label>
                    <span className="setting-hint">Identificador único de tu cuenta</span>
                  </div>
                  <div className="user-id">
                    <code>{user.uid.slice(0,8)}…{user.uid.slice(-6)}</code>
                    <button className="copy-id-btn" onClick={handleCopyUserId} title="Copiar (solo para soporte)">📋</button>
                  </div>
                </div>
              )}

              <div className="divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Nombre para auditoría</label>
                  <span className="setting-hint">Aparecerá en el registro de actividades</span>
                </div>
                <input
                  type="text"
                  className="setting-input-premium"
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  onBlur={saveUserName}
                  placeholder="Tu nombre"
                  maxLength={50}
                />
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Modo de uso</label>
                  <span className="setting-hint">
                    {isModeLocked ? '🔒 Bloqueado por licencia activa' : 'Elegí cómo usás ZenDay'}
                  </span>
                </div>
                <select
                  className="setting-select-premium"
                  value={userMode}
                  onChange={e => handleUserModeChange(e.target.value)}
                  disabled={isModeLocked}
                >
                  {Object.entries(USER_MODES).map(([key, mode]) => (
                    <option key={key} value={key}>{mode.icon} {mode.label}</option>
                  ))}
                </select>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Horario laboral</label>
                  <span className="setting-hint">Define tu jornada de trabajo</span>
                </div>
                <div className="time-inputs">
                  <input
                    type="time"
                    value={localWorkingHours.start}
                    onChange={e => {
                      const val = e.target.value
                      setLocalWorkingHours(prev => {
                        const next = { ...prev, start: val }
                        debouncedSave()
                        return next
                      })
                    }}
                  />
                  <span>a</span>
                  <input
                    type="time"
                    value={localWorkingHours.end}
                    onChange={e => {
                      const val = e.target.value
                      setLocalWorkingHours(prev => {
                        const next = { ...prev, end: val }
                        debouncedSave()
                        return next
                      })
                    }}
                  />
                </div>
              </div>

              <button className="save-btn-premium" onClick={saveWorkingHours}>
                Guardar cambios
              </button>
            </div>
          )}

          {/* ── APARIENCIA ────────────────────────────────────────────────── */}
          {activeSection === 'appearance' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>Apariencia</h2>
                <p>Personalizá cómo se ve ZenDay</p>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Modo oscuro</label>
                  <span className="setting-hint">Más cómodo para trabajar de noche</span>
                </div>
                <label className="toggle-premium">
                  <input type="checkbox" checked={darkMode} onChange={() => setDark(!darkMode)} />
                  <span className="toggle-slider-premium" />
                </label>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Color de acento</label>
                  <span className="setting-hint">El color principal de la interfaz</span>
                </div>
                <div className="color-picker">
                  {THEME_COLORS.map(t => (
                    <button
                      key={t.id}
                      className={`color-option ${theme === t.id ? 'active' : ''}`}
                      style={{ backgroundColor: t.color }}
                      onClick={() => setTheme(t.id)}
                      title={t.name}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── NEGOCIO ───────────────────────────────────────────────────── */}
          {activeSection === 'business' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>Negocio</h2>
                <p>Configuración de consultas, precios y gestión de equipo</p>
              </div>

              {/* Sección de gestión del negocio */}
              {user && businessId && (
                <div className="settings-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px' }}>🏪 Mi negocio</h3>
                    <button onClick={() => setShowBusinessPanel(v => !v)} style={{
                      fontSize: '12px', padding: '4px 12px',
                      borderRadius: '20px', border: '0.5px solid var(--border)',
                      background: 'transparent', cursor: 'pointer'
                    }}>
                      {showBusinessPanel ? 'Ocultar' : 'Gestionar'}
                    </button>
                  </div>

                  {showBusinessPanel && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      
                      {/* Código actual */}
                      <div style={{
                        background: 'var(--bg-secondary)', borderRadius: '12px',
                        padding: '16px', border: '1px solid var(--border)'
                      }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>
                          📋 Código de tu negocio
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'monospace',
                          letterSpacing: '0.1em', marginBottom: '10px' }}>
                          {businessId}
                        </div>
                        <button onClick={handleCopyCode} style={{
                          width: '100%', padding: '8px',
                          background: copied ? 'var(--accent-green)' : 'var(--accent-blue)',
                          border: 'none', borderRadius: '8px',
                          color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '13px'
                        }}>
                          {copied ? '✅ Copiado!' : '📋 Copiar para compartir'}
                        </button>
                      </div>

                      {/* Miembros: quién está adentro, y qué puede ver cada uno */}
                      <div style={{
                        background: 'var(--bg-secondary)', borderRadius: '12px',
                        padding: '16px', border: '1px solid var(--border)'
                      }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                          👥 Miembros ({businessDoc?.members?.length || 0})
                        </div>

                        {myRole !== ROLES.DUENO && (
                          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
                            Tu rol acá es {ROLE_LABELS[myRole]}. Sólo el dueño puede
                            expulsar miembros o cambiar roles.
                          </p>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {(businessDoc?.members || []).map(uid => {
                            const esYo = uid === user?.uid
                            const rolDeEste = rolDe(businessDoc, uid)
                            const etiqueta = businessDoc?.memberEmails?.[uid]
                              || (esYo ? (user?.email || uid) : `Miembro ${uid.slice(0, 6)}…`)
                            const enCurso = memberActionUid === uid

                            return (
                              <div key={uid} style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 10px', borderRadius: '10px',
                                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: '13px', fontWeight: 600,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {etiqueta}{esYo && ' (vos)'}
                                  </div>
                                  {myRole !== ROLES.DUENO && (
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                      {ROLE_LABELS[rolDeEste]}
                                    </div>
                                  )}
                                </div>

                                {myRole === ROLES.DUENO && !esYo ? (
                                  <>
                                    <select
                                      value={rolDeEste}
                                      disabled={enCurso}
                                      onChange={e => handleChangeRole(uid, e.target.value)}
                                      title={ROLE_DESCRIPTIONS[rolDeEste]}
                                      style={{
                                        fontSize: '12px', padding: '5px 8px', borderRadius: '8px',
                                        border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                                        color: 'var(--text-primary)',
                                      }}
                                    >
                                      {Object.values(ROLES).map(r => (
                                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={() => handleRemoveMember(uid, etiqueta)}
                                      disabled={enCurso}
                                      title="Expulsar de este negocio"
                                      style={{
                                        padding: '5px 10px', borderRadius: '8px',
                                        border: '1px solid var(--accent-red)', background: 'transparent',
                                        color: 'var(--accent-red)', fontSize: '12px', fontWeight: 600,
                                        cursor: enCurso ? 'default' : 'pointer', opacity: enCurso ? 0.5 : 1,
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      🚫 Expulsar
                                    </button>
                                  </>
                                ) : (
                                  myRole === ROLES.DUENO && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                      {ROLE_LABELS[rolDeEste]}
                                    </span>
                                  )
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Unirse a otro negocio */}
                      <div style={{
                        background: 'var(--bg-secondary)', borderRadius: '12px',
                        padding: '16px', border: '1px solid var(--border)'
                      }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                          🤝 Unirme a otro negocio
                        </div>
                        <input
                          type="text"
                          value={joiningCode}
                          onChange={e => setJoiningCode(e.target.value.toUpperCase())}
                          placeholder="XXXX-XXXX-XXXX"
                          style={{
                            width: '100%', padding: '10px 14px',
                            borderRadius: '10px', border: '1px solid var(--border)',
                            background: 'var(--bg-primary)', fontSize: '14px',
                            fontFamily: 'monospace', letterSpacing: '0.05em',
                            marginBottom: '8px', boxSizing: 'border-box'
                          }}
                        />
                        {joinError && (
                          <p style={{ color: 'var(--accent-red)', fontSize: '12px', marginBottom: '8px' }}>
                            ⚠️ {joinError}
                          </p>
                        )}
                        <button
                          onClick={async () => {
                            if (!joiningCode.trim()) { setJoinError('Ingresá un código'); return }
                            try {
                              setJoinError('')
                              const newId = await joinBusiness(user, joiningCode)
                              localStorage.removeItem(`zenday-setup-done-${user.uid}`)
                              onBusinessChange(newId)
                              toast.addToast('✅ Te uniste al negocio', 'success')
                              setJoiningCode('')
                              setShowBusinessPanel(false)
                            } catch (err) {
                              setJoinError(err.message === 'INVALID_CODE' ? 'Código inválido' : 'Error al unirse')
                            }
                          }}
                          style={{
                            width: '100%', padding: '8px',
                            background: 'var(--accent-green)', border: 'none', borderRadius: '8px',
                            color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '13px'
                          }}
                        >
                          Unirme
                        </button>
                      </div>

                      {/* Salir del negocio */}
                      <button onClick={handleLeaveBusiness} disabled={leavingBusiness} style={{
                        width: '100%', padding: '10px',
                        background: 'transparent', border: '1px solid var(--accent-red)',
                        borderRadius: '10px', color: 'var(--accent-red)',
                        fontWeight: 500, cursor: 'pointer', fontSize: '13px'
                      }}>
                        {leavingBusiness ? '⏳ Saliendo...' : '🚪 Salir del negocio y crear el mío'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Duración por defecto</label>
                  <span className="setting-hint">Minutos de cada consulta/pedido</span>
                </div>
                <div className="input-with-unit">
                  <input
                    type="number"
                    value={localConfig.defaultDuration}
                    onChange={e => setLocalConfig(prev => ({ ...prev, defaultDuration: parseInt(e.target.value) || 30 }))}
                    min={BUSINESS_RULES.MIN_DURATION} max={BUSINESS_RULES.MAX_DURATION}
                  />
                  <span>min</span>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Precio por defecto</label>
                  <span className="setting-hint">Precio sugerido para nuevos pedidos</span>
                </div>
                <div className="input-with-unit">
                  <span>$</span>
                  <input
                    type="number"
                    value={localConfig.defaultPrice}
                    onChange={e => setLocalConfig(prev => ({ ...prev, defaultPrice: parseInt(e.target.value) || 0 }))}
                    min={BUSINESS_RULES.MIN_PRICE} max={BUSINESS_RULES.MAX_PRICE}
                  />
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Precio por hora</label>
                  <span className="setting-hint">Calcula automáticamente según duración</span>
                </div>
                <label className="toggle-premium">
                  <input
                    type="checkbox"
                    checked={localConfig.pricePerHour ?? false}
                    onChange={e => setLocalConfig(prev => ({ ...prev, pricePerHour: e.target.checked }))}
                  />
                  <span className="toggle-slider-premium" />
                </label>
              </div>

              {localConfig.pricePerHour && (
                <div className="setting-row">
                  <div className="setting-info">
                    <label>Tarifa por hora</label>
                    <span className="setting-hint">Precio por cada hora de servicio</span>
                  </div>
                  <div className="input-with-unit">
                    <span>$</span>
                    <input
                      type="number"
                      value={localConfig.hourlyRate ?? 0}
                      onChange={e => setLocalConfig(prev => ({ ...prev, hourlyRate: parseInt(e.target.value) || 0 }))}
                      min={BUSINESS_RULES.MIN_HOURLY_RATE} max={BUSINESS_RULES.MAX_HOURLY_RATE}
                    />
                  </div>
                </div>
              )}

              <button className="save-btn-premium" onClick={saveConfig}>
                Guardar configuración
              </button>
            </div>
          )}

          {/* ── LICENCIA ──────────────────────────────────────────────────── */}
          {activeSection === 'license' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>Licencia</h2>
                <p>Gestioná tu licencia de ZenDay</p>
              </div>

              {esMobil() ? (
                // La licencia se activa desde la PC, con clave y dispositivo.
                // El celular no tiene esa licencia propia a propósito: si sos
                // miembro de un negocio con licencia activa, ya tenés acceso
                // acá — mostrar esta sección tal cual dejaría "Activar
                // licencia" siempre oculto y el estado siempre en blanco, sin
                // explicar por qué.
                <div className="setting-row">
                  <div className="setting-info">
                    <label>📱 No hace falta activar nada acá</label>
                    <span className="setting-hint">
                      La licencia se gestiona desde la PC. Si sos parte de un
                      negocio con licencia activa, ya tenés acceso completo
                      desde el celular con tu cuenta.
                    </span>
                  </div>
                </div>
              ) : (
              <>
              <div className="setting-row">
                <div className="setting-info">
                  <label>Estado</label>
                  <span className="setting-hint">Situación actual de tu licencia</span>
                </div>
                <div className="license-status">
                  {licenseStatus?.status === 'active'  && <span style={{ color:'var(--accent-green)', fontWeight:700 }}>✅ Activa — Plan {licenseStatus.plan === 'professional' ? 'Profesional' : 'Emprendedor'}</span>}
                  {licenseStatus?.status === 'trial'   && <span style={{ color:'var(--accent-amber)', fontWeight:700 }}>⏳ Trial — {licenseStatus.daysLeft} días restantes</span>}
                  {licenseStatus?.status === 'expired' && <span style={{ color:'var(--accent-red)', fontWeight:700 }}>❌ Expirada</span>}
                </div>
              </div>

              <div className="divider" />

              {licenseStatus?.status === 'active' && (
                <>
                  <div className="setting-row">
                    <div className="setting-info">
                      <label>Cambiar licencia</label>
                      <span className="setting-hint">Activar una nueva (reemplazará la actual)</span>
                    </div>
                    <button className="btn-secondary" onClick={handleChangeLicense}>🔑 Cambiar</button>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <label>Desactivar licencia</label>
                      <span className="setting-hint">Volver al modo de prueba</span>
                    </div>
                    <button
                      className="btn-secondary"
                      onClick={handleDeactivateLicense}
                      disabled={isDeactivating}
                      style={{ color:'var(--accent-red)', borderColor:'var(--accent-red)', opacity: isDeactivating ? .6 : 1 }}
                    >
                      {isDeactivating ? 'Desactivando…' : '🗑️ Desactivar'}
                    </button>
                  </div>
                </>
              )}

              {(licenseStatus?.status === 'trial' || licenseStatus?.status === 'expired') && (
                <div className="setting-row">
                  <div className="setting-info">
                    <label>Activar licencia</label>
                    <span className="setting-hint">Ingresá tu clave de licencia</span>
                  </div>
                  <button className="btn-primary" onClick={() => setShowLicenseModal(true)}>🔑 Activar</button>
                </div>
              )}

              <div className="divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>ID del dispositivo</label>
                  <span className="setting-hint">Pasale este ID a soporte para obtener tu licencia</span>
                  {deviceId ? (
                    <code
                      onClick={(e) => {
                        // Un clic selecciona todo: si el portapapeles falla,
                        // el usuario igual puede copiarlo con Ctrl+C.
                        const r = document.createRange()
                        r.selectNodeContents(e.currentTarget)
                        const sel = window.getSelection()
                        sel.removeAllRanges()
                        sel.addRange(r)
                      }}
                      title="Clic para seleccionar"
                      style={{
                        display: 'inline-block', marginTop: 8, padding: '7px 12px',
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm, 10px)', fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-primary)',
                        userSelect: 'all', cursor: 'text',
                      }}
                    >
                      {deviceId}
                    </code>
                  ) : (
                    <span style={{ marginTop: 8, fontSize: 13, color: 'var(--text-tertiary)' }}>
                      Cargando…
                    </span>
                  )}
                </div>
                <button className="btn-secondary" onClick={handleCopyDeviceId}>📋 Copiar ID</button>
              </div>
              </>
              )}
            </div>
          )}

          {/* ── DATOS ─────────────────────────────────────────────────────── */}
          {activeSection === 'data' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>Datos</h2>
                <p>Exportá, importá y gestioná tu información</p>
              </div>

              {/* Va PRIMERO a propósito: quien abre esta pantalla el primer día
                  tiene la app vacía, y exportar una app vacía no sirve de nada.
                  Esto es lo que necesita antes que cualquier otra cosa. */}
              <div className="setting-row">
                <div className="setting-info">
                  <label>{cuantosEjemplos > 0 ? 'Datos de ejemplo cargados' : 'Ver ZenDay con datos'}</label>
                  <span className="setting-hint">
                    {cuantosEjemplos > 0
                      ? `Hay ${cuantosEjemplos} registros de ejemplo. Se borran sin tocar los tuyos.`
                      : 'Carga clientes, pedidos, artículos y gastos de mentira para ver el programa lleno.'}
                  </span>
                </div>
                {cuantosEjemplos > 0 ? (
                  <button onClick={borrarEjemplos}>🧹 Borrar los ejemplos</button>
                ) : (
                  <button onClick={() => cargarDatosDeEjemplo?.()}>✨ Cargar datos de ejemplo</button>
                )}
              </div>

              <div className="divider" />

              <div className="data-grid">
                {[
                  { icon:'👥', label:'Clientes',  pdfFn: exportPatientsToPDF,     pdfArgs:[patients, appointments], xlFn: exportPatientsToExcel,     xlArgs:[patients, appointments], pdfKey:'PDF_PATIENTS',  xlKey:'EXCEL_PATIENTS' },
                  { icon:'📦', label:'Artículos', pdfFn: exportProductsToPDF,     pdfArgs:[products],              xlFn: exportProductsToExcel,     xlArgs:[products],              pdfKey:'PDF_PRODUCTS',  xlKey:'EXCEL_PRODUCTS' },
                  { icon:'📅', label:'Pedidos',   pdfFn: exportAppointmentsToPDF, pdfArgs:[appointments],          xlFn: exportAppointmentsToExcel, xlArgs:[appointments],          pdfKey:'PDF_APPTS',     xlKey:'EXCEL_APPTS' },
                ].map(({ icon, label, pdfFn, pdfArgs, xlFn, xlArgs, pdfKey, xlKey }) => (
                  <div key={label} className="data-card">
                    <span className="data-icon">{icon}</span>
                    <h3>{label}</h3>
                    <div className="data-actions">
                      <button disabled={isExporting[pdfKey]} onClick={() => handleExport(pdfKey, pdfFn, ...pdfArgs)}>
                        {isExporting[pdfKey] ? '…' : 'PDF'}
                      </button>
                      <button disabled={isExporting[xlKey]}  onClick={() => handleExport(xlKey,  xlFn,  ...xlArgs)}>
                        {isExporting[xlKey]  ? '…' : 'Excel'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Plantillas para importar</label>
                  <span className="setting-hint">Descargá el formato correcto de Excel</span>
                </div>
                <div className="template-buttons">
                  <button onClick={downloadPatientTemplate}>Clientes</button>
                  <button onClick={downloadProductTemplate}>Artículos</button>
                </div>
              </div>

              <div className="divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>¿Algo no funciona?</label>
                  <span className="setting-hint">
                    Copia al portapapeles qué falló, cuándo y con qué versión.
                    {ultimosErrores().length > 0
                      ? ` Hay ${ultimosErrores().length} error(es) registrado(s) en esta sesión.`
                      : ' No se registró ningún error en esta sesión.'}
                  </span>
                </div>
                <button onClick={reportarProblema}>🐞 Reportar problema</button>
              </div>

              <div className="divider" />

              <button className="audit-link" onClick={() => nav.navigate('audit')}>
                <span>📋 Ver registro de auditoría</span>
                <span>→</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal de licencia */}
      {showLicenseModal && (
        <div className="modal-overlay" onClick={() => setShowLicenseModal(false)}>
          <div className="modal-content" style={{ maxWidth:450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{licenseStatus?.status === 'active' ? 'Cambiar licencia' : 'Activar licencia'}</h3>
              <button className="modal-close" onClick={() => setShowLicenseModal(false)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding:20 }}>
              <p style={{ marginBottom:16, color:'var(--text-secondary)', fontSize:14 }}>
                {licenseStatus?.status === 'active'
                  ? 'Ingresá la nueva clave. La licencia actual será reemplazada.'
                  : 'Ingresá tu clave de licencia para activar ZenDay.'}
              </p>

              <div className="form-group">
                <label style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:6 }}>
                  Clave de licencia
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="ZENDAY-XXXX-XXXX-XXXX-XXXX"
                  value={newLicenseKey}
                  onChange={e => setNewLicenseKey(e.target.value.toUpperCase())}
                  maxLength={29}
                  style={{
                    width:'100%', padding:'10px 14px', borderRadius:10,
                    border:'1.5px solid var(--border)', background:'var(--bg-tertiary)',
                    color:'var(--text-primary)', fontFamily:'monospace', fontSize:14,
                    letterSpacing:'1px', boxSizing:'border-box',
                  }}
                />
                <small style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:4, display:'block' }}>
                  Formato: ZENDAY-XXXX-XXXX-XXXX-XXXX
                </small>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowLicenseModal(false)}>Cancelar</button>
              <button
                className="btn-primary"
                onClick={handleActivateNewLicense}
                disabled={isActivating || !newLicenseKey.trim()}
                style={{ opacity: (isActivating || !newLicenseKey.trim()) ? .6 : 1 }}
              >
                {isActivating ? 'Activando…' : (licenseStatus?.status === 'active' ? 'Cambiar' : 'Activar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}