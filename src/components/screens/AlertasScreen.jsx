// src/components/screens/AlertasScreen.jsx
//
// ─────────────────────────────────────────────────────────────────────────────
//  LA UNICA PANTALLA QUE HABLA PRIMERO
//
//  Las otras 24 son un espejo: muestran lo que el usuario escribio. Esta mira
//  lo que ya esta guardado y saca una conclusion que nadie le pidio.
//
//  Por eso tiene una obligacion que las demas no tienen: MOSTRAR EL PORQUE. En
//  cada tarjeta va el ritmo, la cantidad de visitas y los dias — no para
//  decorar, sino para que el usuario pueda verificar la afirmacion en dos
//  segundos. Una alerta que no se puede verificar se ignora a la tercera vez, y
//  a partir de ahi la pantalla es peso muerto.
//
//  Las cuentas estan todas en utils/alertas.js, sin React, para poder probarlas.
//  Aca no hay ninguna regla de negocio: solo se dibuja.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react'
import { BackButton } from '../common/BackButton'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency, texto } from '../../utils/helpers'
import { armarAlertas, describirAtraso } from '../../utils/alertas'

/** Mismo criterio que Agenda: 8 digitos uruguayos -> 598XXXXXXXX. */
const telefonoWhatsApp = (phone) => {
  let limpio = texto(phone).replace(/\D/g, '')
  if (limpio.length === 8 && !limpio.startsWith('598')) limpio = '598' + limpio
  if (limpio.length === 9 && limpio.startsWith('0'))    limpio = '598' + limpio.substring(1)
  return limpio.length >= 10 ? limpio : null
}

/**
 * Abre WhatsApp con el mensaje escrito pero SIN enviarlo: el envio lo hace la
 * persona, en WhatsApp. La app no manda nada a nombre de nadie.
 */
