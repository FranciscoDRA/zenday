import React, { useState, useEffect, useCallback } from 'react'
import { suscribirse, armarReporte } from '../../utils/reporteDeErrores'

/**
 * El cartel que aparece cuando algo se rompe sin que nadie lo atrape.
 *
 * Antes de esto, un error no manejado se escribía en un archivo de log y la
 * pantalla no mostraba nada. El usuario apretaba "Guardar" y no pasaba nada:
 * ni éxito, ni error, ni una pista. Once veces seguidas, en el caso que lo
 * destapó.
 *
 * Tres cosas que este cartel hace y que importan más que su aspecto:
 *
 *   · Dice que algo falló. Nada más que eso ya cambia todo: el usuario deja de
 *     apretar el botón y avisa.
 *   · Deja copiar el detalle de un click. Sin abrir consolas, sin buscar
 *     archivos, sin explicarle a nadie qué es DevTools.
 *   · No se pone pesado. El módulo filtra el ruido de red y silencia los
 *     repetidos 30 segundos. Si aparece, es porque vale la pena leerlo.
 *
 * Va montado UNA vez, arriba de todo, fuera de las pantallas: un error puede
 * pasar en cualquier lado, incluso mientras se navega.
 */
export function AvisoDeError({ copiar, version, userMode, plan }) {
  const [error, setError] = useState(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => suscribirse(setError), [])

  // Escape lo cierra, como cualquier otro modal de la app.
  useEffect(() => {
    if (!error) return
    const alApretar = (e) => { if (e.key === 'Escape') setError(null) }
    window.addEventListener('keydown', alApretar)
    return () => window.removeEventListener('keydown', alApretar)
  }, [error])

  const alCopiar = useCallback(async () => {
    const ok = await copiar?.(armarReporte({ version, userMode, plan }))
    setCopiado(ok !== false)
    setTimeout(() => setCopiado(false), 2500)
  }, [copiar, version, userMode, plan])

  if (!error) return null

  return (
    <div className="aviso-error" role="alert" aria-live="assertive">
      <span className="aviso-error-icono">⚠️</span>

      <div className="aviso-error-texto">
        <strong>Algo falló y no se completó</strong>
        {/* El mensaje técnico va chico y abajo: al usuario le importa que algo
            falló, no el TypeError. Pero tiene que estar, porque es lo que
            después se copia y se manda. */}
        <span className="aviso-error-detalle">{error.message}</span>
      </div>

      <button className="aviso-error-copiar" onClick={alCopiar}>
        {copiado ? '✓ Copiado' : '📋 Copiar detalle'}
      </button>

      <button
        className="aviso-error-cerrar"
        onClick={() => setError(null)}
        aria-label="Cerrar el aviso"
      >
        ✕
      </button>
    </div>
  )
}

export default AvisoDeError
