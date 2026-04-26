// src/components/screens/BusinessSettingsScreen.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const STORAGE_KEY      = 'business_settings'
const HISTORY_KEY      = 'config_history'
const MAX_HISTORY      = 20

const DEFAULT_CONFIG = {
  defaultDuration:        60,
  defaultPrice:           0,
  pricePerHour:           false,
  hourlyRate:             0,
  allowOverbooking:       false,
  maxAdvanceBookingDays:  90,
  minAdvanceBookingHours: 1,
  cancellationHours:      24,
  cancellationPenalty:    0,
}

const TEMPLATES = {
  consulting: { name:'💼 Consultoría', defaultDuration:60,  defaultPrice:2500, pricePerHour:true,  hourlyRate:2500, allowOverbooking:false, maxAdvanceBookingDays:90, minAdvanceBookingHours:2, cancellationHours:24, cancellationPenalty:50 },
  retail:     { name:'🛍️ Comercio',   defaultDuration:15,  defaultPrice:500,  pricePerHour:false, hourlyRate:0,    allowOverbooking:true,  maxAdvanceBookingDays:30, minAdvanceBookingHours:0, cancellationHours:1,  cancellationPenalty:0  },
  health:     { name:'🏥 Salud',       defaultDuration:45,  defaultPrice:1800, pricePerHour:true,  hourlyRate:2400, allowOverbooking:false, maxAdvanceBookingDays:60, minAdvanceBookingHours:4, cancellationHours:24, cancellationPenalty:100},
  beauty:     { name:'💅 Estética',    defaultDuration:60,  defaultPrice:1500, pricePerHour:true,  hourlyRate:1500, allowOverbooking:false, maxAdvanceBookingDays:45, minAdvanceBookingHours:1, cancellationHours:12, cancellationPenalty:30 },
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 150)
}

function validateConfig(cfg) {
  const errors = []
  if (cfg.defaultDuration < 15 || cfg.defaultDuration > 480)
    errors.push('La duración debe estar entre 15 y 480 minutos')
  if (cfg.defaultPrice < 0)
    errors.push('El precio no puede ser negativo')
  if (cfg.defaultPrice > 1_000_000)
    errors.push('El precio parece demasiado alto (máx $1,000,000)')
  if (cfg.pricePerHour && cfg.hourlyRate <= 0)
    errors.push('La tarifa por hora debe ser mayor a 0 cuando está activada')
  if (cfg.pricePerHour && cfg.hourlyRate > 50_000)
    errors.push('La tarifa por hora parece demasiado alta (máx $50,000)')
  if (cfg.maxAdvanceBookingDays < 1 || cfg.maxAdvanceBookingDays > 365)
    errors.push('Los días de anticipación deben estar entre 1 y 365')
  if (cfg.minAdvanceBookingHours < 0 || cfg.minAdvanceBookingHours > 72)
    errors.push('Las horas mínimas deben estar entre 0 y 72')
  if (cfg.cancellationHours < 0 || cfg.cancellationHours > 168)
    errors.push('Las horas de cancelación deben estar entre 0 y 168')
  if (cfg.cancellationPenalty < 0 || cfg.cancellationPenalty > 100)
    errors.push('La penalización debe estar entre 0% y 100%')
  return errors
}

