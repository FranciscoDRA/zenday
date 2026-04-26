// src/components/common/GlobalSearch.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { formatDateTime, formatCurrency } from '../../utils/helpers'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const STATUS_LABELS_ES = {
  pending: 'pendiente', 
  delivered: 'entregado', 
  cancelled: 'cancelado', 
  completed: 'completado',
  processing: 'procesando',
  shipped: 'enviado',
}

// ─── DEBOUNCE HOOK ────────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ─── HELPERS DE BÚSQUEDA ──────────────────────────────────────────────────────
const includesLower = (str, lower) => {
  if (str === null || str === undefined) return false
  const strStr = String(str)
  return strStr.toLowerCase().includes(lower)
}

// Versión optimizada para arrays grandes
const searchWithLimit = (array, predicate, limit) => {
  if (!array || array.length === 0) return []
  const result = []
  for (let i = 0; i < array.length && result.length < limit; i++) {
    if (predicate(array[i])) {
      result.push(array[i])
    }
  }
  return result
}

function searchPatients(patients, lower) {
  return searchWithLimit(patients || [], p =>
    includesLower(p.name, lower) ||
    includesLower(p.phone, lower) ||
    includesLower(p.email, lower), 3
  ).map(p => ({ type: 'patient', ...p }))
}

function searchProducts(products, lower) {
  return searchWithLimit(products || [], p =>
    includesLower(p.name, lower) ||
    includesLower(p.code, lower) ||
    includesLower(p.description, lower), 3
  ).map(p => ({ type: 'product', ...p }))
}

function searchAppointments(appointments, lower, includeCancelled = false) {
  return searchWithLimit(appointments || [], a => {
    if (!includeCancelled && a.status === 'cancelled') return false
    return (includesLower(a.patientName, lower) ||
            includesLower(a.productName, lower) ||
            includesLower(a.notes, lower))
  }, 5)
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .map((a, idx) => ({ 
      type: 'appointment', 
      _searchIdx: idx,  // ← para key fallback
      ...a 
    }))
}

// CORREGIDO: Búsqueda de pedidos con detección numérica y español
function searchOrders(orders, lower) {
  const isNumericSearch = /^\d+$/.test(lower)
  
  return searchWithLimit(orders || [], o => {
    const matchCustomer = includesLower(o.customerName, lower)
    const matchPhone = includesLower(o.customerPhone, lower)
    const matchStatus = includesLower(STATUS_LABELS_ES[o.status] || o.status, lower)
    
    // Buscar por orderNumber si es numérico
    const matchOrderNumber = isNumericSearch && o.orderNumber?.toString().includes(lower)
    
    // Buscar por id solo si no es búsqueda numérica (evita ruido)
    const matchId = !isNumericSearch && includesLower(o.id, lower)
    
    return matchCustomer || matchPhone || matchStatus || matchOrderNumber || matchId
  }, 5)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((o, idx) => ({ 
      type: 'order', 
      _searchIdx: idx,  // ← para key fallback
      ...o 
    }))
}

