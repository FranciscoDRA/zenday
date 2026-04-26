import React, { useState, useMemo, useReducer, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { useToast } from '../../contexts/ToastContext'

// ─── CONSTANTES ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'health',   label: '🏃 Salud',      color: '#10b981' },
  { id: 'work',     label: '💼 Trabajo',     color: '#3b82f6' },
  { id: 'social',   label: '🎉 Social',      color: '#ec4899' },
  { id: 'home',     label: '🏠 Hogar',       color: '#f59e0b' },
  { id: 'study',    label: '📚 Estudio',     color: '#8b5cf6' },
  { id: 'finance',  label: '💰 Finanzas',    color: '#22c55e' },
  { id: 'other',    label: '✨ Otro',         color: '#6b7280' },
]

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

const STORAGE_KEY = 'zenday-personal-events'

// ─── REDUCER ───────────────────────────────────────────────────────────────────
function eventsReducer(state, action) {
  let next
  switch (action.type) {
    case 'SET':    next = action.payload; break
    case 'ADD':    next = [...state, action.payload]; break
    case 'UPDATE': next = state.map(e => e.id === action.id ? { ...e, ...action.payload } : e); break
    case 'DELETE': next = state.filter(e => e.id !== action.id); break
    default:       return state
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function initEvents() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

// ─── FORMULARIO DE EVENTO ───────────────────────────────────────────────────────
const EMPTY_FORM = { title: '', category: 'other', date: '', time: '', duration: 60, notes: '', allDay: false, reminder: false }

function EventForm({ initial = EMPTY_FORM, onSave, onCancel }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cat = CAT_MAP[form.category]

  const handleSubmit = () => {
    if (!form.title.trim()) return
    if (!form.allDay && (!form.date || !form.time)) return
    if (form.allDay && !form.date) return
    onSave(form)
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: 18, padding: 20,
      marginBottom: 20, border: `2px solid ${cat?.color || '#6b7280'}30`,
    }}>
      <div style={{ marginBottom: 14 }}>
        <input
          autoFocus
          placeholder="¿Qué tenés que hacer?"
          value={form.title}
          onChange={e => set('title', e.target.value)}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 12,
            border: '0.5px solid var(--border)', background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)', fontSize: 15, fontWeight: 500,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Categoría */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => set('category', c.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
              background: form.category === c.id ? c.color : `${c.color}20`,
              color:      form.category === c.id ? 'white'  : c.color,
              fontWeight: form.category === c.id ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Todo el día toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} />
        Todo el día
      </label>

      {/* Fecha / Hora */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="date" value={form.date} onChange={e => set('date', e.target.value)}
          style={inputStyle}
        />
        {!form.allDay && (
          <input
            type="time" value={form.time} onChange={e => set('time', e.target.value)}
            style={inputStyle}
          />
        )}
        {!form.allDay && (
          <select value={form.duration} onChange={e => set('duration', parseInt(e.target.value))} style={inputStyle}>
            {[15,30,45,60,90,120,180].map(d => (
              <option key={d} value={d}>{d < 60 ? `${d} min` : `${d/60}h`}</option>
            ))}
          </select>
        )}
      </div>

      {/* Notas */}
      <textarea
        placeholder="Notas adicionales (opcional)..."
        value={form.notes}
        onChange={e => set('notes', e.target.value)}
        rows={2}
        style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: 14, boxSizing: 'border-box' }}
      />

      {/* Recordatorio */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
        <input type="checkbox" checked={form.reminder} onChange={e => set('reminder', e.target.checked)} />
        🔔 Recordarme este evento
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnSecondary}>Cancelar</button>
        <button
          onClick={handleSubmit}
          style={{ ...btnPrimary, background: cat?.color || '#6b7280' }}
          disabled={!form.title.trim() || !form.date}
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

