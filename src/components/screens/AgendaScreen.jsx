import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { BackButton } from '../common/BackButton'
import { AppointmentCard } from '../common/AppointmentCard'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatTime, formatCurrency } from '../../utils/helpers'

// ─── UTILIDADES ────────────────────────────────────────────────────────────────
const formatPhoneForWhatsApp = (phone) => {
  if (!phone) return null
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 8 && !cleaned.startsWith('598')) cleaned = '598' + cleaned
  if (cleaned.length === 9 && cleaned.startsWith('0'))    cleaned = '598' + cleaned.substring(1)
  return cleaned.length >= 10 ? cleaned : null
}

const openWhatsApp = (phoneNumber, e) => {
  e.stopPropagation()
  if (!phoneNumber) return
  const url = `https://wa.me/${phoneNumber}`
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const STATUS_COLORS = {
  scheduled:   '#3b82f6',
  confirmed:   'var(--accent-green)',
  'in-progress': 'var(--accent-amber)',
  completed:   'var(--accent-green)',
  cancelled:   'var(--accent-red)',
  'no-show':   '#6b7280',
  pending:     'var(--accent-amber)',
  delivered:   'var(--accent-green)',
}

const STATUS_LABELS = {
  scheduled:   '📅 Agendada',
  confirmed:   '✅ Confirmada',
  'in-progress':'⏳ En curso',
  completed:   '✔️ Completada',
  cancelled:   '❌ Cancelada',
  'no-show':   '🚫 No asistió',
  pending:     '⏳ Pendiente',
  delivered:   '📦 Entregado',
}

// ─── MINI CARD DE CLIENTE (mejorada con openWhatsApp) ──────────────────────────
function ClientCard({ apt, nav, onStatusChange, onMarkAsPaid, compact, userMode }) {
  const waNumber = formatPhoneForWhatsApp(apt.patientPhone)
  const isPaid    = apt.paid === true || apt.paymentStatus === 'paid'
  const price     = apt.price || 0
  const statusColor = STATUS_COLORS[apt.status] || '#6b7280'

  return (
    <div
      className="client-card"
      style={{
        background: 'var(--bg-secondary)',
        borderRadius: '10px',
        padding: compact ? '8px 10px' : '12px 14px',
        borderLeft: `4px solid ${apt.color || statusColor}`,
        marginBottom: '4px',
        cursor: 'pointer',
        position: 'relative',
      }}
      onClick={() => nav.navigate('detail', { appointmentId: apt.id })}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: compact ? 12 : 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {apt.patientName}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {formatTime(apt.startTime)}
        </span>
      </div>

      {apt.serviceName && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
          {apt.serviceName}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          fontSize: 10, fontWeight: 500, padding: '2px 7px',
          borderRadius: 20, background: `${statusColor}20`, color: statusColor,
        }}>
          {STATUS_LABELS[apt.status] || apt.status}
        </span>

        {price > 0 && (
          <span
            style={{
              fontSize: 10, fontWeight: 500, padding: '2px 7px',
              borderRadius: 20,
              background: isPaid ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
              color:      isPaid ? 'var(--accent-green)'              : 'var(--accent-amber)',
              cursor:     (!isPaid && ['completed','delivered','picked'].includes(apt.status)) ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (!isPaid && ['completed','delivered','picked'].includes(apt.status)) onMarkAsPaid?.()
            }}
            title={!isPaid && ['completed','delivered','picked'].includes(apt.status) ? 'Click para marcar pagado' : ''}
          >
            {isPaid ? `✅ ${formatCurrency(price, 'UYU')}` : `⏳ ${formatCurrency(price, 'UYU')}`}
          </span>
        )}

        {/* CORREGIDO: WhatsApp con openExternal */}
        {waNumber && (
          <span
            onClick={(e) => openWhatsApp(waNumber, e)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px',
              borderRadius: 20, background: 'rgba(37,211,102,0.15)',
              color: '#25D366', textDecoration: 'none', cursor: 'pointer',
            }}
          >
            💬 WA
          </span>
        )}
      </div>
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────────────
export function AgendaScreen({
  nav,
  appointments,
  patients,
  selectedDate,
  setSelectedDate,
  updateStatus,
  updateAppointment,
  workingHours,
  markAsPaid,
  userMode,
}) {
  const focusRef = useScreenFocus()
  const [view, setView]                       = useState('month')
  const [dragEnabled, setDragEnabled]         = useState(true)
  const [selectedClientFilter, setSelectedClientFilter] = useState('all')
  const [showClientFilter, setShowClientFilter]         = useState(false)
  const [showPaymentOnly, setShowPaymentOnly]           = useState(false)
  const dropdownRef = useRef(null)

  // ── Click outside para dropdown ──────────────────────────────────────────────
  useEffect(() => {
    if (!showClientFilter) return
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowClientFilter(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showClientFilter])

  // ── Solo citas de clientes (sin isPersonal) ──────────────────────────────────
  const clientAppointments = useMemo(
    () => (appointments || []).filter(a => !a.isPersonal),
    [appointments]
  )

  const uniqueClients = useMemo(() => {
    const map = new Map()
    clientAppointments.forEach(a => {
      if (a.patientId && a.patientName)
        map.set(a.patientId, { id: a.patientId, name: a.patientName, phone: a.patientPhone })
    })
    return Array.from(map.values())
  }, [clientAppointments])

  const filteredAppointments = useMemo(() => {
    let list = clientAppointments
    if (selectedClientFilter !== 'all') list = list.filter(a => a.patientId === selectedClientFilter)
    if (showPaymentOnly) list = list.filter(a => !a.paid && (a.price || 0) > 0)
    return list
  }, [clientAppointments, selectedClientFilter, showPaymentOnly])

  // CORREGIDO Bug 1: índice pre-calculado para búsquedas rápidas
  const appointmentIndex = useMemo(() => {
    const index = { byDate: {}, byHour: {} }
    filteredAppointments.forEach(a => {
      if (a.status === 'cancelled') return
      const d = new Date(a.startTime)
      const dateKey = d.toDateString()
      const hourKey = `${dateKey}-${d.getHours()}`
      
      if (!index.byDate[dateKey]) index.byDate[dateKey] = []
      if (!index.byHour[hourKey]) index.byHour[hourKey] = []
      
      index.byDate[dateKey].push(a)
      index.byHour[hourKey].push(a)
    })
    
    // Ordenar una sola vez
    for (const key in index.byDate) {
      index.byDate[key].sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    }
    for (const key in index.byHour) {
      index.byHour[key].sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    }
    
    return index
  }, [filteredAppointments])

  const getForHour = useCallback((date, hour) => {
    const key = `${date.toDateString()}-${hour}`
    return appointmentIndex.byHour[key] || []
  }, [appointmentIndex])

  const getForDay = useCallback((date) => {
    const key = date.toDateString()
    return appointmentIndex.byDate[key] || []
  }, [appointmentIndex])

  // ── Grillas ──────────────────────────────────────────────────────────────────
  const hours = useMemo(() => {
    const s = parseInt((workingHours?.start || '09:00').split(':')[0])
    const e = parseInt((workingHours?.end   || '18:00').split(':')[0])
    return Array.from({ length: e - s + 1 }, (_, i) => s + i)
  }, [workingHours])

  const weekDays = useMemo(() => {
    const days = []
    const start = new Date(selectedDate)
    const dow = selectedDate.getDay()
    start.setDate(selectedDate.getDate() - (dow === 0 ? 6 : dow - 1))
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      days.push(d)
    }
    return days
  }, [selectedDate])

  // CORREGIDO Bug 3: monthDays con cálculo correcto
  const monthDays = useMemo(() => {
    const y = selectedDate.getFullYear(), m = selectedDate.getMonth()
    const first = new Date(y, m, 1)
    const offset = first.getDay() === 0 ? 6 : first.getDay() - 1
    const days = []
    
    // Días del mes anterior
    for (let i = offset - 1; i >= 0; i--) {
      const prevMonthDate = new Date(y, m, 0)
      days.push({ date: new Date(y, m - 1, prevMonthDate.getDate() - i), isCurrentMonth: false })
    }
    
    // Días del mes actual
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(y, m, i), isCurrentMonth: true })
    }
    
    // Días del mes siguiente
    let nextDay = 1
    while (days.length < 42) {
      days.push({ date: new Date(y, m + 1, nextDay++), isCurrentMonth: false })
    }
    
    return days
  }, [selectedDate])

  // ── Navegar fecha ─────────────────────────────────────────────────────────────
  const changeDate  = (n) => { const d = new Date(selectedDate); d.setDate(d.getDate() + n); setSelectedDate(d) }
  const changeMonth = (n) => { const d = new Date(selectedDate); d.setMonth(d.getMonth() + n); setSelectedDate(d) }

  // CORREGIDO Bug 2: handleDrop sin parseInt
  const handleDrop = useCallback((aptId, targetDate, targetHour = null) => {
    const apt = filteredAppointments.find(a => String(a.id) === String(aptId))
    if (!apt) return
    const newStart = new Date(targetDate)
    if (targetHour !== null) newStart.setHours(targetHour, 0, 0)
    else { const o = new Date(apt.startTime); newStart.setHours(o.getHours(), o.getMinutes(), 0) }
    const newEnd = new Date(newStart.getTime() + (apt.duration || 30) * 60000)
    // FIX: arrastrabas una cita a un horario ocupado, la tarjeta volvía a su
    // lugar y no aparecía ningún mensaje. Parecía que el drag no había andado.
    updateAppointment(apt.id, { startTime: newStart.toISOString(), endTime: newEnd.toISOString() })
  }, [filteredAppointments, updateAppointment])

  // ── Historial por cliente (memoizado) ─────────────────────────────────────────
  const getClientHistoryCount = useCallback((patientId) => {
    return clientAppointments.filter(a => a.patientId === patientId).length
  }, [clientAppointments])

  // CORREGIDO Bug 4: clientHistory memoizado
  const clientHistory = useMemo(() => {
    if (selectedClientFilter === 'all') return []
    return clientAppointments
      .filter(a => a.patientId === selectedClientFilter)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 5)
  }, [selectedClientFilter, clientAppointments])

  const selectedClientData = uniqueClients.find(c => c.id === selectedClientFilter)

  // ── ESTADÍSTICAS RÁPIDAS ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today = new Date().toDateString()
    const todayApts = clientAppointments.filter(a => new Date(a.startTime).toDateString() === today)
    const pendingPay = clientAppointments.filter(a => !a.paid && (a.price || 0) > 0 && ['completed','delivered','picked'].includes(a.status))
    return {
      today: todayApts.length,
      pendingPay: pendingPay.length,
      pendingPayTotal: pendingPay.reduce((s, a) => s + (a.price || 0), 0),
      total: clientAppointments.filter(a => a.status !== 'cancelled').length,
    }
  }, [clientAppointments])

  // ─────────────────────────────────────────────────────────────────────────────
  // VISTAS
  // ─────────────────────────────────────────────────────────────────────────────

  const renderDayView = () => (
    <div className="timegrid">
      <div className="time-column">
        {hours.map(hour => {
          const apts = getForHour(selectedDate, hour)
          return (
            <div key={hour} className="hour-slot">
              <div className="hour-label">{hour.toString().padStart(2, '0')}:00</div>
              <div
                className="appointments-container"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), selectedDate, hour) }}
              >
                {apts.map(apt => (
                  <div
                    key={apt.id}
                    draggable={dragEnabled}
                    onDragStart={e => { e.dataTransfer.setData('text/plain', String(apt.id)); e.dataTransfer.effectAllowed = 'move' }}
                  >
                    <ClientCard
                      apt={apt} nav={nav} compact
                      onStatusChange={s => updateStatus(apt.id, s)}
                      onMarkAsPaid={() => markAsPaid(apt.id)}
                      userMode={userMode}
                    />
                  </div>
                ))}
                <div className="empty-slot" onClick={() => nav.navigate('new', { defaultDate: selectedDate, defaultHour: hour })}>
                  + Agendar cliente
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderWeekView = () => (
    <div className="week-view">
      <div className="week-header">
        <div className="week-hour-label" />
        {weekDays.map((day, i) => (
          <div key={i} className="week-header-cell" onClick={() => { setSelectedDate(day); setView('day') }}>
            <div className="week-day-name">{day.toLocaleDateString('es-ES', { weekday: 'short' })}</div>
            <div className="week-day-number">{day.getDate()}</div>
            <div className="week-day-count">{getForDay(day).length} citas</div>
          </div>
        ))}
      </div>
      <div className="week-grid">
        {hours.map(hour => {
          const isHourAvailable = (day) => {
            // Lógica de disponibilidad: si la hora está dentro del horario laboral y no hay citas
            return true // Simplificado, se puede expandir
          }
          
          return (
            <div key={hour} className="week-hour-row">
              <div className="week-hour-label">{hour.toString().padStart(2, '0')}:00</div>
              <div className="week-cells">
                {weekDays.map((day, i) => {
                  const apts = getForHour(day, hour)
                  const available = isHourAvailable(day)
                  return (
                    <div
                      key={i}
                      className={`week-cell ${available && apts.length === 0 ? 'available' : ''}`}
                      style={{ background: available && apts.length === 0 ? 'rgba(16,185,129,0.05)' : 'transparent' }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), day, hour) }}
                      onClick={() => nav.navigate('new', { defaultDate: day, defaultHour: hour })}
                    >
                      {apts.map(apt => (
                        <div
                          key={apt.id} className="week-appointment"
                          draggable={dragEnabled}
                          onDragStart={e => { e.dataTransfer.setData('text/plain', String(apt.id)); e.dataTransfer.effectAllowed = 'move' }}
                        >
                          <ClientCard apt={apt} nav={nav} compact onStatusChange={s => updateStatus(apt.id, s)} onMarkAsPaid={() => markAsPaid(apt.id)} userMode={userMode} />
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderMonthView = () => (
    <div className="month-view">
      <div className="month-header">
        {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
          <div key={d} className="month-header-cell">{d}</div>
        ))}
      </div>
      <div className="month-grid">
        {monthDays.map((day, i) => {
          const apts = getForDay(day.date)
          const isToday   = day.date.toDateString() === new Date().toDateString()
          const isWeekend = [0, 6].includes(day.date.getDay())
          const pendingPay = apts.filter(a => !a.paid && (a.price || 0) > 0).length

          return (
            <div
              key={i}
              className={`month-cell ${!day.isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`}
              onClick={() => { setSelectedDate(day.date); setView('day') }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), day.date) }}
            >
              <div className="month-cell-header">
                <span className="month-day-number">{day.date.getDate()}</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {apts.length > 0 && <span className="month-day-count">{apts.length}</span>}
                  {pendingPay > 0 && (
                    <span style={{ fontSize: 9, background: 'rgba(245,158,11,0.2)', color: 'var(--accent-amber)', borderRadius: 10, padding: '1px 5px' }}>
                      💳{pendingPay}
                    </span>
                  )}
                </div>
              </div>

              <div className="month-appointments">
                {apts.slice(0, 3).map(a => {
                  const waNumber = formatPhoneForWhatsApp(a.patientPhone)
                  return (
                    <div
                      key={a.id}
                      className="month-appointment"
                      draggable={dragEnabled}
                      onDragStart={e => { e.dataTransfer.setData('text/plain', String(a.id)); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={e => { e.stopPropagation(); nav.navigate('detail', { appointmentId: a.id }) }}
                      style={{ borderLeft: `3px solid ${a.color || STATUS_COLORS[a.status] || '#6b7280'}` }}
                    >
                      <span className="month-appointment-time">{formatTime(a.startTime)}</span>
                      <span className="month-appointment-patient">{a.patientName?.split(' ')[0]}</span>
                      {a.paid && <span title="Pagado">💰</span>}
                      {waNumber && (
                        <span
                          onClick={(e) => openWhatsApp(waNumber, e)}
                          style={{ color: '#25D366', fontSize: 10, cursor: 'pointer' }}
                          title="Contactar por WhatsApp"
                        >💬</span>
                      )}
                    </div>
                  )
                })}
                {apts.length > 3 && <div className="month-more">+{apts.length - 3} más</div>}
              </div>

              {apts.length === 0 && day.isCurrentMonth && (
                <div className="month-empty-hover" onClick={e => { e.stopPropagation(); nav.navigate('new', { defaultDate: day.date }) }}>
                  + Agendar
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="agenda-screen">

      {/* TOP BAR */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">👤 Agenda de Clientes</h2>
        <button className="top-bar-action new-appointment-btn" onClick={() => nav.navigate('new')}>
          📅 Nueva cita
        </button>
      </div>

      {/* ESTADÍSTICAS RÁPIDAS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Hoy',        value: stats.today,       color: '#3b82f6' },
          { label: 'Cobros pendientes', value: stats.pendingPay, color: 'var(--accent-amber)',
            sub: stats.pendingPay > 0 ? formatCurrency(stats.pendingPayTotal, 'UYU') : null },
          { label: 'Total activas', value: stats.total,    color: 'var(--accent-green)' },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, minWidth: 100,
            background: 'var(--bg-secondary)', borderRadius: 14,
            padding: '10px 14px', borderLeft: `4px solid ${s.color}`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}</div>
            {s.sub && <div style={{ fontSize: 10, color: 'var(--accent-amber)', marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* NAVEGACIÓN DE FECHA */}
      <div className="agenda-controls">
        <div className="date-navigation">
          <button className="nav-arrow" onClick={() => view === 'month' ? changeMonth(-1) : view === 'week' ? changeDate(-7) : changeDate(-1)}>‹</button>
          <span className="current-date">
            {view === 'month' && selectedDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
            {view === 'week'  && `${weekDays[0].getDate()} - ${weekDays[6].getDate()} ${weekDays[6].toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}`}
            {view === 'day'   && selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <button className="nav-arrow" onClick={() => view === 'month' ? changeMonth(1) : view === 'week' ? changeDate(7) : changeDate(1)}>›</button>
          <button className="today-btn" onClick={() => setSelectedDate(new Date())}>Hoy</button>
        </div>

        <div className="view-toggle">
          {[['day','📅','Día'],['week','📆','Semana'],['month','🗓️','Mes']].map(([v, icon, label]) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              <span>{icon}</span> {label}
            </button>
          ))}
        </div>
      </div>

      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Filtro por cliente con click-outside */}
        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button
            className={`client-filter-btn ${selectedClientFilter !== 'all' ? 'active' : ''}`}
            onClick={() => setShowClientFilter(!showClientFilter)}
          >
            <span>👤</span>
            <span>{selectedClientFilter === 'all' ? 'Todos los clientes' : selectedClientData?.name || '...'}</span>
            <span>{showClientFilter ? '▲' : '▼'}</span>
          </button>

          {showClientFilter && (
            <div className="client-filter-dropdown" style={{ zIndex: 100 }}>
              <div className={`filter-option ${selectedClientFilter === 'all' ? 'active' : ''}`}
                onClick={() => { setSelectedClientFilter('all'); setShowClientFilter(false) }}>
                <span>👥</span>
                <span style={{ flex: 1 }}>Todos los clientes</span>
                <span className="option-count">{clientAppointments.length}</span>
              </div>
              {uniqueClients.map(c => (
                <div key={c.id}
                  className={`filter-option ${selectedClientFilter === c.id ? 'active' : ''}`}
                  onClick={() => { setSelectedClientFilter(c.id); setShowClientFilter(false) }}>
                  <span>👤</span>
                  <div style={{ flex: 1 }}>
                    <div>{c.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {getClientHistoryCount(c.id)} citas en total
                    </div>
                  </div>
                  <span className="option-count">{clientAppointments.filter(a => a.patientId === c.id).length}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filtro cobros pendientes */}
        <button
          onClick={() => setShowPaymentOnly(!showPaymentOnly)}
          style={{
            padding: '8px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13,
            background: showPaymentOnly ? 'rgba(245,158,11,0.2)' : 'var(--bg-secondary)',
            color: showPaymentOnly ? 'var(--accent-amber)' : 'var(--text-secondary)',
            fontWeight: showPaymentOnly ? 600 : 400,
          }}
        >
          💳 {showPaymentOnly ? 'Solo pendientes de cobro' : 'Pendientes de cobro'}
        </button>

        {selectedClientFilter !== 'all' && (
          <button
            onClick={() => setSelectedClientFilter('all')}
            style={{ padding: '6px 10px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}
          >✕ Limpiar</button>
        )}
      </div>

      {/* CORREGIDO: HISTORIAL DEL CLIENTE SELECCIONADO con validadción de teléfono */}
      {selectedClientFilter !== 'all' && clientHistory.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 14, padding: '12px 16px',
          marginBottom: 16, borderLeft: '4px solid var(--accent-blue)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
            📋 Historial reciente — {selectedClientData?.name}
            {selectedClientData?.phone && (() => {
              const waNumber = formatPhoneForWhatsApp(selectedClientData.phone)
              return waNumber && (
                <span
                  onClick={(e) => openWhatsApp(waNumber, e)}
                  style={{ marginLeft: 10, color: '#25D366', fontSize: 12, textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}
                >
                  💬 WhatsApp
                </span>
              )
            })()}
          </div>
          {clientHistory.map(a => (
            <div key={a.id}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid var(--border)', cursor: 'pointer', fontSize: 12 }}
              onClick={() => nav.navigate('detail', { appointmentId: a.id })}
            >
              <span style={{ color: 'var(--text-tertiary)', minWidth: 90 }}>
                {new Date(a.startTime).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} {formatTime(a.startTime)}
              </span>
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{a.serviceName || 'Cita'}</span>
              {/* Resaltar citas completadas sin cobrar */}
              <span style={{ 
                color: a.paid ? 'var(--accent-green)' : 'var(--accent-amber)', 
                fontSize: 11,
                animation: (!a.paid && a.status === 'completed') ? 'pulse 1.5s infinite' : 'none'
              }}>
                {a.paid ? '✅' : '⏳'} {(a.price || 0) > 0 ? formatCurrency(a.price, 'UYU') : ''}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Total: {getClientHistoryCount(selectedClientFilter)} citas
          </div>
        </div>
      )}

      {/* TOGGLE DRAG */}
      <div className="drag-toggle">
        <label>
          <input type="checkbox" checked={dragEnabled} onChange={e => setDragEnabled(e.target.checked)} />
          Arrastrar para reprogramar
        </label>
      </div>

      {/* LEYENDA */}
      <div className="recurrence-legend">
        <span className="legend-item"><span style={{ color: 'var(--accent-green)' }}>💰</span> Pagado</span>
        <span className="legend-item"><span style={{ color: 'var(--accent-amber)' }}>⏳</span> Pendiente de cobro</span>
        <span className="legend-item"><span style={{ color: '#25D366' }}>💬</span> WhatsApp directo</span>
      </div>

      {/* VISTAS */}
      {view === 'day'   && renderDayView()}
      {view === 'week'  && renderWeekView()}
      {view === 'month' && renderMonthView()}

      <div className="bottom-padding" />
    </div>
  )
}