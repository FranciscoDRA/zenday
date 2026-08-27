import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)

/**
 * Los tres niveles que se venden — y que los tres estén atados al equipo.
 *
 * El agujero que cierra esto: 'master' (el nivel admin, el más caro) NO estaba
 * en PLANS. El único camino a ese plan era generateMasterKey(), que es
 * HMAC(SECRET, 'MASTER'): UNA sola clave, igual para todas las máquinas del
 * mundo, sin vencimiento.
 *
 * O sea que el nivel admin era invendible: al primer cliente que la reenviaba,
 * la tenían todos. Ahora 'master' se genera con generateKey(hardwareId, plan)
 * como los otros dos, y queda atado a su equipo.
 *
 * La llave global sigue existiendo, pero como herramienta de soporte tuya.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-planes-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const fuente = fs.readFileSync(new URL('../electron/licenseManager.cjs', import.meta.url), 'utf8')

/** Carga licenseManager simulando ser una máquina concreta. */
function comoEquipo(hwId) {
  const p = path.join(raiz, `lm-${hwId}.cjs`)
  const src = fuente.replace(
    /^  cachedHwId = crypto\.createHash.*$/m,
    `  cachedHwId = ${JSON.stringify(hwId)}`
  )
  if (src === fuente) throw new Error('no se pudo inyectar el hardware id')
  fs.writeFileSync(p, src)
  const m = require_(p)
  m.setDataPath(fs.mkdtempSync(path.join(raiz, 'datos-')))
  return m
}

const EQUIPO_A = '1111111111111111'
const EQUIPO_B = '2222222222222222'
const NIVELES = ['professional', 'entrepreneur', 'master']

describe('los tres niveles existen y se activan', () => {
  for (const plan of NIVELES) {
    it(`${plan}: la clave del propio equipo se acepta`, () => {
      const a = comoEquipo(EQUIPO_A)
      const r = a.activateLicense(a.generateKey(EQUIPO_A, plan))
      expect(r.success).toBe(true)
      expect(r.plan).toBe(plan)
    })
  }

  it("el nivel admin llega como plan 'master', que es lo que desbloquea el cambio de modo", () => {
    // isModeLocked = activa && plan !== 'master'  (SettingsScreen)
    const a = comoEquipo(EQUIPO_A)
    expect(a.activateLicense(a.generateKey(EQUIPO_A, 'master')).plan).toBe('master')
  })
})

describe('ninguna clave vendida sirve en otra máquina', () => {
  for (const plan of NIVELES) {
    it(`${plan}: la clave del equipo A NO sirve en el equipo B`, () => {
      const a = comoEquipo(EQUIPO_A)
      const b = comoEquipo(EQUIPO_B)
      const clave = a.generateKey(EQUIPO_A, plan)

      expect(a.activateLicense(clave).success).toBe(true)   // en el suyo, sí
      expect(b.activateLicense(clave).success).toBe(false)  // reenviada, no
    })
  }

  it('EL BUG: antes el nivel admin era una sola clave para todo el mundo', () => {
    // Si alguien vuelve a sacar 'master' de PLANS, este test lo caza: la única
    // forma de conseguir plan 'master' volvería a ser la llave global.
    const a = comoEquipo(EQUIPO_A)
    const b = comoEquipo(EQUIPO_B)
    const adminDeA = a.generateKey(EQUIPO_A, 'master')
    const adminDeB = b.generateKey(EQUIPO_B, 'master')
    expect(adminDeA).not.toBe(adminDeB)
  })
})

describe('la llave global de soporte', () => {
  it('sigue funcionando en cualquier equipo — eso es a propósito', () => {
    const a = comoEquipo(EQUIPO_A)
    const b = comoEquipo(EQUIPO_B)
    const global = a.generateMasterKey()
    expect(a.activateLicense(global).plan).toBe('master')
    expect(b.activateLicense(global).plan).toBe('master')
  })

  it('es distinta de la clave admin de cualquier equipo', () => {
    // Si fueran iguales, vender admin sería regalar la llave de soporte.
    const a = comoEquipo(EQUIPO_A)
    expect(a.generateMasterKey()).not.toBe(a.generateKey(EQUIPO_A, 'master'))
  })
})

describe('el generador de claves no deja vender la llave global por error', () => {
  const cli = fs.readFileSync(new URL('../electron/generateLicense.cjs', import.meta.url), 'utf8')

  it('la llave global pide un flag explícito, no una palabra suelta', () => {
    // Antes `generateLicense.cjs master` devolvía la GLOBAL. Escribir eso
    // pensando que hacías una licencia admin para vender era un error de una
    // sola palabra con consecuencias permanentes.
    expect(cli).toMatch(/--soporte/)
    expect(cli).toMatch(/NO SE VENDE/)
  })

  it("'admin' genera una clave atada al equipo, no la global", () => {
    expect(cli).toMatch(/admin:\s*'master'/)
    expect(cli).toContain("generateKey(deviceId, plan)")
  })
})