function validateField(field, value, cfg) {
  if (field === 'defaultDuration') {
    return (value < 15 || value > 480) ? 'Debe estar entre 15 y 480 minutos' : null
  }
  if (field === 'defaultPrice') {
    if (value < 0)         return 'No puede ser negativo'
    if (value > 1_000_000) return 'Máximo $1,000,000 UYU'
    return null
  }
  if (field === 'hourlyRate') {
    if (cfg.pricePerHour && value <= 0)     return 'Debe ser mayor a 0'
    if (cfg.pricePerHour && value > 50_000) return 'Máximo $50,000 UYU'
    return null
  }
  return null
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function BusinessSettingsScreen({ nav, consultationConfig, setConsultationConfig, userMode = 'professional' }) {
  const toast   = useToast()
  const confirm = useConfirm()

  const [config,         setConfig]        = useState(DEFAULT_CONFIG)
  const [originalConfig, setOriginalConfig]= useState(null)
  const [previewDuration,setPreviewDuration]= useState(60)
  const [showHistory,    setShowHistory]   = useState(false)
  const [showTemplates,  setShowTemplates] = useState(false)
  const [configHistory,  setConfigHistory] = useState([])
  const [isLoading,      setIsLoading]     = useState(false)
  const [affectedCount,  setAffectedCount] = useState(0)

  // ── Errores de validación ──────────────────────────────────────────────────
  const validationErrors = useMemo(() => {
    const errs = {}
    const fields = ['defaultDuration', 'defaultPrice', 'hourlyRate']
    fields.forEach(f => {
      const err = validateField(f, config[f], config)
      if (err) errs[f] = err
    })
    return errs
  }, [config])

  // ── hasUnsavedChanges: valor derivado ───────────────────────────────────────
  const hasUnsavedChanges = useMemo(() => {
    if (!originalConfig) return false
    return Object.keys(DEFAULT_CONFIG).some(k => config[k] !== originalConfig[k])
  }, [config, originalConfig])

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Config
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setConfig(prev => ({ ...prev, ...parsed }))
        setOriginalConfig(parsed)
        setConsultationConfig?.(parsed)
      } else if (consultationConfig) {
        setConfig(prev => ({ ...prev, ...consultationConfig }))
        setOriginalConfig(consultationConfig)
      } else {
        setOriginalConfig(DEFAULT_CONFIG)
      }
    } catch { toast.addToast('❌ Error al cargar configuración', 'error') }

    // Historial
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setConfigHistory(JSON.parse(saved))
    } catch {}

    // CORREGIDO Detalle 1: Usar la key correcta según el modo
    try {
      const mode = userMode || localStorage.getItem('zenday-user-mode') || 'professional'
      const key = `zenday-${mode}-appointments`
      const appts = JSON.parse(localStorage.getItem(key) || '[]')
      setAffectedCount(appts.filter(a =>
        new Date(a.startTime) > new Date() &&
        a.status !== 'cancelled' && a.status !== 'completed'
      ).length)
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refs para atajos de teclado ────────────────────────────────────────────
  const hasChangesRef = useRef(hasUnsavedChanges)
  const isLoadingRef  = useRef(isLoading)
  const configRef     = useRef(config)
  useEffect(() => { hasChangesRef.current  = hasUnsavedChanges }, [hasUnsavedChanges])
  useEffect(() => { isLoadingRef.current   = isLoading         }, [isLoading])
  useEffect(() => { configRef.current      = config             }, [config])

  // ── Atajos de teclado ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasChangesRef.current && !isLoadingRef.current) {
          handleSaveRef.current?.()
        }
      }
      if (e.key === 'Escape') {
        handleBackRef.current?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Refs para exponer handlers a atajos ─────────────────────────────────────
  const handleSaveRef = useRef(null)
  const handleBackRef = useRef(null)

  // ── Historial ──────────────────────────────────────────────────────────────
  const saveToHistory = useCallback((oldCfg, newCfg) => {
    const changes = {}
    Object.keys(newCfg).forEach(k => {
      if (oldCfg[k] !== newCfg[k]) changes[k] = { from: oldCfg[k], to: newCfg[k] }
    })
    if (Object.keys(changes).length === 0) return

    const entry = {
      id:        Date.now(),
      timestamp: new Date().toISOString(),
      summary:   `${Object.keys(changes).length} cambios`,
      changes,
      config:    { ...newCfg },
    }

    setConfigHistory(prev => {
      const next = [entry, ...prev].slice(0, MAX_HISTORY)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // ── Handlers de cambio ─────────────────────────────────────────────────────
  const handleDurationChange = useCallback((value) => {
    let n = parseInt(value, 10)
    if (isNaN(n)) return
    n = Math.round(Math.min(480, Math.max(15, n)) / 15) * 15
    setConfig(prev => ({ ...prev, defaultDuration: n }))
  }, [])

  const handlePriceChange = useCallback((value, isHourly = false) => {
    let n = parseInt(value, 10)
    if (isNaN(n) || n < 0) n = 0
    const max = isHourly ? 50_000 : 1_000_000
    if (n > max) {
      toast.addToast(`⚠️ Precio máximo: $${max.toLocaleString()} UYU`, 'warning')
      n = max
    }
    setConfig(prev => isHourly
      ? { ...prev, hourlyRate:    n }
      : { ...prev, defaultPrice:  n }
    )
  }, [toast])

  // ── Precio calculado ───────────────────────────────────────────────────────
  const calculatedPrice = useMemo(() => {
    if (config.pricePerHour && config.hourlyRate > 0) {
      return Math.round(config.hourlyRate * previewDuration / 60)
    }
    return config.defaultPrice
  }, [config.pricePerHour, config.hourlyRate, config.defaultPrice, previewDuration])

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const errors = validateConfig(config)
    if (errors.length > 0) {
      errors.forEach(e => toast.addToast(`❌ ${e}`, 'error'))
      return
    }
    if (!hasUnsavedChanges) {
      toast.addToast('ℹ️ No hay cambios para guardar', 'info')
      return
    }

    setIsLoading(true)
    try {
      const toSave = {
        ...config,
        updatedAt: new Date().toISOString(),
        version:   (originalConfig?.version ?? 0) + 1,
      }

      saveToHistory(originalConfig, toSave)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      setConsultationConfig?.(toSave)
      setOriginalConfig(toSave)

      toast.addToast('✅ Configuración guardada', 'success')

      if (affectedCount > 0) {
        const apply = await confirm(
          `¿Aplicar cambios a ${affectedCount} citas existentes?`,
          'Los cambios en precios y duración pueden afectar citas ya agendadas.'
        )
        if (apply) {
          window.dispatchEvent(new CustomEvent('config-updated', { detail: toSave }))
          toast.addToast('🔄 Actualizando citas existentes...', 'info')
        }
      }

      setTimeout(() => nav.goBack(), 500)
    } catch (err) {
      console.error('[BusinessSettings] save:', err)
      toast.addToast('❌ Error al guardar configuración', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [config, originalConfig, hasUnsavedChanges, affectedCount, saveToHistory, setConsultationConfig, toast, confirm, nav])

  // ── Volver ─────────────────────────────────────────────────────────────────
  const handleBack = useCallback(async () => {
    if (hasUnsavedChanges) {
      const ok = await confirm('¿Salir sin guardar?', 'Tienes cambios sin guardar que se perderán.')
      if (ok) nav.goBack()
    } else {
      nav.goBack()
    }
  }, [hasUnsavedChanges, confirm, nav])

  // Actualizar refs después de cada render
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])
  useEffect(() => { handleBackRef.current = handleBack }, [handleBack])

  // ── Otros handlers ─────────────────────────────────────────────────────────
  const applyTemplate = useCallback(async (key) => {
    const tmpl = TEMPLATES[key]
    const ok = await confirm(`¿Aplicar template "${tmpl.name}"?`, 'Esto reemplazará tu configuración actual.')
    if (!ok) return
    saveToHistory(config, tmpl)
    setConfig(prev => ({ ...prev, ...tmpl }))
    setShowTemplates(false)
    toast.addToast(`✅ Template "${tmpl.name}" aplicado`, 'success')
  }, [config, saveToHistory, confirm, toast])

  const revertToVersion = useCallback(async (entry) => {
    const ok = await confirm(
      '¿Revertir a versión anterior?',
      `Restaurará la configuración del ${new Date(entry.timestamp).toLocaleString()}`
    )
    if (ok && entry.config) {
      saveToHistory(config, entry.config)
      setConfig(prev => ({ ...prev, ...entry.config }))
      toast.addToast('⏪ Configuración restaurada', 'success')
    }
  }, [config, saveToHistory, confirm, toast])

  const resetToDefaults = useCallback(async () => {
    const ok = await confirm('¿Restablecer valores por defecto?', 'Se perderán todos los cambios.')
    if (!ok) return
    saveToHistory(config, DEFAULT_CONFIG)
    setConfig(DEFAULT_CONFIG)
    toast.addToast('✅ Configuración restablecida', 'success')
  }, [config, saveToHistory, confirm, toast])

  const handleExportConfig = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ ...config, exportedAt: new Date().toISOString(), app: 'ZenDay' }, null, 2)],
      { type: 'application/json' }
    )
    downloadBlob(blob, `zenday-config-${new Date().toISOString().split('T')[0]}.json`)
    toast.addToast('📁 Configuración exportada', 'success')
  }, [config, toast])

  // CORREGIDO Detalle 2: handleImportConfig con limpieza de input
  const handleImportConfig = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    const cleanup = () => {
      if (input.parentNode) input.remove()
    }
    
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) {
        cleanup()
        return
      }
      try {
        const imported = JSON.parse(await file.text())
        if (!('defaultDuration' in imported) || !('defaultPrice' in imported)) {
          toast.addToast('❌ Archivo de configuración inválido', 'error')
          cleanup()
          return
        }
        const ok = await confirm('¿Importar configuración?', 'Esto reemplazará tu configuración actual.')
        if (!ok) {
          cleanup()
          return
        }
        saveToHistory(config, imported)
        setConfig(prev => ({ ...prev, ...imported }))
        toast.addToast('✅ Configuración importada', 'success')
      } catch {
        toast.addToast('❌ Error al importar', 'error')
      } finally {
        cleanup()
      }
    }
    
    input.addEventListener('cancel', cleanup)
    input.click()
  }, [config, saveToHistory, confirm, toast])

  // ── Icono de validación ────────────────────────────────────────────────────
  const validationIcon = useCallback((field) => {
    if (validationErrors[field]) return '⚠️'
    return '✅'
  }, [validationErrors])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const canSave = hasUnsavedChanges && !isLoading && Object.keys(validationErrors).length === 0

  return (
    <div className="business-settings-screen">
      <div className="top-bar">
        <BackButton onClick={handleBack} />
        <h2 className="top-bar-title">Configuración de negocio</h2>
        <div className="top-bar-actions">
          <button className="history-btn" onClick={() => setShowTemplates(v => !v)} title="Templates">📋</button>
          <button className="history-btn" onClick={handleExportConfig}              title="Exportar">📤</button>
          <button className="reset-btn"   onClick={handleImportConfig}              title="Importar">📥</button>
          <button className="history-btn" onClick={() => setShowHistory(v => !v)}   title="Historial">📜</button>
          <button className="reset-btn"   onClick={resetToDefaults}                 title="Restablecer">🔄</button>
        </div>
      </div>

      <div className="settings-container">

        {/* Advertencia */}
        {hasUnsavedChanges && (
          <div className="unsaved-warning">
            ⚠️ Hay cambios sin guardar
            {affectedCount > 0 && (
              <span className="affected-count"> • {affectedCount} citas futuras podrían verse afectadas</span>
            )}
          </div>
        )}

        {/* Templates */}
        {showTemplates && (
          <div className="templates-panel">
            <h4>📋 Templates rápidos</h4>
            <p>Configuración predefinida según tipo de negocio</p>
            <div className="template-grid">
              {Object.entries(TEMPLATES).map(([key, tmpl]) => (
                <div key={key} className="template-card" onClick={() => applyTemplate(key)}>
                  <div className="template-name">{tmpl.name}</div>
                  <div className="template-details">
                    <span>⏱️ {tmpl.defaultDuration} min</span>
                    <span>💰 ${tmpl.defaultPrice.toLocaleString()}</span>
                    {tmpl.pricePerHour && <span>⚡ Por hora</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historial */}
        {showHistory && (
          <div className="history-panel">
            <h4>📜 Historial de cambios</h4>
            {configHistory.length === 0 ? (
              <p className="empty-history">Sin cambios registrados</p>
            ) : (
              <div className="history-list">
                {configHistory.map(entry => (
                  <div key={entry.id} className="history-item">
                    <div className="history-date">{new Date(entry.timestamp).toLocaleString()}</div>
                    <div className="history-summary">{entry.summary}</div>
                    <button className="revert-btn" onClick={() => revertToVersion(entry)}>
                      ↩️ Revertir
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Precios y duración */}
        <div className="settings-card">
          <h3>💰 Precios y duración</h3>

          <div className="setting-group">
            <label>
              Duración por defecto (minutos)
              <span className="validation-icon">{validationIcon('defaultDuration')}</span>
            </label>
            <input
              type="number" min="15" max="480" step="15"
              value={config.defaultDuration}
              onChange={e => handleDurationChange(e.target.value)}
              className={validationErrors.defaultDuration ? 'error' : ''}
            />
            {validationErrors.defaultDuration && <small className="error-text">{validationErrors.defaultDuration}</small>}
            <small>Múltiplos de 15 min (ej: 60, 75, 90…)</small>
          </div>

          <div className="setting-group">
            <label>
              Precio por defecto (UYU)
              <span className="validation-icon">{validationIcon('defaultPrice')}</span>
            </label>
            <input
              type="number" min="0" step="100"
              value={config.defaultPrice}
              onChange={e => handlePriceChange(e.target.value, false)}
              className={validationErrors.defaultPrice ? 'error' : ''}
            />
            {validationErrors.defaultPrice && <small className="error-text">{validationErrors.defaultPrice}</small>}
            <small>Precio sugerido para nuevos pedidos</small>
          </div>

          <div className="setting-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.pricePerHour}
                onChange={e => setConfig(prev => ({ ...prev, pricePerHour: e.target.checked }))}
              />
              Calcular precio por hora
            </label>
            <small>El precio se multiplica según la duración de la cita</small>
          </div>

          {config.pricePerHour && (
            <div className="setting-group">
              <label>
                Tarifa por hora (UYU)
                <span className="validation-icon">{validationIcon('hourlyRate')}</span>
              </label>
              <input
                type="number" min="0" step="100"
                value={config.hourlyRate}
                onChange={e => handlePriceChange(e.target.value, true)}
                className={validationErrors.hourlyRate ? 'error' : ''}
              />
              {validationErrors.hourlyRate && <small className="error-text">{validationErrors.hourlyRate}</small>}
              <small>Ej: $1000/hora → 2 horas = $2000</small>
            </div>
          )}

          {/* Preview */}
          <div className="preview-card">
            <h4>🔍 Vista previa</h4>
            <div className="preview-control">
              <label>Duración de ejemplo:</label>
              <div className="preview-slider">
                <input
                  type="range" min="15" max="240" step="15"
                  value={previewDuration}
                  onChange={e => setPreviewDuration(parseInt(e.target.value, 10))}
                />
                <span className="preview-duration">{previewDuration} min</span>
              </div>
            </div>
            <div className="preview-result">
              <strong>Precio calculado:</strong>
              <span className="preview-price">${calculatedPrice.toLocaleString()} UYU</span>
            </div>
            <small>Basado en la configuración actual</small>
          </div>
        </div>

        {/* Configuración avanzada */}
        <div className="settings-card">
          <h3>⚙️ Configuración avanzada</h3>

          <div className="setting-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.allowOverbooking}
                onChange={e => setConfig(prev => ({ ...prev, allowOverbooking: e.target.checked }))}
              />
              Permitir sobreagendamiento
            </label>
            <small>Permite múltiples citas en el mismo horario</small>
          </div>

          <div className="setting-group">
            <label>Días máximos de anticipación para agendar</label>
            <input
              type="number" min="1" max="365"
              value={config.maxAdvanceBookingDays}
              onChange={e => setConfig(prev => ({ ...prev, maxAdvanceBookingDays: parseInt(e.target.value, 10) || 90 }))}
            />
            <small>Cuántos días en el futuro se pueden agendar citas</small>
          </div>

          <div className="setting-group">
            <label>Horas mínimas de anticipación</label>
            <input
              type="number" min="0" max="72"
              value={config.minAdvanceBookingHours}
              onChange={e => setConfig(prev => ({ ...prev, minAdvanceBookingHours: parseInt(e.target.value, 10) || 0 }))}
            />
            <small>Tiempo mínimo entre reserva y cita (0 = inmediato)</small>
          </div>

          <div className="setting-group">
            <label>Política de cancelación</label>
            <div className="cancelation-row">
              <input
                type="number" min="0" max="168" style={{ width:100 }}
                value={config.cancellationHours}
                onChange={e => setConfig(prev => ({ ...prev, cancellationHours: parseInt(e.target.value, 10) || 24 }))}
              />
              <span>horas de anticipación</span>
            </div>
            <div className="cancelation-row">
              <input
                type="number" min="0" max="100" style={{ width:100 }}
                value={config.cancellationPenalty}
                onChange={e => setConfig(prev => ({ ...prev, cancellationPenalty: parseInt(e.target.value, 10) || 0 }))}
              />
              <span>% de penalización</span>
            </div>
            <small>
              {config.cancellationPenalty > 0
                ? `Cancelaciones con menos de ${config.cancellationHours}h tienen ${config.cancellationPenalty}% de penalización`
                : `Cancelaciones con menos de ${config.cancellationHours}h son gratuitas`}
            </small>
          </div>
        </div>

        <button className="save-btn" onClick={handleSave} disabled={!canSave}>
          {isLoading ? '⏳ Guardando…' : '💾 Guardar configuración'}
        </button>

        <div className="info-card">
          <h4>ℹ️ ¿Cómo funciona?</h4>
          <ul>
            <li><strong>Duración por defecto:</strong> Tiempo base para cada cita</li>
            <li><strong>Precio por defecto:</strong> Monto base de la cita</li>
            <li><strong>Precio por hora:</strong> Se calcula multiplicando la tarifa × duración</li>
            <li><strong>Política de cancelación:</strong> Define hasta cuándo se puede cancelar sin penalización</li>
          </ul>
          <div className="example">
            <strong>Ejemplo:</strong>
            <p>• Duración: 90 min (1.5 h) · Tarifa: $1.000/h → Precio: $1.500</p>
          </div>
        </div>

        <div className="keyboard-shortcut">
          <kbd>Ctrl</kbd> + <kbd>S</kbd> para guardar · <kbd>Esc</kbd> para salir
        </div>
      </div>
    </div>
  )
}

export default BusinessSettingsScreen