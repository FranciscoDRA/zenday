import React, { useState } from 'react'
import { todayKey } from '../../utils/helpers'
import { MEDIOS_DE_PAGO, MEDIO_POR_DEFECTO, CLAVE_ULTIMO_MEDIO } from '../../utils/mediosDePago'

/**
 * Los dos que la usan le pasan `defaultDate` y `title`, y la funcion no los
 * recibia: se perdian en silencio. Consecuencia concreta: "Editar fecha de
 * pago" abria SIEMPRE con la fecha de hoy en vez de la que ya estaba guardada,
 * y el titulo decia "Registrar pago" aunque estuvieras editando. Si le dabas
 * Confirmar sin mirar, pisabas la fecha real del cobro con la de hoy.
 */
export function PaymentDateModal({ onConfirm, onCancel, defaultDate, title, defaultMethod }) {
  const [paymentDate, setPaymentDate] = useState(
    defaultDate || todayKey()
  )

  // Arranca en el ultimo medio que se uso. La mayoria de los locales cobra casi
  // siempre igual, asi que en la practica esto convierte el paso en un vistazo:
  // el medio correcto ya viene marcado y no hay que tocar nada.
  const [metodo, setMetodo] = useState(() => {
    if (defaultMethod) return defaultMethod
    try { return localStorage.getItem(CLAVE_ULTIMO_MEDIO) || MEDIO_POR_DEFECTO }
    catch { return MEDIO_POR_DEFECTO }
  })

  const confirmar = () => {
    try { localStorage.setItem(CLAVE_ULTIMO_MEDIO, metodo) } catch { /* no es critico */ }
    // Se manda como objeto pero el primer argumento sigue siendo la fecha para
    // quien todavia espere solo eso. Ver el comentario en onConfirm.
    onConfirm(paymentDate, metodo)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 16,
        padding: 24, minWidth: 300,
        border: '1px solid var(--border)'
      }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>💰 {title || 'Registrar pago'}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Elegí la fecha del pago — puede ser pasada o futura
        </p>
        <input
          type="date"
          value={paymentDate}
          onChange={e => setPaymentDate(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px',
            borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            fontSize: 14, fontFamily: 'inherit', marginBottom: 16,
            boxSizing: 'border-box'
          }}
        />
        {/* El medio de pago. Sin esto la app sabia CUANTO cobraste y nunca COMO,
            y a la noche no habia forma de saber que tenia que haber en la caja. */}
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
          ¿Cómo te pagó?
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
          {MEDIOS_DE_PAGO.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetodo(m.id)}
              aria-pressed={metodo === m.id}
              style={{
                padding: '9px 6px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, lineHeight: 1.3,
                border: metodo === m.id ? '2px solid var(--accent-blue)' : '1px solid var(--border)',
                background: metodo === m.id ? 'rgba(99,102,241,0.10)' : 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontWeight: metodo === m.id ? 700 : 500,
              }}
            >
              <span style={{ display: 'block', fontSize: 16, marginBottom: 2 }}>{m.icono}</span>
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={confirmar}
            style={{
              flex: 1, padding: '10px', borderRadius: 10,
              background: 'var(--accent-green)', color: 'white',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 600
            }}
          >
            ✅ Confirmar
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px', borderRadius: 10,
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}