import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)

/**
 * readTrial() migra un trial.dat "formato viejo" (sin firma HMAC) al formato
 * firmado actual, para no cortarle el trial a quien venía de una versión
 * anterior de la app. El body de ese archivo viejo no está protegido por
 * nada — cualquiera puede escribir uno a mano con el `startedAt` que quiera
 * para resetear el trial cuantas veces quiera, sin tocar el disco por fuera
 * del propio archivo.
 *
 * El fix: el `startedAt` migrado sale de la fecha de modificación del
 * archivo en disco, no del valor que trae el JSON. Estos tests verifican que
 * el valor del JSON se ignora y que una migración legítima (archivo viejo de
 * verdad, con su mtime real) sigue funcionando igual que antes.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-trial-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const fuente = fs.readFileSync(new URL('../electron/licenseManager.cjs', import.meta.url), 'utf8')

// Cada módulo cargado usa su propia carpeta de datos vía setDataPath, lo que
// también le da su propio valor de Registro para el ancla del trial (ver
// TRIAL_REG_VALUE en licenseManager.cjs) — pero ese valor sí queda en el
// Registro real de la máquina si no se limpia, porque `reg` no es un mock.
const modulosCreados = []
afterAll(() => { for (const m of modulosCreados) m.deleteTrialAnchor() })

function cargarModulo() {
  const p = path.join(raiz, `lm-${Math.random().toString(36).slice(2)}.cjs`)
  fs.writeFileSync(p, fuente)
  const m = require_(p)
  const datos = fs.mkdtempSync(path.join(raiz, 'datos-'))
  m.setDataPath(datos)
  modulosCreados.push(m)
  return { m, trialFile: path.join(datos, 'trial.dat') }
}

function escribirTrialSinFirmar(trialFile, startedAt) {
  const body = { startedAt }
  fs.writeFileSync(trialFile, Buffer.from(JSON.stringify(body)).toString('base64'), 'utf8')
}

describe('migración del trial sin firma no confía en el body del archivo', () => {
  it('ignora un startedAt fabricado a mano en el JSON', () => {
    const { m, trialFile } = cargarModulo()

    // "Formato viejo" fabricado con una fecha de inicio falsa (hoy), para
    // intentar arrancar el trial de nuevo con los 14 días completos aunque
    // el archivo en disco sea viejo.
    escribirTrialSinFirmar(trialFile, new Date().toISOString())

    // Pero el archivo en sí tiene 10 días de antigüedad en disco.
    const haceDiez = new Date(Date.now() - 10 * 86400000)
    fs.utimesSync(trialFile, haceDiez, haceDiez)

    const result = m.checkLicense()
    expect(result.status).toBe('trial')
    // Si se hubiera confiado en el JSON, darían ~14. Debe reflejar los ~10
    // días reales según la fecha de modificación del archivo.
    expect(result.daysLeft).toBeLessThanOrEqual(4)
    expect(result.daysLeft).toBeGreaterThanOrEqual(3)
  })

  it('una migración legítima (archivo realmente viejo) preserva los días ya consumidos', () => {
    const { m, trialFile } = cargarModulo()

    escribirTrialSinFirmar(trialFile, new Date(Date.now() - 3 * 86400000).toISOString())
    const haceTres = new Date(Date.now() - 3 * 86400000)
    fs.utimesSync(trialFile, haceTres, haceTres)

    const result = m.checkLicense()
    expect(result.status).toBe('trial')
    expect(result.daysLeft).toBeLessThanOrEqual(11)
    expect(result.daysLeft).toBeGreaterThanOrEqual(10)
  })

  it('la migración reescribe el archivo firmado: la segunda lectura ya no es "formato viejo"', () => {
    const { m, trialFile } = cargarModulo()
    escribirTrialSinFirmar(trialFile, new Date().toISOString())

    m.checkLicense()

    const raw = JSON.parse(Buffer.from(fs.readFileSync(trialFile, 'utf8'), 'base64').toString('utf8'))
    expect(raw.sig).toBeTruthy()
  })
})
