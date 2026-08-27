import React, { useState, useMemo } from 'react'
import { normalizarNotas, toLocalDateKey, parseLocalDate } from '../../utils/helpers'

// ─── HELPERS ────────────────────────────────────────────────────────────────

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

function formatDate(dateStr) {
  if (!dateStr) return ''
  // Las citas llegan acá como 'YYYY-MM-DD' (vía toLocalDateKey, más abajo).
  // `new Date('YYYY-MM-DD')` la interpreta como medianoche UTC: en UTC-3 eso
  // muestra el día anterior. parseLocalDate arma la fecha en hora local.
  // Las notas sí traen datetime completo (new Date().toISOString()), donde
  // new Date(...) es correcto porque representa un instante, no un día.
  const d = SOLO_FECHA.test(dateStr) ? parseLocalDate(dateStr) : new Date(dateStr)
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(amount) {
  if (!amount && amount !== 0) return '$0'
  return '$' + Number(amount).toLocaleString('es-UY')
}

// ─── CONFIGURACIÓN DE TIPOS ───────────────────────────────────────────────────

const EVENT_CONFIG = {
  appointment: {
    label: 'Cita',
    dotColor: 'var(--accent-blue)',
    badgeBg: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)',
    badgeColor: 'var(--accent-blue)',
    icon: '📅',
  },
  payment: {
    label: 'Pago recibido',
    dotColor: 'var(--accent-green)',
    badgeBg: 'color-mix(in srgb, var(--accent-green) 10%, transparent)',
    badgeColor: 'var(--accent-green)',
    icon: '💰',
  },
  note: {
    label: 'Nota',
    dotColor: 'var(--accent-amber)',
    badgeBg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
    badgeColor: 'var(--accent-amber)',
    icon: '📝',
  },
  pending: {
    label: 'Pago pendiente',
    dotColor: 'var(--accent-red)',
    badgeBg: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
    badgeColor: 'var(--accent-red)',
    icon: '⚠️',
  },
}

const STATUS_LABELS = {
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  completed: 'Completada',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
  pending: 'Pendiente',
  'in-progress': 'En curso',
}

