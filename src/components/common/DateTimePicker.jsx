// src/components/common/DateTimePicker.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useToast } from '../../contexts/ToastContext' // Ahora siempre retorna un objeto con addToast

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toLocalDateString(date) {
  if (!date || isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toLocalTimeString(date, includeSeconds = false) {
  if (!date || isNaN(date.getTime())) return includeSeconds ? '00:00:00' : '00:00'
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  if (!includeSeconds) return `${hours}:${minutes}`
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function parseDateLocal(dateStr) {
  if (!dateStr || !dateStr.includes('-')) return null
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  const [year, month, day] = parts
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month: month - 1, day }
}

function isValidDate(year, month, day) {
  const testDate = new Date(year, month, day)
  return testDate.getFullYear() === year &&
         testDate.getMonth() === month &&
         testDate.getDate() === day
}

const QUICK_OPTIONS = [
  { label: 'Mañana',        getDate: () => new Date(Date.now() + 86_400_000) },
  { label: '+3 días',       getDate: () => new Date(Date.now() + 3 * 86_400_000) },
  { label: 'Próxima semana',getDate: () => new Date(Date.now() + 7 * 86_400_000) },
]

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export default function DateTimePicker({
  value,
  onChange,
  label,
  minDate = null,
  maxDate = null,
  preventPast = false,
  granularity = 'minute',
  onAvailabilityCheck = null,
  locale = null,
  onValidationError = null, // opcional, si se requiere callback adicional
}) {
  const toast = useToast() // ✅ siempre disponible, con fallback silencioso
  const [isOpen, setIsOpen] = useState(false)
  const [tempDate, setTempDate] = useState(() => {
    if (!value) return new Date()
    const d = typeof value === 'number' ? new Date(value) : new Date(value)
    return isNaN(d) ? new Date() : d
  })
  const [validationError, setValidationError] = useState(null)

  const pickerRef = useRef(null)
  const firstInputRef = useRef(null)
  const prevValueRef = useRef(value)

  const effectiveLocale = locale || navigator.language || 'es-UY'

  // Sincronización externa
  useEffect(() => {
    if (!isOpen) {
      const isEqual = (a, b) => {
        if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
        if (typeof a === 'number' && typeof b === 'number') return a === b
        return a === b
      }
      if (!isEqual(prevValueRef.current, value)) {
        const d = typeof value === 'number' ? new Date(value) : (value instanceof Date ? value : new Date(value))
        if (!isNaN(d)) setTempDate(d)
        prevValueRef.current = value
      }
    }
  }, [value, isOpen])

  // Click outside + foco
  useEffect(() => {
    if (!isOpen) return
    if (firstInputRef.current) firstInputRef.current.focus()

    const handleClickOutside = (e) => {
      setTimeout(() => {
        if (pickerRef.current && !pickerRef.current.contains(e.target)) {
          setIsOpen(false)
        }
      }, 0)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const validateDate = useCallback((date) => {
    setValidationError(null)

    if (preventPast) {
      const now = new Date()
      now.setSeconds(0, 0)
      if (date < now) {
        const msg = 'No se pueden seleccionar fechas u horas pasadas'
        toast.addToast(msg, 'warning')
        setValidationError(msg)
        onValidationError?.(msg)
        return false
      }
    }

    if (minDate) {
      const min = new Date(minDate)
      min.setSeconds(0, 0)
      if (date < min) {
        const msg = `La fecha no puede ser anterior a ${min.toLocaleDateString(effectiveLocale)}`
        toast.addToast(msg, 'warning')
        setValidationError(msg)
        onValidationError?.(msg)
        return false
      }
    }

    if (maxDate) {
      const max = new Date(maxDate)
      max.setSeconds(0, 0)
      if (date > max) {
        const msg = `La fecha no puede ser posterior a ${max.toLocaleDateString(effectiveLocale)}`
        toast.addToast(msg, 'warning')
        setValidationError(msg)
        onValidationError?.(msg)
        return false
      }
    }

    if (onAvailabilityCheck && !onAvailabilityCheck(date)) {
      const msg = 'Este horario no está disponible'
      toast.addToast(msg, 'warning')
      setValidationError(msg)
      onValidationError?.(msg)
      return false
    }

    return true
  }, [minDate, maxDate, preventPast, onAvailabilityCheck, effectiveLocale, toast, onValidationError])

  const handleOpen = useCallback(() => {
    if (value) {
      const d = typeof value === 'number' ? new Date(value) : new Date(value)
      if (!isNaN(d)) setTempDate(d)
    }
    setIsOpen(true)
    setValidationError(null)
  }, [value])

  // Display memoizado
  const displayDate = useMemo(() => {
    if (!value) return 'Seleccionar fecha'
    const d = typeof value === 'number' ? new Date(value) : new Date(value)
    if (isNaN(d)) return 'Fecha inválida'
    return d.toLocaleDateString(effectiveLocale, { day: 'numeric', month: 'long', year: 'numeric' })
  }, [value, effectiveLocale])

  const displayTime = useMemo(() => {
    if (!value || granularity === 'day') return ''
    const d = typeof value === 'number' ? new Date(value) : new Date(value)
    if (isNaN(d)) return '—'
    const includeSeconds = granularity === 'second'
    return toLocalTimeString(d, includeSeconds)
  }, [value, granularity]) // ✅ effectiveLocale removido

  const handleDateChange = useCallback((e) => {
    const parsed = parseDateLocal(e.target.value)
    if (!parsed) return
    const { year, month, day } = parsed
    if (!isValidDate(year, month, day)) return
    setTempDate(prev => {
      const next = new Date(prev)
      next.setFullYear(year, month, day)
      return next
    })
  }, [])

  const handleTimeChange = useCallback((e) => {
    let [hours, minutes, seconds] = e.target.value.split(':').map(Number)
    if (isNaN(seconds)) seconds = 0
    setTempDate(prev => {
      const next = new Date(prev)
      next.setHours(hours, minutes, seconds, 0)
      return next
    })
  }, [])

  const handleConfirm = useCallback(() => {
    if (!validateDate(tempDate)) return
    onChange(tempDate.getTime())
    setIsOpen(false)
  }, [tempDate, onChange, validateDate])

  const handleClear = useCallback(() => {
    onChange(null)
    setTempDate(new Date())
    setIsOpen(false)
  }, [onChange])

  const handleToday = useCallback(() => {
    const now = new Date()
    if (validateDate(now)) {
      setTempDate(now)
      onChange(now.getTime())
      setIsOpen(false)
    }
  }, [validateDate, onChange])

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="datetime-picker" ref={pickerRef}>
      {label && <label className="datetime-label">{label}</label>}

      <div
        className="datetime-field"
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleOpen()}
        aria-label={`Fecha: ${displayDate}${displayTime ? `, Hora: ${displayTime}` : ''}`}
        aria-expanded={isOpen}
      >
        <div className="datetime-field-left">
          <span className="datetime-icon">📅</span>
          <span className={`datetime-value${!value ? ' placeholder' : ''}`}>
            {displayDate}
          </span>
        </div>
        {granularity !== 'day' && (
          <div className="datetime-field-right">
            <span className="datetime-time-value">{displayTime}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="datetime-popup" role="dialog" aria-modal="true">
          <div className="datetime-popup-header">
            <span>Seleccionar fecha y hora</span>
            <button className="datetime-popup-close" onClick={() => setIsOpen(false)} aria-label="Cerrar">✕</button>
          </div>

          <div className="datetime-quick-selections" style={{ padding: '8px 16px', display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)' }}>
            {QUICK_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => { const newDate = opt.getDate(); if (validateDate(newDate)) setTempDate(newDate) }}
                className="datetime-quick-btn"
                style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="datetime-popup-body">
            <div className="datetime-date-section">
              <label>Fecha</label>
              <input
                ref={firstInputRef}
                type="date"
                value={toLocalDateString(tempDate)}
                onChange={handleDateChange}
                className="datetime-input-native"
                min={minDate ? toLocalDateString(new Date(minDate)) : undefined}
                max={maxDate ? toLocalDateString(new Date(maxDate)) : undefined}
              />
            </div>

            {granularity !== 'day' && (
              <div className="datetime-time-section">
                <label>Hora</label>
                <input
                  type="time"
                  value={toLocalTimeString(tempDate, granularity === 'second')}
                  onChange={handleTimeChange}
                  className="datetime-input-native"
                  step={granularity === 'second' ? '1' : granularity === 'hour' ? '3600' : '300'}
                />
              </div>
            )}
          </div>

          {validationError && (
            <div role="alert" aria-live="polite" style={{ color: 'var(--accent-red, #e53e3e)', fontSize: '12px', padding: '0 16px 8px 16px' }}>
              ⚠️ {validationError}
            </div>
          )}

          <div className="datetime-popup-footer">
            <button className="datetime-btn-clear" onClick={handleClear}>Limpiar</button>
            <button className="datetime-btn-today" onClick={handleToday}>Hoy</button>
            <button className="datetime-btn-confirm" onClick={handleConfirm}>✓ Aceptar</button>
          </div>
        </div>
      )}
    </div>
  )
}