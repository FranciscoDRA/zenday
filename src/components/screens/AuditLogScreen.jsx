// src/components/screens/AuditLogScreen.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { getAuditLogs, clearAuditLogs } from '../../utils/audit'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'

// Importamos useAuth con guard para cuando AuthProvider no está en el árbol
let useAuthSafe
try {
  const { useAuth } = require('../../contexts/AuthContext')
  useAuthSafe = useAuth
} catch {
  useAuthSafe = () => ({ user: null })
}

const LOGS_PER_PAGE = 50

// ─── HELPERS (fuera del componente) ──────────────────────────────────────────

const ACTION_ICONS = {
  CREAR:         '➕',
  ACTUALIZAR:    '✏️',
  ELIMINAR:      '🗑️',
  REPROGRAMAR:   '🔄',
  CAMBIAR_ESTADO:'📌',
  PAGAR:         '💰',
}

const TYPE_ICONS = {
  Pedido:   '📅',
  Cliente:  '👤',
  Producto: '📦',
  Gasto:    '💰',
}

const getActionIcon = (action) => ACTION_ICONS[action] ?? '📝'
const getTypeIcon   = (type)   => TYPE_ICONS[type]     ?? '📋'

function formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** Descarga un blob como archivo con timing correcto. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 150)
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function AuditLogScreen({ nav }) {
  const focusRef = useScreenFocus()

  // Guard: si AuthProvider no está montado, user = null
  const { user } = useAuthSafe()

  const confirm = useConfirm()
  const toast   = useToast()

  const [allLogs,      setAllLogs]      = useState([])
  const [page,         setPage]         = useState(1)
  const [filter,       setFilter]       = useState('all')
  const [searchTerm,   setSearchTerm]   = useState('')
  const [selectedUser, setSelectedUser] = useState('all')
  const [dateRange,    setDateRange]    = useState({ start: '', end: '' })
  const [expandedLog,  setExpandedLog]  = useState(null)
  const [showStats,    setShowStats]    = useState(false)

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    const logs = getAuditLogs()
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    setAllLogs(logs)
  }, [])

  // ── Filtrado (useMemo) ─────────────────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    return allLogs.filter(log => {
      if (filter !== 'all'        && log.action !== filter)        return false
      if (selectedUser !== 'all'  && log.user   !== selectedUser)  return false

      if (dateRange.start) {
        if (new Date(log.timestamp) < new Date(dateRange.start)) return false
      }
      if (dateRange.end) {
        const end = new Date(dateRange.end)
        end.setHours(23, 59, 59, 999)
        if (new Date(log.timestamp) > end) return false
      }

      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        // Evitar JSON.stringify en cada elemento — buscar en campos primitivos primero
        const inPrimitive =
          (log.user   || '').toLowerCase().includes(term) ||
          (log.action || '').toLowerCase().includes(term) ||
          (log.type   || '').toLowerCase().includes(term) ||
          String(log.itemId || '').includes(term)

        if (inPrimitive) return true

        // Solo si no encontró en primitivos, serializar details
        return JSON.stringify(log.details || {}).toLowerCase().includes(term)
      }

      return true
    })
  }, [allLogs, filter, selectedUser, dateRange, searchTerm])

  // ── displayedLogs como valor derivado (no estado) ─────────────────────────
  const displayedLogs = useMemo(
    () => filteredLogs.slice(0, page * LOGS_PER_PAGE),
    [filteredLogs, page]
  )

  const hasMore = displayedLogs.length < filteredLogs.length

  // Resetear página cuando cambian los filtros
  useEffect(() => { setPage(1) }, [filter, selectedUser, dateRange, searchTerm])

  // ── Usuarios únicos ───────────────────────────────────────────────────────
  const uniqueUsers = useMemo(() => {
    const users = new Set(allLogs.map(log => log.user).filter(Boolean))
    return Array.from(users)
  }, [allLogs])

  // ── Estadísticas ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today       = new Date().toDateString()
    const todayCount  = allLogs.filter(l => new Date(l.timestamp).toDateString() === today).length
    const actionCounts = allLogs.reduce((acc, l) => {
      acc[l.action] = (acc[l.action] || 0) + 1
      return acc
    }, {})
    return {
      total:        allLogs.length,
      today:        todayCount,
      actions:      actionCounts,
      lastActivity: allLogs[0]?.timestamp ?? null,
    }
  }, [allLogs])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleClearLogs = useCallback(async () => {
    const ok = await confirm(
      '⚠️ ELIMINAR TODOS LOS REGISTROS\n\nEsta acción es PERMANENTE y no se puede deshacer.\n\n¿Deseás continuar?',
      'Confirmar eliminación'
    )
    if (!ok) return
    clearAuditLogs()
    setAllLogs([])
    setPage(1)
    toast.addToast('✅ Registros eliminados', 'success')
  }, [confirm, toast])

  const handleExportLogs = useCallback(() => {
    const exportData = {
      exportDate: new Date().toISOString(),
      exportedBy: user?.email ?? user?.displayName ?? 'Desconocido',
      totalLogs:  filteredLogs.length,
      filters: {
        action:    filter,
        user:      selectedUser,
        search:    searchTerm,
        dateRange: (dateRange.start || dateRange.end) ? dateRange : null,
      },
      logs: filteredLogs,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `zenday-audit-${new Date().toISOString().split('T')[0]}.json`)
    toast.addToast('📁 Auditoría exportada', 'success')
  }, [filteredLogs, filter, selectedUser, searchTerm, dateRange, user, toast])

  const handleCopyDetails = useCallback((details) => {
    navigator.clipboard?.writeText(JSON.stringify(details, null, 2))
    toast.addToast('📋 Detalles copiados', 'success')
  }, [toast])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="audit-log-screen">

      {/* Top bar */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">Registro de auditoría</h2>
        {allLogs.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="top-bar-action" onClick={handleExportLogs} title="Exportar" aria-label="Exportar logs">📥</button>
            <button className="top-bar-action" onClick={handleClearLogs} title="Limpiar" aria-label="Limpiar logs">🗑️</button>
          </div>
        )}
      </div>

      {/* Info de usuario */}
      <div
        style={{
          background:'var(--bg-tertiary)', borderRadius:12, padding:'12px 16px',
          marginBottom:20, display:'flex', alignItems:'center', gap:12,
          border:'1px solid var(--border)', cursor:'pointer',
        }}
        onClick={() => setShowStats(s => !s)}
        role="button"
        aria-expanded={showStats}
      >
        <span style={{ fontSize:24 }}>👤</span>
        <div>
          <div style={{ fontWeight:700 }}>{user?.displayName ?? user?.email?.split('@')[0] ?? 'Usuario'}</div>
          {user?.email && <div style={{ fontSize:12, color:'var(--text-tertiary)' }}>{user.email}</div>}
        </div>
        <div style={{ marginLeft:'auto', fontSize:12, color:'var(--text-tertiary)', textAlign:'right' }}>
          <div>Total: {stats.total} registros</div>
          <div>Hoy: {stats.today} actividades</div>
        </div>
      </div>

      {/* Stats expandibles */}
      {showStats && (
        <div style={{
          background:'var(--bg-secondary)', borderRadius:14, padding:16,
          marginBottom:20, border:'1px solid var(--border)',
        }}>
          <h4 style={{ margin:'0 0 12px' }}>📊 Estadísticas</h4>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10 }}>
            {Object.entries(stats.actions).map(([action, count]) => (
              <div key={action} style={{
                padding:'8px 12px', background:'var(--bg-tertiary)',
                borderRadius:10, display:'flex', justifyContent:'space-between', alignItems:'center',
              }}>
                <span style={{ fontSize:13 }}>{getActionIcon(action)} {action}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          {stats.lastActivity && (
            <div style={{ marginTop:12, fontSize:12, color:'var(--text-tertiary)' }}>
              Última actividad: {formatDate(stats.lastActivity)}
            </div>
          )}
        </div>
      )}

      {/* Búsqueda */}
      <div style={{ marginBottom:14 }}>
        <input
          type="text"
          placeholder="🔍 Buscar por usuario, acción, tipo, ID…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        style={{
  width: '100%',
  padding: '10px 16px',
  borderRadius: 24,
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: 14,
  fontFamily: 'inherit',
}}
        />
      </div>

      {/* Filtros de acción */}
      <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        {[
          { key:'all',          label:'Todos' },
          { key:'CREAR',        label:'➕ Creaciones' },
          { key:'ACTUALIZAR',   label:'✏️ Actualizaciones' },
          { key:'ELIMINAR',     label:'🗑️ Eliminaciones' },
          { key:'PAGAR',        label:'💰 Pagos' },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`filter-chip${filter === key ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtro por usuario (solo si hay más de 1) */}
      {uniqueUsers.length > 1 && (
        <div style={{ marginBottom:12 }}>
          <select
            value={selectedUser}
            onChange={e => setSelectedUser(e.target.value)}
            style={{
              padding:'8px 14px', borderRadius:20, border:'1px solid var(--border)',
              background:'var(--bg-secondary)', color:'var(--text-primary)', fontSize:13,
              fontFamily:'inherit',
            }}
          >
            <option value="all">👥 Todos los usuarios</option>
            {uniqueUsers.map(u => (                      // ← renombrado de user → u
              <option key={u} value={u}>👤 {u}</option>
            ))}
          </select>
        </div>
      )}

      {/* Rango de fechas */}
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        <input
          type="date"
          value={dateRange.start}
          onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
          style={{ flex:1, padding:'8px 12px', borderRadius:20, border:'1px solid var(--border)', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit' }}
        />
        <input
          type="date"
          value={dateRange.end}
          onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
          style={{ flex:1, padding:'8px 12px', borderRadius:20, border:'1px solid var(--border)', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit' }}
        />
        {(dateRange.start || dateRange.end) && (
          <button
            onClick={() => setDateRange({ start: '', end: '' })}
            style={{ padding:'8px 12px', borderRadius:20, border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', cursor:'pointer' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="audit-log-list">
        {filteredLogs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-emoji">📋</span>
            <h3 className="empty-title">Sin registros</h3>
            <p className="empty-subtitle">
              {allLogs.length === 0
                ? 'No hay actividades registradas'
                : 'No hay resultados para los filtros aplicados'}
            </p>
          </div>
        ) : (
          <>
            {displayedLogs.map(log => (
              <div
                key={log.id}
                className={`audit-log-item${expandedLog === log.id ? ' expanded' : ''}`}
                onClick={() => setExpandedLog(id => id === log.id ? null : log.id)}
                style={{ cursor:'pointer' }}
                role="button"
                aria-expanded={expandedLog === log.id}
              >
                <div className="audit-log-header">
                  <span className="audit-log-user">
                    {getActionIcon(log.action)} {log.action}
                  </span>
                  <span className="audit-log-time">{formatDate(log.timestamp)}</span>
                </div>

                <div className="audit-log-action">
                  <span className="audit-log-type">{getTypeIcon(log.type)} {log.type}</span>
                  <span className="audit-log-id">ID: {log.itemId}</span>
                </div>

                <div style={{ fontSize:13, color:'var(--accent-blue)', marginBottom:8 }}>
                  👤 <strong>{log.user}</strong>
                  {log.userEmail && ` (${log.userEmail})`}
                </div>

                {expandedLog === log.id && log.details && Object.keys(log.details).length > 0 && (
                  <div className="audit-log-details" onClick={e => e.stopPropagation()}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                      <strong style={{ fontSize:13 }}>Detalles:</strong>
                      <button
                        onClick={() => handleCopyDetails(log.details)}
                        style={{ padding:'3px 10px', fontSize:11, background:'transparent', border:'1px solid var(--border)', borderRadius:12, cursor:'pointer' }}
                      >
                        📋 Copiar
                      </button>
                    </div>
                    <pre style={{ fontSize:12, whiteSpace:'pre-wrap', margin:0, background:'var(--bg-tertiary)', padding:10, borderRadius:10 }}>
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <button
                onClick={() => setPage(p => p + 1)}
                style={{
                  width:'100%', padding:12, marginTop:16,
                  background:'var(--bg-secondary)', border:'1px solid var(--border)',
                  borderRadius:40, color:'var(--text-primary)', cursor:'pointer',
                  fontSize:14, fontFamily:'inherit', fontWeight:600,
                }}
              >
                Cargar más ({filteredLogs.length - displayedLogs.length} restantes)
              </button>
            )}
          </>
        )}
      </div>

      <div className="bottom-padding" />
    </div>
  )
}