// ─── MINI CARD DE EVENTO ─────────────────────────────────────────────────────────
function EventCard({ event, onEdit, onDelete }) {
  const cat     = CAT_MAP[event.category] || CAT_MAP.other
  const [expand, setExpand] = useState(false)

  const timeStr = event.allDay
    ? 'Todo el día'
    : (() => {
        try {
          return new Date(event.startTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        } catch { return '' }
      })()

  return (
    <div
      style={{
        background: 'var(--bg-secondary)', borderRadius: 12, padding: '10px 14px',
        borderLeft: `4px solid ${cat.color}`, marginBottom: 6, cursor: 'pointer',
      }}
      onClick={() => setExpand(!expand)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{timeStr}</span>
          <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title}
          </span>
          {event.reminder && <span style={{ fontSize: 10 }}>🔔</span>}
        </div>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 20,
          background: `${cat.color}20`, color: cat.color, whiteSpace: 'nowrap',
        }}>
          {cat.label}
        </span>
      </div>

      {expand && (
        <div style={{ marginTop: 10 }}>
          {!event.allDay && event.duration && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              ⏱ {event.duration < 60 ? `${event.duration} min` : `${event.duration / 60}h`}
            </div>
          )}
          {event.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              📝 {event.notes}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={e => { e.stopPropagation(); onEdit(event) }} style={{ ...btnSecondary, fontSize: 12, padding: '4px 12px' }}>
              ✏️ Editar
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(event.id) }} style={{ ...btnDanger, fontSize: 12, padding: '4px 12px' }}>
              🗑️ Eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────────────
export function PersonalAgendaScreen({ nav }) {
  const focusRef = useScreenFocus()
  const toast    = useToast()
  const [events, dispatch] = useReducer(eventsReducer, null, initEvents)
  const [view, setView]    = useState('month')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [showForm, setShowForm]         = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('all')

  // ── Helpers de fecha ─────────────────────────────────────────────────────────
  const changeDate = n => { const d = new Date(selectedDate); d.setDate(d.getDate() + n); setSelectedDate(d) }
  const changeMonth = n => { const d = new Date(selectedDate); d.setMonth(d.getMonth() + n); setSelectedDate(d) }

  const weekDays = useMemo(() => {
    const days = [], start = new Date(selectedDate)
    const dow = selectedDate.getDay()
    start.setDate(selectedDate.getDate() - (dow === 0 ? 6 : dow - 1))
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d) }
    return days
  }, [selectedDate])

  const monthDays = useMemo(() => {
    const y = selectedDate.getFullYear(), m = selectedDate.getMonth()
    const first  = new Date(y, m, 1)
    const offset = first.getDay() === 0 ? 6 : first.getDay() - 1
    const days   = []
    for (let i = offset - 1; i >= 0; i--)
      days.push({ date: new Date(y, m - 1, new Date(y, m, 0).getDate() - i), isCurrentMonth: false })
    for (let i = 1; i <= new Date(y, m + 1, 0).getDate(); i++)
      days.push({ date: new Date(y, m, i), isCurrentMonth: true })
    while (days.length < 42)
      days.push({ date: new Date(y, m + 1, days.length - new Date(y, m + 1, 0).getDate()), isCurrentMonth: false })
    return days
  }, [selectedDate])

  // ── Filtrado ─────────────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (selectedCategory === 'all') return events
    return events.filter(e => e.category === selectedCategory)
  }, [events, selectedCategory])

  const getForDay = (date) =>
    filteredEvents.filter(e => {
      try { return new Date(e.startTime).toDateString() === date.toDateString() }
      catch { return false }
    }).sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return new Date(a.startTime) - new Date(b.startTime)
    })

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const buildStartTime = (form) => {
    if (!form.date) return new Date().toISOString()
    if (form.allDay) return new Date(form.date + 'T00:00:00').toISOString()
    return new Date(`${form.date}T${form.time || '09:00'}:00`).toISOString()
  }

  const handleSave = useCallback((form) => {
    const startTime = buildStartTime(form)
    if (editingEvent) {
      dispatch({ type: 'UPDATE', id: editingEvent.id, payload: { ...form, startTime } })
      toast.addToast('✅ Evento actualizado', 'success')
      setEditingEvent(null)
    } else {
      dispatch({ type: 'ADD', payload: { id: Date.now(), ...form, startTime, isPersonal: true, createdAt: new Date().toISOString() } })
      toast.addToast('✅ Evento creado', 'success')
      setShowForm(false)
    }
  }, [editingEvent, toast])

  const handleDelete = useCallback((id) => {
    if (!window.confirm('¿Eliminar este evento?')) return
    dispatch({ type: 'DELETE', id })
    toast.addToast('🗑️ Evento eliminado', 'info')
    setEditingEvent(null)
  }, [toast])

  // ── Estadísticas ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today    = new Date().toDateString()
    const upcoming = events.filter(e => new Date(e.startTime) >= new Date())
    const todayEvs = events.filter(e => new Date(e.startTime).toDateString() === today)
    return { today: todayEvs.length, upcoming: upcoming.length, total: events.length }
  }, [events])

  // ─────────────────────────────────────────────────────────────────────────────
  // VISTAS
  // ─────────────────────────────────────────────────────────────────────────────

  const renderDayView = () => {
    const dayEvs = getForDay(selectedDate)
    return (
      <div style={{ padding: '0 4px' }}>
        {dayEvs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🗓️</div>
            <p>Sin eventos para este día</p>
            <button style={{ ...btnPrimary, marginTop: 10 }} onClick={() => { setShowForm(true) }}>+ Agregar evento</button>
          </div>
        ) : (
          dayEvs.map(e => (
            editingEvent?.id === e.id
              ? <EventForm key={e.id} initial={{ ...e, date: e.startTime?.split('T')[0], time: e.startTime?.split('T')[1]?.slice(0,5) || '' }}
                  onSave={handleSave} onCancel={() => setEditingEvent(null)} />
              : <EventCard key={e.id} event={e} onEdit={setEditingEvent} onDelete={handleDelete} />
          ))
        )}
      </div>
    )
  }

  const renderWeekView = () => (
    <div>
      {/* Header días */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
        {weekDays.map((day, i) => {
          const dayEvs   = getForDay(day)
          const isToday  = day.toDateString() === new Date().toDateString()
          const isSelected = day.toDateString() === selectedDate.toDateString()
          return (
            <div
              key={i}
              onClick={() => { setSelectedDate(day); setView('day') }}
              style={{
                textAlign: 'center', padding: '10px 4px', borderRadius: 12,
                cursor: 'pointer',
                background: isSelected ? 'var(--accent-blue)' : isToday ? 'rgba(59,130,246,0.1)' : 'var(--bg-secondary)',
                border: isToday && !isSelected ? '1.5px solid var(--accent-blue)' : '1.5px solid transparent',
                color: isSelected ? 'white' : 'var(--text-primary)',
              }}
            >
              <div style={{ fontSize: 11, marginBottom: 4, opacity: 0.7 }}>
                {day.toLocaleDateString('es-ES', { weekday: 'short' })}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{day.getDate()}</div>
              {dayEvs.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 4, flexWrap: 'wrap' }}>
                  {dayEvs.slice(0, 3).map((e, j) => (
                    <div key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_MAP[e.category]?.color || '#6b7280' }} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Eventos del día seleccionado */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
          {selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        {renderDayView()}
      </div>
    </div>
  )

  const renderMonthView = () => {
    const byDate = {}
    filteredEvents.forEach(e => {
      try {
        const k = new Date(e.startTime).toDateString()
        if (!byDate[k]) byDate[k] = []
        byDate[k].push(e)
      } catch {}
    })

    return (
      <div className="month-view">
        <div className="month-header">
          {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
            <div key={d} className="month-header-cell">{d}</div>
          ))}
        </div>
        <div className="month-grid">
          {monthDays.map((day, i) => {
            const dayEvs   = byDate[day.date.toDateString()] || []
            const isToday   = day.date.toDateString() === new Date().toDateString()
            const isWeekend = [0, 6].includes(day.date.getDay())

            return (
              <div
                key={i}
                className={`month-cell ${!day.isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`}
                onClick={() => { setSelectedDate(day.date); setView('day') }}
              >
                <div className="month-cell-header">
                  <span className="month-day-number">{day.date.getDate()}</span>
                  {dayEvs.length > 0 && <span className="month-day-count">{dayEvs.length}</span>}
                </div>

                <div className="month-appointments">
                  {dayEvs.slice(0, 3).map((e, j) => {
                    const cat = CAT_MAP[e.category] || CAT_MAP.other
                    return (
                      <div
                        key={j}
                        className="month-appointment"
                        style={{ borderLeft: `3px solid ${cat.color}`, background: `${cat.color}15` }}
                        onClick={ev => { ev.stopPropagation(); setSelectedDate(day.date); setView('day') }}
                      >
                        <span style={{ fontSize: 9 }}>
                          {e.allDay ? '☀️' : new Date(e.startTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="month-appointment-patient" style={{ color: cat.color }}>
                          {e.title.length > 10 ? e.title.slice(0, 10) + '…' : e.title}
                        </span>
                      </div>
                    )
                  })}
                  {dayEvs.length > 3 && <div className="month-more">+{dayEvs.length - 3} más</div>}
                </div>

                {dayEvs.length === 0 && day.isCurrentMonth && (
                  <div
                    className="month-empty-hover"
                    onClick={e => {
                      e.stopPropagation()
                      setSelectedDate(day.date)
                      setShowForm(true)
                    }}
                  >
                    + Agregar
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="agenda-screen">

      {/* TOP BAR */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">🙋 Agenda Personal</h2>
        <button
          className="top-bar-action new-appointment-btn"
          onClick={() => { setEditingEvent(null); setShowForm(!showForm) }}
        >
          {showForm ? '✕ Cerrar' : '+ Nuevo evento'}
        </button>
      </div>

      {/* ESTADÍSTICAS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Hoy',        value: stats.today,    color: '#3b82f6' },
          { label: 'Próximos',   value: stats.upcoming, color: '#10b981' },
          { label: 'Total',      value: stats.total,    color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, minWidth: 90, background: 'var(--bg-secondary)',
            borderRadius: 14, padding: '10px 14px', borderLeft: `4px solid ${s.color}`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* FORMULARIO DE CREACIÓN */}
      {showForm && (
        <EventForm
          initial={{ ...EMPTY_FORM, date: selectedDate.toISOString().split('T')[0] }}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* FILTRO POR CATEGORÍA */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          onClick={() => setSelectedCategory('all')}
          style={{
            padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
            background: selectedCategory === 'all' ? 'var(--text-primary)' : 'var(--bg-secondary)',
            color:      selectedCategory === 'all' ? 'var(--bg-primary)' : 'var(--text-secondary)',
          }}
        >
          Todas
        </button>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
              background: selectedCategory === c.id ? c.color : `${c.color}20`,
              color:      selectedCategory === c.id ? 'white'  : c.color,
              fontWeight: selectedCategory === c.id ? 600 : 400,
            }}
          >
            {c.label} {selectedCategory !== c.id && events.filter(e => e.category === c.id).length > 0
              ? `(${events.filter(e => e.category === c.id).length})`
              : ''}
          </button>
        ))}
      </div>

      {/* NAVEGACIÓN */}
      <div className="agenda-controls">
        <div className="date-navigation">
          <button className="nav-arrow" onClick={() => view === 'month' ? changeMonth(-1) : view === 'week' ? changeDate(-7) : changeDate(-1)}>‹</button>
          <span className="current-date">
            {view === 'month' && selectedDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
            {view === 'week'  && `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${weekDays[6].toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}`}
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

      {/* VISTAS */}
      {view === 'day'   && renderDayView()}
      {view === 'week'  && renderWeekView()}
      {view === 'month' && renderMonthView()}

      <div className="bottom-padding" />
    </div>
  )
}

// ─── ESTILOS INLINE REUTILIZABLES ──────────────────────────────────────────────
const inputStyle = {
  padding: '10px 14px', borderRadius: 10,
  border: '0.5px solid var(--border)', background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)', fontSize: 13, flex: 1, minWidth: 120,
}

const btnPrimary = {
  padding: '10px 20px', borderRadius: 20, border: 'none',
  background: '#3b82f6', color: 'white', fontWeight: 600,
  fontSize: 14, cursor: 'pointer',
}

const btnSecondary = {
  padding: '10px 20px', borderRadius: 20,
  border: '0.5px solid var(--border)', background: 'transparent',
  color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
}

const btnDanger = {
  padding: '10px 20px', borderRadius: 20, border: 'none',
  background: 'rgba(239,68,68,0.1)', color: '#ef4444',
  fontSize: 14, cursor: 'pointer',
}
