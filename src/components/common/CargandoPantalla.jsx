import React from 'react'

/**
 * Lo que se ve mientras los datos todavía no llegaron.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EL PROBLEMA QUE RESUELVE
 *
 *  App.jsx tenía una bandera `loaded` que se apaga al arrancar y se prende
 *  cuando terminan de llegar los datos. Existía desde siempre... y NUNCA SALÍA
 *  DE App.jsx: no se pasaba a ninguna pantalla.
 *
 *  Consecuencia, cada vez que alguien abría ZenDay:
 *
 *      Ingresos del mes    $0
 *      Gastos del mes      $0
 *      Ganancia neta       $0
 *      ↓ 0% vs anterior
 *      No hay consultas para hoy
 *      No hay clientes registrados
 *
 *  ...y medio segundo después, todo eso se reemplazaba por los números reales.
 *
 *  O sea que el programa le decía al usuario, todas las mañanas, que su negocio
 *  no había facturado nada — y después se corregía. No es un bug que rompa algo:
 *  es peor. Es medio segundo de "¿qué pasó acá?" seguido de alivio, cada vez.
 *  Nadie sabe ponerle nombre a eso; se dice "le falta algo" o "se siente raro".
 *
 *  Un esqueleto en vez de ceros dice la verdad: "esto todavía no está listo".
 *  Y como conserva la forma de la pantalla, cuando llegan los datos no salta
 *  nada de lugar.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function CargandoPantalla() {
  return (
    <div className="cargando-pantalla" aria-busy="true" aria-live="polite">
      {/* Para quien usa lector de pantalla: el esqueleto no dice nada. */}
      <span className="sr-only">Cargando tus datos…</span>

      <div className="cargando-fila">
        <span className="cargando-bloque" style={{ width: '38%', height: 26 }} />
        <span className="cargando-bloque" style={{ width: 110, height: 34, borderRadius: 10 }} />
      </div>

      {/* Tres tarjetas: la misma forma que los KPI del Panel y de Finanzas. */}
      <div className="cargando-kpis">
        {[0, 1, 2].map(i => (
          <div key={i} className="cargando-kpi">
            <span className="cargando-bloque" style={{ width: '55%', height: 24 }} />
            <span className="cargando-bloque" style={{ width: '75%', height: 12 }} />
            <span className="cargando-bloque" style={{ width: '40%', height: 10 }} />
          </div>
        ))}
      </div>

      {/* Y una lista, que es la otra forma que tienen casi todas las pantallas. */}
      <div className="cargando-lista">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="cargando-item">
            <span className="cargando-bloque cargando-circulo" />
            <div className="cargando-item-texto">
              <span className="cargando-bloque" style={{ width: `${58 - i * 6}%`, height: 13 }} />
              <span className="cargando-bloque" style={{ width: `${38 - i * 4}%`, height: 10 }} />
            </div>
            <span className="cargando-bloque" style={{ width: 64, height: 16, borderRadius: 8 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default CargandoPantalla