const abrirWhatsApp = (phone, mensaje) => {
  const numero = telefonoWhatsApp(phone)
  if (!numero) return
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const soloNombre = (nombre) => texto(nombre).split(/\s+/)[0] || ''

const fechaCorta = (v) => {
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AlertasScreen({ patients = [], appointments = [], nav }) {
  const focusRef = useScreenFocus()

  // `new Date()` se calcula una sola vez por render y entra por parametro: toda
  // la logica de abajo es pura y se prueba sin tocar el reloj.
  const alertas = useMemo(
    () => armarAlertas(patients, appointments, { hoy: new Date() }),
    [patients, appointments]
  )

  const { seVan, faltan, plata, total } = alertas

  const agendar = (cliente) => {
    nav?.navigate('new', {
      prellenado: {
        patientId:   cliente.id,
        patientName: cliente.name,
        faltantes:   ['fecha'],
      },
    })
  }

  // ── Sin nada que avisar ───────────────────────────────────────────────────
  //
  // Se distinguen dos vacios distintos a proposito. "No hay alertas" con un
  // negocio recien empezado es una mentira tranquilizadora: no es que este todo
  // bien, es que todavia no hay con que comparar. Decirlo evita que el usuario
  // confie en un silencio que no significa nada.
  if (total === 0) {
    const conHistorial = patients.filter(p =>
      appointments.filter(a =>
        (p.id != null && String(a?.patientId) === String(p.id)) ||
        (p.name && a?.patientName === p.name)
      ).length >= 3
    ).length

    return (
      <div className="screen-container" ref={focusRef} tabIndex={-1}>
        <BackButton />
        <div className="screen-header">
          <h2>🔔 Alertas</h2>
        </div>

        <div className="alertas-vacio">
          {conHistorial === 0 ? (
            <>
              <span className="alertas-vacio-icono">🌱</span>
              <h3>Todavía no hay con qué comparar</h3>
              <p>
                Para saber si un cliente se está yendo hay que conocer cada cuánto venía,
                y eso recién se puede afirmar a partir de la tercera visita.
              </p>
              <p className="alertas-vacio-nota">
                Ningún cliente llegó a tres visitas registradas. A medida que uses la agenda,
                esta pantalla se va a llenar sola.
              </p>
            </>
          ) : (
            <>
              <span className="alertas-vacio-icono">✅</span>
              <h3>No hay nada que mirar hoy</h3>
              <p>
                Ninguno de tus {conHistorial} clientes con historial se salió de su ritmo,
                y nadie está faltando seguido.
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="screen-container" ref={focusRef} tabIndex={-1}>
      <BackButton />

      <div className="screen-header">
        <h2>🔔 Alertas</h2>
        <span className="item-count">{total === 1 ? '1 aviso' : `${total} avisos`}</span>
      </div>

      {/* El numero grande es plata, no una cantidad de items: es lo que hace que
          alguien abra esta pantalla dos veces. */}
      {plata.total > 0 && (
        <div className="alertas-resumen">
          <span className="alertas-resumen-label">Plata que se está yendo sin que nadie avise</span>
          <span className="alertas-resumen-monto">{formatCurrency(plata.total, 'UYU')}</span>
          <span className="alertas-resumen-detalle">
            {plata.seVan > 0 && `${formatCurrency(plata.seVan, 'UYU')} en clientes que dejaron de venir`}
            {plata.seVan > 0 && plata.faltan > 0 && ' · '}
            {plata.faltan > 0 && `${formatCurrency(plata.faltan, 'UYU')} en horas que quedaron vacías`}
          </span>
        </div>
      )}

      {/* ── LOS QUE SE ESTAN YENDO ──────────────────────────────────────── */}
      {seVan.length > 0 && (
        <section className="alertas-seccion">
          <h3 className="alertas-seccion-titulo">
            👋 Dejaron de venir
            <span className="alertas-seccion-cant">{seVan.length}</span>
          </h3>
          <p className="alertas-seccion-ayuda">
            Comparados contra su propio ritmo, no contra un plazo fijo. Los que tienen
            turno agendado no aparecen acá.
          </p>

          <div className="alertas-lista">
            {seVan.map(item => (
              <article key={item.cliente.id} className={`alertas-tarjeta nivel-${item.nivel}`}>
                <div className="alertas-tarjeta-cabecera">
                  <div>
                    <h4 className="alertas-tarjeta-nombre">{item.cliente.name}</h4>
                    {/* El porque, para que la afirmacion se pueda verificar. */}
                    <p className="alertas-tarjeta-porque">{describirAtraso(item)}</p>
                  </div>
                  <span className={`alertas-chip nivel-${item.nivel}`}>
                    {item.nivel === 'perdido' ? 'Se fue' : 'Se atrasa'}
                  </span>
                </div>

                <div className="alertas-tarjeta-datos">
                  <div className="alertas-dato">
                    <span className="alertas-dato-label">Última vez</span>
                    <strong>{fechaCorta(item.ultima)}</strong>
                  </div>
                  <div className="alertas-dato">
                    <span className="alertas-dato-label">Turnos salteados</span>
                    <strong>{item.turnosSalteados}</strong>
                  </div>
                  {item.plata > 0 && (
                    <div className="alertas-dato es-plata">
                      <span className="alertas-dato-label">Sin facturar</span>
                      <strong>{formatCurrency(item.plata, 'UYU')}</strong>
                    </div>
                  )}
                </div>

                <div className="alertas-tarjeta-acciones">
                  {telefonoWhatsApp(item.cliente.phone) && (
                    <button
                      className="alertas-btn es-whatsapp"
                      onClick={() => abrirWhatsApp(
                        item.cliente.phone,
                        `Hola ${soloNombre(item.cliente.name)}! ¿Cómo andás? Hace un tiempo que no te vemos. ¿Querés que te reserve un lugar?`
                      )}
                    >
                      💬 Escribirle
                    </button>
                  )}
                  <button className="alertas-btn" onClick={() => agendar(item.cliente)}>
                    📅 Agendarle
                  </button>
                  <button
                    className="alertas-btn es-suave"
                    onClick={() => nav?.navigate('patientDetail', { patientId: item.cliente.id })}
                  >
                    Ver historial
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── LOS QUE FALTAN SIN AVISAR ───────────────────────────────────── */}
      {faltan.length > 0 && (
        <section className="alertas-seccion">
          <h3 className="alertas-seccion-titulo">
            🚫 Faltan sin avisar
            <span className="alertas-seccion-cant">{faltan.length}</span>
          </h3>
          <p className="alertas-seccion-ayuda">
            El estado "No asistió" ya existía y nunca se contaba en ningún lado.
            Cancelar con aviso no cuenta como falta.
          </p>

          <div className="alertas-lista">
            {faltan.map(item => (
              <article key={item.cliente.id} className="alertas-tarjeta nivel-falta">
                <div className="alertas-tarjeta-cabecera">
                  <div>
                    <h4 className="alertas-tarjeta-nombre">{item.cliente.name}</h4>
                    <p className="alertas-tarjeta-porque">
                      Faltó {item.faltas} de {item.esperadas} veces que lo esperabas
                      {' '}({Math.round(item.tasa * 100)}%)
                    </p>
                  </div>
                  <span className="alertas-chip nivel-falta">
                    {Math.round(item.tasa * 100)}%
                  </span>
                </div>

                <div className="alertas-tarjeta-datos">
                  <div className="alertas-dato">
                    <span className="alertas-dato-label">Última falta</span>
                    <strong>{item.ultimaFalta ? fechaCorta(item.ultimaFalta) : '—'}</strong>
                  </div>
                  {item.plata > 0 && (
                    <div className="alertas-dato es-plata">
                      <span className="alertas-dato-label">Horas vacías</span>
                      <strong>{formatCurrency(item.plata, 'UYU')}</strong>
                    </div>
                  )}
                </div>

                <div className="alertas-tarjeta-acciones">
                  {telefonoWhatsApp(item.cliente.phone) && (
                    <button
                      className="alertas-btn es-whatsapp"
                      onClick={() => abrirWhatsApp(
                        item.cliente.phone,
                        `Hola ${soloNombre(item.cliente.name)}! Te escribo para confirmar el próximo turno. ¿Te queda cómodo el horario?`
                      )}
                    >
                      💬 Confirmarle
                    </button>
                  )}
                  <button
                    className="alertas-btn es-suave"
                    onClick={() => nav?.navigate('patientDetail', { patientId: item.cliente.id })}
                  >
                    Ver historial
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Decir de donde salen los numeros. Una alerta cuyo criterio es opaco se
          discute; una cuyo criterio esta escrito se puede aceptar o descartar
          con fundamento, que es lo que hace que se siga usando. */}
      <p className="alertas-pie">
        Se avisa cuando alguien pasa una vez y media su propio ritmo sin aparecer, con
        al menos tres visitas registradas y nunca antes de dos semanas. Los clientes
        sin un ritmo claro no generan avisos.
      </p>
    </div>
  )
}

export default AlertasScreen
