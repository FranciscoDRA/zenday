import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  registrarError, esRuidoConocido, ultimosErrores, limpiar,
  armarReporte, suscribirse, MAX_GUARDADOS, SILENCIO_MS,
} from '../src/utils/reporteDeErrores.js'

/**
 * Que los errores se VEAN.
 *
 * De los seis problemas que aparecieron auditando ZenDay, seis no le avisaron
 * nada al usuario. El peor:
 *
 *     TypeError: ge.phone.trim is not a function
 *
 * Reventaba adentro del guardado de un cliente. Subía por una promesa sin
 * catch, así que la pantalla no mostraba nada: se apretaba "Guardar" y no
 * pasaba nada. Once veces seguidas.
 *
 * Y el error SÍ se registraba: main.jsx ya lo mandaba a zenday-errors.log. La
 * información existía, en un archivo, en la misma computadora. Nadie se la
 * mostró a nadie.
 *
 * El riesgo del arreglo es el opuesto: un cartel que aparece por cualquier cosa
 * se vuelve invisible en dos días. Por eso la mitad de estos tests son sobre
 * CUÁNDO NO hay que molestar.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8')

beforeEach(() => limpiar())

describe('avisa cuando algo se rompe de verdad', () => {
  it('un TypeError se guarda y amerita aviso', () => {
    const r = registrarError({ scope: 'promesa sin catch', message: 'x.phone.trim is not a function' })
    expect(r.guardado).toBe(true)
    expect(r.avisar).toBe(true)
    expect(ultimosErrores()).toHaveLength(1)
  })

  it('el que se suscribe recibe el error', () => {
    const vistos = []
    const baja = suscribirse(e => vistos.push(e))
    registrarError({ message: 'algo se rompio' })
    baja()
    expect(vistos).toHaveLength(1)
    expect(vistos[0].message).toBe('algo se rompio')
  })

  it('un oyente que falla no rompe el registro', () => {
    // Si el cartel tiene un bug, el error igual tiene que quedar guardado —
    // si no, perdemos justo el dato que hace falta para arreglar el cartel.
    suscribirse(() => { throw new Error('oyente roto') })
    expect(() => registrarError({ message: 'importante' })).not.toThrow()
    expect(ultimosErrores()).toHaveLength(1)
  })
})

describe('NO molesta con lo que no es un problema', () => {
  it('los fallos de red del polling son ruido', () => {
    // El polling de las tiendas corre cada 30 segundos. Sin internet falla y se
    // reintenta solo. Un cartel cada medio minuto y en dos días el usuario deja
    // de leerlos — que es exactamente lo que hay que evitar.
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch',
                     'The operation was aborted', 'AbortError', 'Load failed',
                     'net::ERR_INTERNET_DISCONNECTED']) {
      expect(esRuidoConocido(m), m).toBe(true)
      expect(registrarError({ message: m }).avisar, m).toBe(false)
    }
    expect(ultimosErrores()).toHaveLength(0)
  })

  it('el ruido conocido de Chrome tampoco', () => {
    expect(esRuidoConocido('ResizeObserver loop completed with undelivered notifications')).toBe(true)
  })

  it('un error sin mensaje no sirve para nada', () => {
    expect(registrarError({ message: '' }).guardado).toBe(false)
    expect(registrarError({}).guardado).toBe(false)
  })

  it('un TypeError de verdad NO es ruido', () => {
    expect(esRuidoConocido('x.phone.trim is not a function')).toBe(false)
    expect(esRuidoConocido('Cannot read properties of undefined')).toBe(false)
  })
})

describe('un bucle que falla mil veces deja UN cartel', () => {
  it('el mismo error no vuelve a avisar dentro de la ventana de silencio', () => {
    const t = 1_000_000
    expect(registrarError({ message: 'mismo error', ahora: t }).avisar).toBe(true)
    expect(registrarError({ message: 'mismo error', ahora: t + 1000 }).avisar).toBe(false)
    expect(registrarError({ message: 'mismo error', ahora: t + SILENCIO_MS - 1 }).avisar).toBe(false)
  })

  it('pasada la ventana, vuelve a avisar', () => {
    const t = 1_000_000
    registrarError({ message: 'mismo error', ahora: t })
    expect(registrarError({ message: 'mismo error', ahora: t + SILENCIO_MS + 1 }).avisar).toBe(true)
  })

  it('pero SIEMPRE los guarda todos, aunque no avise', () => {
    // El aviso se silencia; el registro no. El reporte tiene que mostrar que
    // el error paso veinte veces, porque eso es informacion.
    const t = 1_000_000
    for (let i = 0; i < 5; i++) registrarError({ message: 'repetido', ahora: t + i })
    expect(ultimosErrores()).toHaveLength(5)
  })

  it('dos errores distintos avisan los dos', () => {
    const t = 1_000_000
    expect(registrarError({ message: 'uno', ahora: t }).avisar).toBe(true)
    expect(registrarError({ message: 'otro', ahora: t + 1 }).avisar).toBe(true)
  })
})

describe('no crece para siempre', () => {
  it(`guarda como mucho ${MAX_GUARDADOS} y tira los mas viejos`, () => {
    for (let i = 0; i < MAX_GUARDADOS + 15; i++) registrarError({ message: `error ${i}` })
    const guardados = ultimosErrores()
    expect(guardados).toHaveLength(MAX_GUARDADOS)
    // Se quedan los ULTIMOS, que son los que sirven para entender que paso.
    expect(guardados.at(-1).message).toBe(`error ${MAX_GUARDADOS + 14}`)
  })

  it('el stack se recorta, no se manda entero', () => {
    const stackLargo = Array.from({ length: 60 }, (_, i) => `  at funcion${i} (archivo.js:${i}:1)`).join('\n')
    registrarError({ message: 'con stack', stack: stackLargo })
    expect(ultimosErrores()[0].stack.split('\n').length).toBeLessThanOrEqual(12)
  })
})

describe('el reporte que se copia y se manda', () => {
  it('dice version, modo y licencia', () => {
    registrarError({ scope: 'promesa sin catch', message: 'x.phone.trim is not a function' })
    const r = armarReporte({ version: '1.0.9', userMode: 'professional', plan: 'trial' })
    expect(r).toContain('1.0.9')
    expect(r).toContain('professional')
    expect(r).toContain('trial')
    expect(r).toContain('x.phone.trim is not a function')
  })

  it('el mas nuevo va primero', () => {
    // Cuando algo se rompe, el ultimo error es casi siempre el que importa.
    registrarError({ message: 'el viejo' })
    registrarError({ message: 'el nuevo' })
    const r = armarReporte({})
    expect(r.indexOf('el nuevo')).toBeLessThan(r.indexOf('el viejo'))
  })

  it('sin errores, igual da un texto util', () => {
    // Alguien puede reportar algo que no tiro excepcion: un numero mal, un
    // boton que no hace nada. El reporte tiene que servir igual.
    const r = armarReporte({ version: '1.0.9' })
    expect(r).toContain('No se registro ningun error')
    expect(r).toContain('conta que estabas haciendo')
    expect(r).toContain('1.0.9')
  })

  it('aguanta que no le pasen nada', () => {
    expect(() => armarReporte()).not.toThrow()
    expect(armarReporte()).toContain('desconocida')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Cableado
// ─────────────────────────────────────────────────────────────────────────────
describe('está enchufado', () => {
  const main = leer('src', 'main.jsx')
  const app  = leer('src', 'App.jsx')
  const conf = leer('src', 'components', 'screens', 'SettingsScreen.jsx')
  const css  = leer('src', 'App.css')

  it('los dos handlers globales pasan por registrarError', () => {
    expect(main).toMatch(/import \{ registrarError \}/)
    expect(main).toMatch(/window\.addEventListener\('error'/)
    expect(main).toMatch(/window\.addEventListener\('unhandledrejection'/)
    expect(main).toMatch(/registrarError\(\{ scope, message, stack \}\)/)
  })

  it('sigue escribiendo el log en disco, además del cartel', () => {
    // El cartel se cierra; el archivo queda. Los dos hacen falta.
    expect(main).toMatch(/electronAPI\?\.logError\?\.\(/)
  })

  it('el cartel está montado una sola vez, fuera de las pantallas', () => {
    expect(app).toMatch(/<AvisoDeError/)
    expect((app.match(/<AvisoDeError/g) || [])).toHaveLength(1)
  })

  it('el reporte recibe la versión del .exe', () => {
    // Es el primer dato que hace falta cuando alguien dice "no anda".
    expect(app).toMatch(/getAppVersion\?\.\(\)/)
    expect(app).toMatch(/version=\{appVersion\}/)
  })

  it('Configuración tiene el botón de reportar', () => {
    expect(conf).toMatch(/import \{ armarReporte, ultimosErrores \}/)
    expect(conf).toMatch(/Reportar problema/)
    expect(conf).toMatch(/copiarAlPortapapeles\(texto\)/)
  })

  it('el cartel queda por encima de los toasts', () => {
    // Si un error dispara además un toast, el que hay que ver es el cartel,
    // que es el único que se puede copiar.
    expect(css).toMatch(/z-index: calc\(var\(--z-toast\) \+ 10\)/)
  })

  it('el copiar vive en un solo lugar', () => {
    // Estaba duplicado en SettingsScreen. Dos copias de esto se desincronizan.
    expect(leer('src', 'utils', 'helpers.js')).toMatch(/export async function copiarAlPortapapeles/)
    expect(conf).not.toMatch(/const safeCopyToClipboard/)
  })
})
