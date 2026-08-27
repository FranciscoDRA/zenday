import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Dos cosas que se veían mal y una que se sentía lenta.
 *
 * 1. LOS CARTELES DEL SISTEMA
 *
 *    Nueve lugares usaban `window.confirm`. En Electron eso no abre un modal
 *    lindo: abre el cartel gris de Windows, con la ruta del archivo escrita
 *    arriba. Al lado del resto de la app parece que algo se rompió — y tres de
 *    esos nueve eran para BORRAR un cliente, un pedido o un artículo, o sea el
 *    momento en que menos querés que el programa parezca roto.
 *
 *    La app ya tenía su propio modal (`useConfirm`), usado correctamente en
 *    otros lados. Ahora lo usan los nueve.
 *
 *    El detalle que puede morder: `confirm()` devuelve una PROMESA. Las tres
 *    funciones de borrado devuelven `false` cuando el usuario cancela, y quien
 *    las llama hace `if (deletePatient(id) === false) return`. Una promesa
 *    nunca es `=== false`, así que sin `await` el guard no salta nunca y la app
 *    sigue como si hubieras confirmado. Hay un test abajo sólo para eso.
 *
 * 2. LOS CONTEXTOS QUE SE RECREABAN
 *
 *    `<Provider value={{ a, b }}>` arma un objeto NUEVO en cada render. React
 *    compara ese value por identidad, así que "nuevo objeto" = "cambió" = se
 *    re-renderiza todo lo que consume el contexto, aunque adentro esté lo
 *    mismo de siempre. Con ToastContext eso llegaba a resuscribir los cuatro
 *    listeners de Firestore cada vez que aparecía un aviso en pantalla.
 *
 *    Estaba arreglado en ToastContext y seguía igual en los otros tres.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

function recorrer(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) recorrer(p, acc)
    else if (/\.jsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

describe('no queda ningún cartel del sistema operativo', () => {
  it('ni confirm, ni alert, ni prompt del navegador', () => {
    const culpables = recorrer(SRC)
      .filter(f => /window\.(confirm|alert|prompt)\s*\(/.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
    expect(culpables).toEqual([])
  })

  it('los que los tenían ahora usan el modal de la app', () => {
    const ANTES = [
      ['components', 'common', 'NotificationCenter.jsx'],
      ['components', 'common', 'AppointmentCard.jsx'],
      ['components', 'common', 'IntegrationManager.jsx'],
      ['components', 'common', 'BackButton.jsx'],
      ['components', 'screens', 'PersonalAgendaScreen.jsx'],
      ['components', 'screens', 'SettingsScreen.jsx'],
    ]
    for (const f of ANTES) {
      const txt = leer(...f)
      expect(txt, `${f.at(-1)} no importa useConfirm`).toMatch(/import \{ useConfirm \}/)
      expect(txt, `${f.at(-1)} no lo engancha`).toMatch(/const \{ confirm \}\s*=\s*useConfirm\(\)/)
    }
  })

  it('App.jsx también', () => {
    const app = leer('App.jsx')
    expect(app).toMatch(/import \{ ConfirmProvider, useConfirm \}/)
    expect(app).toMatch(/const \{ confirm \}\s*=\s*useConfirm\(\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  El contrato que se rompe en silencio.
// ─────────────────────────────────────────────────────────────────────────────
describe('borrar espera la respuesta del usuario', () => {
  const BORRADOS = ['deleteAppointment', 'deletePatient', 'deleteProduct']
  const app = leer('App.jsx')

  for (const fn of BORRADOS) {
    it(`${fn} es async — usa await confirm()`, () => {
      expect(app).toMatch(new RegExp(`const ${fn} = useCallback\\(async \\(`))
    })

    it(`${fn} lleva confirm en sus dependencias`, () => {
      // Sin esto se queda con un `confirm` viejo. Es seguro ponerlo porque
      // ConfirmContext ahora memoiza su value: la referencia no cambia.
      const i = app.indexOf(`const ${fn} = useCallback`)
      const cierre = app.slice(i).match(/\n {2}\}, \[([^\]]*)\]\)/)
      expect(cierre, `no encontré el cierre de ${fn}`).not.toBeNull()
      expect(cierre[1]).toContain('confirm')
    })
  }

  it('NADIE compara el resultado con === false sin await', () => {
    // Este es el bug que se colaría sin ruido: una promesa nunca es === false,
    // así que el `return` de seguridad no se ejecuta y la pantalla sigue como
    // si el borrado hubiera pasado — mostrando "eliminado" sobre algo que
    // sigue ahí, o borrando adjuntos de un cliente que no se borró.
    const malos = []
    for (const f of recorrer(SRC)) {
      const txt = sinComentarios(fs.readFileSync(f, 'utf8'))
      for (const fn of BORRADOS) {
        const re = new RegExp(`(await\\s+)?${fn}\\([^)]*\\)\\s*===\\s*false`, 'g')
        for (const m of txt.matchAll(re)) {
          if (!m[1]) malos.push(`${path.relative(SRC, f).replace(/\\/g, '/')}: ${m[0]}`)
        }
      }
    }
    expect(malos).toEqual([])
  })

  it('los tres lugares que lo comparan sí lo esperan', () => {
    expect(leer('components', 'screens', 'AppointmentDetailScreen.jsx'))
      .toMatch(/await deleteAppointment\(appointment\.id\) === false/)
    expect(leer('components', 'screens', 'PendingPaymentsScreen.jsx'))
      .toMatch(/await deleteAppointment\(apt\.id\) === false/)
    expect(leer('components', 'screens', 'PatientsScreen.jsx'))
      .toMatch(/await deletePatient\(patient\.id\) === false/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Los cuatro contextos.
// ─────────────────────────────────────────────────────────────────────────────
describe('ningún contexto se recrea en cada render', () => {
  const CONTEXTOS = ['ToastContext', 'ConfirmContext', 'NotificationContext', 'ReminderContext']

  for (const c of CONTEXTOS) {
    it(c, () => {
      const txt = sinComentarios(leer('contexts', `${c}.jsx`))
      // El objeto literal escrito directo en la prop es la forma que falla.
      expect(txt, `${c} pasa un objeto literal a value=`).not.toMatch(/value=\{\{/)
      expect(txt, `${c} no memoiza su value`).toMatch(/const value = useMemo\(/)
      expect(txt).toMatch(/Provider value=\{value\}/)
    })
  }

  it('todos importan useMemo', () => {
    for (const c of CONTEXTOS) {
      expect(leer('contexts', `${c}.jsx`), `${c}`).toMatch(/import React, \{[^}]*useMemo[^}]*\} from 'react'/)
    }
  })
})
