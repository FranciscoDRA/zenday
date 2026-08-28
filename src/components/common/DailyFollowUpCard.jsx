// src/components/common/DailyFollowUpCard.jsx
//
// "¿A quién le tengo que escribir hoy?" — junta en un solo lugar lo que el
// dueño de un negocio chico hoy tiene que ir a buscar a mano en tres
// pantallas distintas: clientes que dejaron de comprar, plata pendiente de
// cobro y cumpleaños. Cada ítem tiene un botón directo a WhatsApp: la idea
// es que abrir esto y mandar 2-3 mensajes sea una rutina de un minuto, no
// una tarea que se termina posponiendo.

import React, { useMemo } from 'react'
import { formatCurrency, parseLocalDate } from '../../utils/helpers'

const PAID_STATUSES     = new Set(['completed', 'delivered', 'picked'])
const INACTIVE_DAYS     = 60
const MAX_POR_SECCION   = 3

function formatPhoneForWhatsApp(phone) {
  if (!phone) return null
  let cleaned = String(phone).replace(/\D/g, '')
  if (cleaned.length === 8 && !cleaned.startsWith('598')) cleaned = '598' + cleaned
  if (cleaned.length === 9 && cleaned.startsWith('0'))    cleaned = '598' + cleaned.substring(1)
  return cleaned.length >= 10 ? cleaned : null
}

function abrirWhatsApp(phone, mensaje) {
  const numero = formatPhoneForWhatsApp(phone)
  if (!numero) return
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

function BotonWhatsApp({ phone, mensaje }) {
  if (!formatPhoneForWhatsApp(phone)) return null
  return (
    <button
      onClick={() => abrirWhatsApp(phone, mensaje)}
      title="Escribir por WhatsApp"
      style={{
        background: 'color-mix(in srgb, #25D366 15%, transparent)',
        border: 'none', borderRadius: '20px', padding: '6px 12px',
        color: '#25D366', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
      }}
    >
      💬 Escribir
    </button>
  )
}

function Fila({ nombre, motivo, phone, mensaje }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombre}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{motivo}</div>
      </div>
      <BotonWhatsApp phone={phone} mensaje={mensaje} />
    </div>
  )
}

function Seccion({ icono, titulo, items }) {
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {icono} {titulo}
      </div>
      {items}
    </div>
  )
}

export function DailyFollowUpCard({ appointments = [], patients = [] }) {
  const { inactivos, pendientes, cumples } = useMemo(() => {
    const hoy = new Date()

    // ── Clientes inactivos ──────────────────────────────────────────────
    const porCliente = new Map()
    appointments.forEach(a => {
      if (!a.patientName) return
      const key = a.patientId || a.patientName
      const actual = porCliente.get(key) || { name: a.patientName, phone: a.patientPhone || '', lastOrder: null }
      const cuando = new Date(a.startTime)
      if (!Number.isNaN(cuando.getTime()) && (!actual.lastOrder || cuando > actual.lastOrder)) {
        actual.lastOrder = cuando
        if (a.patientPhone) actual.phone = a.patientPhone
      }
      porCliente.set(key, actual)
    })
    const inactivos = [...porCliente.values()]
      .filter(c => c.lastOrder)
      .map(c => ({ ...c, dias: Math.floor((hoy - c.lastOrder) / 86_400_000) }))
      .filter(c => c.dias >= INACTIVE_DAYS)
      .sort((a, b) => b.dias - a.dias)
      .slice(0, MAX_POR_SECCION)

    // ── Pagos pendientes ─────────────────────────────────────────────────
    const pendientes = appointments
      .filter(a => !a.paid && PAID_STATUSES.has(a.status) && (a.price || 0) > 0)
      .sort((a, b) => (b.price || 0) - (a.price || 0))
      .slice(0, MAX_POR_SECCION)

    // ── Cumpleaños de hoy ────────────────────────────────────────────────
    const cumples = patients.filter(p => {
      if (!p.birthDate) return false
      const d = parseLocalDate(p.birthDate)
      return d && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate()
    }).slice(0, MAX_POR_SECCION)

    return { inactivos, pendientes, cumples }
  }, [appointments, patients])

  const hayAlgo = inactivos.length > 0 || pendientes.length > 0 || cumples.length > 0

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: '16px', padding: '18px 20px',
      marginBottom: '20px', border: '1px solid var(--border)',
    }}>
      <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '12px' }}>
        📋 ¿A quién le tengo que escribir hoy?
      </div>

      {!hayAlgo ? (
        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: 0 }}>
          Nada pendiente por hoy — todos tus clientes activos, sin cobros atrasados. ✅
        </p>
      ) : (
        <>
          <Seccion
            icono="😴" titulo={`Sin comprar hace ${INACTIVE_DAYS}+ días`}
            items={inactivos.map(c => (
              <Fila
                key={c.name}
                nombre={c.name}
                motivo={`${c.dias} días sin comprar`}
                phone={c.phone}
                mensaje={`Hola ${c.name.split(' ')[0]}! Hace un tiempo que no te vemos, ¿todo bien? Cualquier cosa que necesites, acá estamos.`}
              />
            ))}
          />
          <Seccion
            icono="💰" titulo="Cobros pendientes"
            items={pendientes.map(a => (
              <Fila
                key={a.id}
                nombre={a.patientName}
                motivo={formatCurrency(a.price, 'UYU')}
                phone={a.patientPhone}
                mensaje={`Hola ${(a.patientName || '').split(' ')[0]}! Te escribo por el pago de ${formatCurrency(a.price, 'UYU')} que quedó pendiente.`}
              />
            ))}
          />
          <Seccion
            icono="🎂" titulo="Cumplen hoy"
            items={cumples.map(p => (
              <Fila
                key={p.id}
                nombre={p.name}
                motivo="Cumpleaños"
                phone={p.phone}
                mensaje={`¡Feliz cumpleaños, ${(p.name || '').split(' ')[0]}! 🎉`}
              />
            ))}
          />
        </>
      )}
    </div>
  )
}

export default DailyFollowUpCard
