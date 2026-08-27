import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Notificaciones de Windows.
 *
 * EL BUG QUE ESTO EVITA
 * ─────────────────────
 * Windows 10/11 sólo muestra una notificación si viene de una app con
 * AppUserModelID, y si ese ID coincide con el de un acceso directo del menú
 * Inicio. El instalador NSIS crea el acceso directo con el `appId` de
 * package.json. Pero en tiempo de ejecución Electron usa otro ID, derivado de
 * la ruta del .exe, salvo que se llame a `app.setAppUserModelId`.
 *
 * Cuando no coinciden, Windows descarta el toast EN SILENCIO. No hay error, no
 * hay excepción, no hay nada en la consola. Y no se nota en desarrollo: pasa
 * sólo en la app instalada, que es justo donde ya no estás mirando la consola.
 *
 * Este test existe para que el día que alguien cambie el appId en package.json
 * —renombrar la app, cambiar de dominio— y se olvide de main.cjs, se entere
 * acá y no por un cliente diciendo "no me suena nada".
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8')

const main = leer('electron', 'main.cjs')
const pkg  = JSON.parse(leer('package.json'))

describe('Windows sabe quién le manda la notificación', () => {
  it('se declara el AppUserModelID', () => {
    expect(main).toMatch(/app\.setAppUserModelId\(/)
  })

  it('sólo en Windows, que es donde hace falta', () => {
    expect(main).toMatch(/process\.platform === 'win32'.*setAppUserModelId/)
  })

  it('el ID coincide EXACTAMENTE con el appId del instalador', () => {
    // Éste es el corazón del test. Dos textos iguales en dos archivos
    // distintos: la clase de cosa que se desincroniza sin que nadie lo note.
    const declarado = main.match(/setAppUserModelId\('([^']+)'\)/)
    expect(declarado, 'no encontré la llamada a setAppUserModelId').not.toBeNull()
    expect(declarado[1]).toBe(pkg.build.appId)
  })

  it('se declara antes de que se ABRA la ventana', () => {
    // Ojo con cómo se mide esto. `new BrowserWindow` aparece antes en el
    // archivo, pero está adentro de la función createWindow, que se DEFINE
    // arriba y se LLAMA abajo. Comparar posiciones de texto contra la
    // definición no dice nada sobre el orden de ejecución.
    //
    // Lo que importa es que, dentro de app.whenReady(), el ID se declare antes
    // de la LLAMADA a createWindow(). Si se declarara después, la primera
    // notificación de cada sesión se perdería.
    const arranque = main.slice(main.indexOf('app.whenReady()'))
    const idEn   = arranque.indexOf('setAppUserModelId')
    const abreEn = arranque.search(/^\s*createWindow\(\)/m)
    expect(idEn, 'setAppUserModelId no está dentro de app.whenReady()').toBeGreaterThan(-1)
    expect(abreEn, 'no encontré la llamada a createWindow()').toBeGreaterThan(-1)
    expect(idEn).toBeLessThan(abreEn)
  })
})

describe('el permiso de notificar está concedido', () => {
  it('"notifications" está en la lista de permisos permitidos', () => {
    // El handler de permisos deniega todo lo que no esté en esa lista. Si
    // alguien saca 'notifications' de ahí, la Web Notification API del
    // ReminderPanel deja de funcionar.
    const bloque = main.slice(main.indexOf('PERMISOS_PERMITIDOS'),
                              main.indexOf('setPermissionRequestHandler'))
    expect(bloque).toMatch(/'notifications'/)
  })
})

describe('el aviso llega por un camino que existe', () => {
  const panel = leer('src', 'components', 'common', 'ReminderPanel.jsx')

  it('el recordatorio usa la API que Electron traduce a toast nativo', () => {
    // `new Notification(...)` desde el renderer NO es una notificación web
    // dentro de la ventana: Electron la convierte en un toast de Windows.
    expect(panel).toMatch(/new Notification\(/)
  })

  it('pide permiso antes de intentar', () => {
    expect(panel).toMatch(/Notification\.requestPermission\(\)/)
    expect(panel).toMatch(/Notification\.permission/)
  })

  it('al hacer clic, la ventana vuelve al frente', () => {
    // Una notificación en la que hacés clic y no pasa nada es peor que ninguna.
    const bloque = panel.slice(panel.indexOf('const fireNotification'),
                               panel.indexOf('const fireNotification') + 1200)
    expect(bloque).toMatch(/focusWindow/)
  })
})

describe('el canal IPC de notificaciones no miente sobre su firma', () => {
  const preload = leer('electron', 'preload.cjs')

  it('preload y main se pasan (title, body) posicionales', () => {
    // Había un llamador que le pasaba UN OBJETO: showNotification({title, body}).
    // Con esta firma, `title` era el objeto entero y el toast salía diciendo
    // "[object Object]". Ese archivo era código muerto y se fue con la
    // limpieza, pero el contrato queda escrito acá para que no vuelva a pasar.
    expect(preload).toMatch(/showNotification:\s*\(title,\s*body\)/)
    expect(main).toMatch(/ipcMain\.handle\('show-notification',\s*\(_,\s*title,\s*body\)/)
  })

  it('nadie lo llama pasándole un objeto', () => {
    const src = path.join(RAIZ, 'src')
    const malos = []
    ;(function walk(dir) {
      if (!fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.jsx?$/.test(e.name)) continue
        const t = fs.readFileSync(p, 'utf8')
        if (/showNotification\(\s*\{/.test(t)) malos.push(path.relative(RAIZ, p).replace(/\\/g, '/'))
      }
    })(src)
    expect(malos).toEqual([])
  })
})