const TYPE_LABELS = {
  meeting: 'Reunión',
  consultation: 'Consulta',
  followup: 'Seguimiento',
  appointment: 'Cita',
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, danger, accent }) {
  return (
    <div style={{
      flex: 1,
      background: 'var(--bg-secondary)',
      border: '0.5px solid var(--border-strong)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '14px' }}>{icon}</span>
        {label}
      </div>
      <div style={{
        fontSize: '22px',
        fontWeight: 700,
        color: danger ? 'var(--accent-red)' : accent ? 'var(--accent-green)' : 'var(--text-primary)',
        letterSpacing: '-0.02em',
      }}>
        {value}
      </div>
    </div>
  )
}

// ─── FILTRO CHIP ──────────────────────────────────────────────────────────────

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '13px',
        padding: '6px 14px',
        borderRadius: 'var(--radius-full)',
        border: active ? '1.5px solid var(--accent-blue)' : '0.5px solid var(--border-strong)',
        background: active ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)',
        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
        transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          fontSize: '11px',
          background: active ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
          color: active ? '#fff' : 'var(--text-secondary)',
          borderRadius: '10px',
          padding: '1px 6px',
          fontWeight: 600,
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─── EVENTO CARD ──────────────────────────────────────────────────────────────

function EventCard({ event, isLast, onNavigate }) {
  const [hovered, setHovered] = useState(false)
  const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.note
  const isClickable = (event.type === 'appointment' || event.type === 'pending') && onNavigate && event.appointmentId

  return (
    <div style={{ display: 'flex', gap: '14px', alignItems: 'stretch' }}>

      {/* Spine */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '16px', flexShrink: 0, paddingTop: '16px' }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: cfg.dotColor, flexShrink: 0,
          boxShadow: `0 0 0 3px ${cfg.badgeBg}`,
        }} />
        {!isLast && (
          <div style={{ flex: 1, width: '1.5px', background: 'var(--border-strong)', marginTop: '6px', minHeight: '20px' }} />
        )}
      </div>

      {/* Card */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => isClickable && onNavigate('detail', { appointmentId: event.appointmentId })}
        style={{
          flex: 1,
          background: hovered && isClickable ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
          border: `0.5px solid ${hovered && isClickable ? 'var(--accent-blue)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          marginBottom: isLast ? '0' : '8px',
          cursor: isClickable ? 'pointer' : 'default',
          transition: 'all 0.15s',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>{cfg.icon}</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {event.title}
            </span>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {formatDate(event.date)}
            </div>
            {event.time && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>
                {event.time}
              </div>
            )}
          </div>
        </div>

        {/* Descripción */}
        {event.desc && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.5, paddingLeft: '23px' }}>
            {event.desc}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '23px', flexWrap: 'wrap', gap: '6px' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: cfg.badgeBg,
            color: cfg.badgeColor,
            letterSpacing: '0.01em',
          }}>
            {cfg.label}
          </span>

          {event.status && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              {STATUS_LABELS[event.status] || event.status}
            </span>
          )}

          {event.amount != null && event.amount > 0 && (
            <span style={{
              fontSize: '14px',
              fontWeight: 700,
              color: event.type === 'payment' ? 'var(--accent-green)' : event.type === 'pending' ? 'var(--accent-red)' : 'var(--text-primary)',
              marginLeft: 'auto',
            }}>
              {event.type === 'payment' ? '+' : ''}{formatCurrency(event.amount)}
            </span>
          )}
        </div>

        {isClickable && hovered && (
          <div style={{ fontSize: '11px', color: 'var(--accent-blue)', paddingLeft: '23px', marginTop: '6px' }}>
            Ver detalle →
          </div>
        )}
      </div>
    </div>
  )
}

// ─── FORMULARIO DE NOTA ───────────────────────────────────────────────────────

function NoteForm({ onSave, onCancel }) {
  const [text, setText] = useState('')

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '0.5px solid var(--accent-amber)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px',
      marginBottom: '8px',
    }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
        📝 Nueva nota
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="Escribí una nota sobre este cliente..."
        autoFocus
        style={{
          width: '100%',
          resize: 'none',
          border: '0.5px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
          fontSize: '13px',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          lineHeight: 1.6,
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
        <button onClick={onCancel} className="btn-secondary" style={{ fontSize: '13px' }}>
          Cancelar
        </button>
        <button
          onClick={() => { if (text.trim()) onSave(text.trim()) }}
          className="btn-primary"
          disabled={!text.trim()}
          style={{ fontSize: '13px' }}
        >
          Guardar nota
        </button>
      </div>
    </div>
  )
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyState({ filter }) {
  const messages = {
    all:         { icon: '📋', title: 'Sin actividad aún',  sub: 'Las citas, pagos y notas de este cliente aparecerán acá.' },
    appointment: { icon: '📅', title: 'Sin citas',          sub: 'No hay citas registradas para este cliente.' },
    payment:     { icon: '💰', title: 'Sin pagos',          sub: 'No se han registrado pagos todavía.' },
    note:        { icon: '📝', title: 'Sin notas',          sub: 'Podés agregar notas usando el botón de abajo.' },
    pending:     { icon: '✅', title: 'Sin pendientes',     sub: 'No hay pagos pendientes. ¡Todo al día!' },
  }
  const m = messages[filter] || messages.all

  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.5 }}>{m.icon}</div>
      <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{m.title}</div>
      <div style={{ fontSize: '13px' }}>{m.sub}</div>
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

// `onAddNote` es obligatorio en la práctica: sin él las notas se escribían en
// un useState del componente y no se guardaban en NINGÚN lado. El psicólogo
// escribía la evolución de la sesión, la veía aparecer en la línea de tiempo,
// y desaparecía al volver a entrar — o antes incluso, porque PatientDetailScreen
// remonta esto con cada snapshot de Firestore.
//
// Lo confuso era que la misma pantalla tiene otro "agregar nota" (la pestaña
// Notas) que sí persiste vía updatePatient. Dos botones casi iguales y uno
// tiraba lo escrito.
export function PatientTimeline({ patient, appointments = [], onNavigate, onAddNote }) {
  const [filter, setFilter] = useState('all')
  const [showNoteForm, setShowNoteForm] = useState(false)

  const patientAppointments = useMemo(() => {
    if (!patient) return []
    return appointments.filter(a =>
      (patient.id && a.patientId === patient.id) ||
      (patient.name && a.patientName === patient.name)
    )
  }, [appointments, patient])

  const events = useMemo(() => {
    const list = []

    patientAppointments.forEach(a => {
      // En UTC, una cita de la noche caia agrupada en el dia siguiente.
      const date = a.startTime ? toLocalDateKey(a.startTime) : null
      const time = a.startTime ? formatTime(a.startTime) : null
      const uid = a.id || a.recurrenceGroupId || a.startTime
      const appointmentTitle = a.title || (a.type && TYPE_LABELS[a.type]) || a.service || 'Cita'

      list.push({
        id: `appt-${uid}-${date}`,
        appointmentId: a.id,
        type: 'appointment',
        date, time,
        title: appointmentTitle,
        desc: a.notes || null,
        amount: a.price || null,
        status: a.status,
        _ts: new Date(a.startTime).getTime(),
      })

      if (a.paid) {
        list.push({
          id: `pay-${uid}-${date}`,
          appointmentId: a.id,
          type: 'payment',
          date, time,
          title: 'Pago recibido',
          desc: a.paymentMethod ? `Método: ${a.paymentMethod}` : null,
          amount: a.price || null,
          _ts: new Date(a.startTime).getTime() + 1,
        })
      }

      if (!a.paid && (a.status === 'completed' || a.status === 'delivered')) {
        list.push({
          id: `pend-${uid}-${date}`,
          appointmentId: a.id,
          type: 'pending',
          date, time,
          title: 'Pago pendiente',
          desc: appointmentTitle,
          amount: a.price || null,
          _ts: new Date(a.startTime).getTime() + 2,
        })
      }
    })

    // Se leen de patient.notes — las mismas que muestra la pestaña Notas — en
    // vez de un estado local que se vaciaba en cada remount.
    // normalizarNotas por lo mismo que en PatientDetailScreen: los clientes
    // creados por un pedido web tenían `notes` como string, y esto lo
    // desarmaba en una "nota" por carácter.
    normalizarNotas(patient?.notes).forEach((n, i) => {
      const ts = new Date(n.date ?? 0).getTime()
      list.push({
        id: n.id ?? `nota-${i}`,
        type: 'note',
        date: n.date,
        title: 'Nota',
        desc: n.content ?? n.text ?? '',
        amount: null,
        _ts: Number.isNaN(ts) ? 0 : ts,
      })
    })

    return list.sort((a, b) => b._ts - a._ts)
  }, [patientAppointments, patient?.notes])

  const stats = useMemo(() => {
    const totalCitas = patientAppointments.length
    const totalPagado = patientAppointments
      .filter(a => a.paid)
      .reduce((s, a) => s + (Number(a.price) || 0), 0)
    const totalPendiente = patientAppointments
      .filter(a => !a.paid && (a.status === 'completed' || a.status === 'delivered'))
      .reduce((s, a) => s + (Number(a.price) || 0), 0)
    return { totalCitas, totalPagado, totalPendiente }
  }, [patientAppointments])

  const counts = useMemo(() => ({
    appointment: events.filter(e => e.type === 'appointment').length,
    payment:     events.filter(e => e.type === 'payment').length,
    note:        events.filter(e => e.type === 'note').length,
    pending:     events.filter(e => e.type === 'pending').length,
  }), [events])

  const filtered = useMemo(() =>
    filter === 'all' ? events : events.filter(e => e.type === filter)
  , [events, filter])

  function handleSaveNote(text) {
    if (!text?.trim()) return
    onAddNote?.(text.trim())     // persiste vía updatePatient, igual que la pestaña Notas
    setShowNoteForm(false)
  }

  if (!patient) return null

  const FILTERS = [
    { key: 'all',         label: 'Todo' },
    { key: 'appointment', label: 'Citas' },
    { key: 'payment',     label: 'Pagos' },
    { key: 'note',        label: 'Notas' },
    { key: 'pending',     label: 'Pendientes' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '24px' }}>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <StatCard icon="📅" label="Citas totales"    value={stats.totalCitas} />
        <StatCard icon="💰" label="Total facturado"  value={formatCurrency(stats.totalPagado)} accent />
        <StatCard icon="⏳" label="Saldo pendiente"  value={formatCurrency(stats.totalPendiente)} danger={stats.totalPendiente > 0} />
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <FilterChip
            key={f.key}
            label={f.label}
            count={f.key !== 'all' ? counts[f.key] : 0}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
          />
        ))}
      </div>

      {/* Formulario de nota */}
      {showNoteForm && (
        <NoteForm onSave={handleSaveNote} onCancel={() => setShowNoteForm(false)} />
      )}

      {/* Timeline */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {filtered.map((ev, i) => (
            <EventCard
              key={ev.id}
              event={ev}
              isLast={i === filtered.length - 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      {/* Agregar nota */}
      {!showNoteForm && (
        <button
          onClick={() => setShowNoteForm(true)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-amber)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          style={{
            alignSelf: 'flex-start',
            fontSize: '13px',
            padding: '8px 16px',
            borderRadius: 'var(--radius-full)',
            border: '0.5px dashed var(--border-strong)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          📝 Agregar nota
        </button>
      )}
    </div>
  )
}

export default PatientTimeline
