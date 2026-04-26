import React, { useState, useRef, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { USER_MODES } from '../../utils/constants'
import {
  exportPatientsToPDF, exportProductsToPDF, exportAppointmentsToPDF,
  exportPatientsToExcel, exportProductsToExcel, exportAppointmentsToExcel,
  downloadPatientTemplate, downloadProductTemplate
} from '../../utils/exportImport'

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

const THEME_COLORS = [
  { id: 'violet',  name: 'Violeta',    color: '#6366f1' },
  { id: 'rose',    name: 'Rosa',       color: '#f43f5e' },
  { id: 'cyan',    name: 'Cyan',       color: '#06b6d4' },
  { id: 'amber',   name: 'Ámbar',      color: '#f59e0b' },
  { id: 'emerald', name: 'Esmeralda',  color: '#10b981' },
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
  } catch {}
  if (['LICENSE_ACTIVATE','LICENSE_DEACTIVATE','CONFIG_CHANGE','USER_ID_COPIED'].includes(action)) {
    window.electronAPI?.sendAuditLog?.(entry)?.catch?.(console.error)
  }
}

const safeCopyToClipboard = async (text) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    Object.assign(ta.style, { position:'fixed', left:'-999999px', top:'-999999px' })
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// ─── DEBOUNCE HOOK ────────────────────────────────────────────────────────────

function useDebounced(fn, delay) {
  const timer    = useRef(null)
  const fnRef    = useRef(fn)
  fnRef.current  = fn            // siempre apunta a la versión más reciente

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
}) {
  const focusRef = useScreenFocus()
  const toast    = useToast()
  const confirm  = useConfirm()

  const [localWorkingHours, setLocalWorkingHours] = useState(workingHours)
  const [localConfig,       setLocalConfig]       = useState(consultationConfig)
  const [userName,          setUserName]           = useState(() => localStorage.getItem('zenday-user-name') || 'Usuario')
  const [activeSection,     setActiveSection]      = useState('general')
  const [showLicenseModal,  setShowLicenseModal]   = useState(false)
  const [newLicenseKey,     setNewLicenseKey]      = useState('')
  const [isActivating,      setIsActivating]       = useState(false)
  // ← useState en vez de useRef para poder deshabilitar el botón visualmente
  const [isDeactivating,    setIsDeactivating]     = useState(false)
  const [isExporting,       setIsExporting]        = useState({})

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

  // Debounce apunta siempre a la versión más reciente de saveWorkingHours via ref
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

    setIsDeactivating(true)  // ← estado, no ref → re-renderiza el botón
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
  const handleCopyDeviceId = useCallback(async () => {
    const id = await window.electronAPI?.getDeviceId?.()
    if (!id) { toast.addToast('❌ No se pudo obtener el ID del dispositivo', 'error'); return }
    const ok = await safeCopyToClipboard(id)
    toast.addToast(ok ? '✅ ID copiado' : '❌ Error al copiar el ID', ok ? 'success' : 'error')
  }, [toast])

  const handleCopyUserId = useCallback(async () => {
    if (!user?.uid) return
    const ok = await confirm('⚠️ El ID de usuario es información sensible.\n\nSolo compartilo con soporte técnico autorizado.\n\n¿Deseás continuar?', 'Copiar ID de usuario')
    if (!ok) return
    const copied = await safeCopyToClipboard(user.uid)
    if (copied) { auditLog('USER_ID_COPIED', { prefix: user.uid.slice(0,8)+'...' }, user.uid) }
    toast.addToast(copied ? '✅ ID copiado' : '❌ Error al copiar el ID', copied ? 'success' : 'error')
  }, [user, confirm, toast])

  // ── Exportar ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(async (type, exportFn, ...args) => {
    // Lee isExporting via setter funcional — sin tenerlo en dependencias
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
  }, [toast])  // ← sin isExporting en dependencias

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
                        debouncedSave()   // debouncedSave siempre lee el estado más reciente
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
                <p>Configuración de consultas y precios</p>
              </div>

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

              <div className="setting-row">
                <div className="setting-info">
                  <label>Estado</label>
                  <span className="setting-hint">Situación actual de tu licencia</span>
                </div>
                <div className="license-status">
                  {licenseStatus?.status === 'active'  && <span style={{ color:'#10b981', fontWeight:700 }}>✅ Activa — Plan {licenseStatus.plan === 'professional' ? 'Profesional' : 'Emprendedor'}</span>}
                  {licenseStatus?.status === 'trial'   && <span style={{ color:'#f59e0b', fontWeight:700 }}>⏳ Trial — {licenseStatus.daysLeft} días restantes</span>}
                  {licenseStatus?.status === 'expired' && <span style={{ color:'#ef4444', fontWeight:700 }}>❌ Expirada</span>}
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
                      style={{ color:'#ef4444', borderColor:'#ef4444', opacity: isDeactivating ? .6 : 1 }}
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
                  <span className="setting-hint">Usá este ID para obtener una licencia</span>
                </div>
                <button className="btn-secondary" onClick={handleCopyDeviceId}>📋 Copiar ID</button>
              </div>
            </div>
          )}

          {/* ── DATOS ─────────────────────────────────────────────────────── */}
          {activeSection === 'data' && (
            <div className="settings-panel">
              <div className="panel-header">
                <h2>Datos</h2>
                <p>Exportá, importá y gestioná tu información</p>
              </div>

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