// CORREGIDO: Formato relativo con validación de fecha
function getRelativeDateTime(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '—'
  
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  
  const diffDays = Math.round((targetDate - today) / 86400000)
  
  if (diffDays === 0) return `Hoy ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`
  if (diffDays === 1) return `Mañana ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`
  if (diffDays === -1) return `Ayer ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`
  if (Math.abs(diffDays) <= 7) return date.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'})
  
  return date.toLocaleDateString()
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
export function GlobalSearch({ 
  appointments = [],
  patients = [],
  products = [],
  orders = [],
  onSelectResult = () => {}, // ← default para evitar crash
  includeCancelled = false,
  debounceDelay = 300,
  // CORREGIDO: mapa de rutas configurable
  screenMap = {
    order:       'orderDetail',
    patient:     'patientProfile',
    product:     'productDetail',
    appointment: 'appointmentDetail',
  }
}) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [isOpen,  setIsOpen]  = useState(false)
  const [focused, setFocused] = useState(-1)

  const inputRef    = useRef(null)
  const containerRef = useRef(null)

  const debouncedQuery = useDebounce(query, debounceDelay)

  // ── Atajo de teclado global Ctrl+K ───────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  // ── Búsqueda unificada con deduplicación mejorada ────────────────────────────
  useEffect(() => {
    const lower = debouncedQuery.trim().toLowerCase()
    if (!lower) { 
      setResults([])
      return 
    }

    const matched = [
      ...searchPatients(patients, lower),
      ...searchProducts(products, lower),
      ...searchAppointments(appointments, lower, includeCancelled),
      ...searchOrders(orders, lower),
    ]
    
    // CORREGIDO: deduplicación con fallback para ID undefined
    const seen = new Set()
    const unique = matched.filter(item => {
      const id = item.id ?? item.externalRef ?? item._searchIdx
      const key = `${item.type}-${id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    
    setResults(unique)
    setFocused(-1)
  }, [debouncedQuery, includeCancelled])

  // ── Seleccionar resultado (con validación de ruta) ───────────────────────────
  const handleSelect = useCallback((item) => {
    const targetScreen = screenMap[item.type]
    if (!targetScreen) {
      console.error(`No screen mapping found for type: ${item.type}`)
      return
    }
    
    onSelectResult({ 
      type: item.type, 
      id: item.id,
      data: item,
      screen: targetScreen
    })
    setQuery('')
    setResults([])
    setIsOpen(false)
    setFocused(-1)
    inputRef.current?.blur()
  }, [onSelectResult, screenMap])

  // ── Teclado: ↑↓ Enter Escape ─────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (!isOpen || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocused(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocused(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && focused >= 0) {
      e.preventDefault()
      handleSelect(results[focused])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setFocused(-1)
      inputRef.current?.blur()
    }
  }, [isOpen, results, focused, handleSelect])

  // ── Click fuera ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // ── Detalles del resultado mejorados ─────────────────────────────────────────
  const getResultDetail = (item) => {
    if (item.type === 'patient')     return item.phone || item.email || 'Sin contacto'
    if (item.type === 'product')     return `${formatCurrency(item.price ?? 0, 'UYU')} ${item.stock !== undefined ? `· Stock: ${item.stock}` : ''}`
    if (item.type === 'appointment') return getRelativeDateTime(item.startTime)
    if (item.type === 'order')       return `${STATUS_LABELS_ES[item.status] || item.status || 'pendiente'} · ${formatCurrency(item.total || 0, 'UYU')}`
    return ''
  }

  const getResultName = (item) => {
    if (item.type === 'patient')     return item.name
    if (item.type === 'product')     return item.name
    if (item.type === 'appointment') return item.patientName
    if (item.type === 'order')       return item.customerName || `Pedido ${item.orderNumber || item.id?.slice(-6) || ''}`
    return '—'
  }

  // Detectar si el match fue por nota (para badge visual)
  const getMatchBadge = (item, lower) => {
    if (item.type === 'appointment' && lower && includesLower(item.notes, lower)) {
      return <span className="match-badge note">📝 nota</span>
    }
    if (item.type === 'order' && lower && includesLower(STATUS_LABELS_ES[item.status] || item.status, lower)) {
      return <span className="match-badge status">📌 estado</span>
    }
    return null
  }

  const ICONS = { patient: '👤', product: '📦', appointment: '📅', order: '🛒' }

  // Calcular si mostrar el estado "sin resultados"
  const hasActiveSearch = debouncedQuery.trim().length > 0
  const showNoResults = isOpen && hasActiveSearch && results.length === 0

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="global-search" ref={containerRef}>
      <div className="search-input-wrapper" style={{ position: 'relative' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="🔍 Buscar cliente, producto, pedido… (Ctrl+K)"
          value={query}
          onChange={e => { setQuery(e.target.value); setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Búsqueda global"
          aria-autocomplete="list"
          aria-expanded={isOpen && results.length > 0}
          autoComplete="off"
        />
        {query && (
          <button
            className="search-clear-btn"
            style={{ 
              background:'transparent', 
              border:'none', 
              cursor:'pointer', 
              color:'var(--text-tertiary)', 
              fontSize:16, 
              padding:'4px 8px',
              borderRadius:4,
              transition:'all 0.1s'
            }}
            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label="Limpiar búsqueda"
            tabIndex={-1}
          >
            ✕
          </button>
        )}
      </div>

      {/* CORREGIDO: Estado "sin resultados" */}
      {showNoResults && (
        <div
          className="search-no-results"
          style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            background: 'var(--bg-primary)', 
            border: '1px solid var(--border)', 
            borderRadius: '8px', 
            marginTop: '4px', 
            padding: '20px 16px',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 13,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000
          }}
        >
          Sin resultados para "<strong>{debouncedQuery}</strong>"
        </div>
      )}

      {isOpen && results.length > 0 && (
        <div
          className="search-results"
          role="listbox"
          aria-label="Resultados de búsqueda"
          style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            background: 'var(--bg-primary)', 
            border: '1px solid var(--border)', 
            borderRadius: '8px', 
            marginTop: '4px', 
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            maxHeight: '400px',
            overflowY: 'auto'
          }}
        >
          {/* Sugerencia de filtro rápido (modo profesional) */}
          {results.length > 3 && (
            <div style={{ 
              padding: '8px 12px', 
              borderBottom: '1px solid var(--border)', 
              fontSize: 11, 
              color: 'var(--text-tertiary)',
              display: 'flex',
              gap: 12
            }}>
              <span>🔍 {results.length} resultados</span>
              <span>💡 Usa ↑↓ y Enter</span>
            </div>
          )}
          
          {results.map((item, idx) => {
            // CORREGIDO: key con fallback robusto
            const itemKey = item.id ?? item.externalRef ?? item._searchIdx ?? idx
            return (
              <div
                key={`${item.type}-${itemKey}`}
                className="search-result-item"
                role="option"
                aria-selected={focused === idx}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '12px 16px', 
                  cursor: 'pointer', 
                  borderBottom: '1px solid var(--border)',
                  background: focused === idx ? 'var(--bg-tertiary)' : 'transparent',
                  transition: 'background 0.1s'
                }}
                onMouseDown={e => { e.preventDefault(); handleSelect(item) }}
                onMouseEnter={() => setFocused(idx)}
              >
                <span className="result-icon" style={{ fontSize: '20px' }}>{ICONS[item.type]}</span>
                <div className="result-info" style={{ flex: 1 }}>
                  <div className="result-name" style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getResultName(item)}
                    {getMatchBadge(item, debouncedQuery)}
                  </div>
                  <div className="result-detail" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {getResultDetail(item)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}