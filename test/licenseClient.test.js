import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)

// Par de claves de prueba, equivalente al que genera functions/generateKeys.js
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' })

// Cargamos el cliente con la clave pública de prueba inyectada
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-lic-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const fuente = fs.readFileSync(new URL('../electron/licenseClient.cjs', import.meta.url), 'utf8')
const modPath = path.join(raiz, 'licenseClient.cjs')
fs.writeFileSync(modPath, fuente
  .replace(/const PUBLIC_KEY_PEM = `[^`]*`/, 'const PUBLIC_KEY_PEM = ' + JSON.stringify(PUB))
  // Desde el arreglo del flag, pegar la clave no alcanza: hay que confirmar
  // que la Cloud Function está desplegada.
  .replace('const SERVIDOR_DESPLEGADO = false', 'const SERVIDOR_DESPLEGADO = true'))
const lic = require_(modPath)

/** Simula exactamente lo que hace la Cloud Function. */
function firmarComoServidor(datos) {
  const payload = lic.payloadCanonico(datos)
  const firma = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64')
  return { ...datos, firma }
}

const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString()

const grantValido = () => firmarComoServidor({
  deviceId: 'ABC123DEVICE',
  plan: 'professional',
  emitidoEn: new Date().toISOString(),
  validoHasta: enDias(7),
  licenciaHasta: null,
})

beforeEach(() => {
  const f = path.join(raiz, 'license-grant.json')
  if (fs.existsSync(f)) fs.unlinkSync(f)
  lic.setDataPath(raiz)
})

describe('verificación de firma', () => {
  it('acepta una concesión firmada por el servidor', () => {
    expect(lic.verificarFirma(grantValido())).toBe(true)
  })

  it('RECHAZA si cambian el plan a master', () => {
    const g = grantValido()
    expect(lic.verificarFirma({ ...g, plan: 'master' })).toBe(false)
  })

  it('RECHAZA si estiran la fecha de vencimiento', () => {
    const g = grantValido()
    expect(lic.verificarFirma({ ...g, validoHasta: enDias(3650) })).toBe(false)
  })

  it('RECHAZA si cambian el dispositivo', () => {
    const g = grantValido()
    expect(lic.verificarFirma({ ...g, deviceId: 'OTRO_EQUIPO' })).toBe(false)
  })

  it('RECHAZA una firma inventada', () => {
    const g = grantValido()
    expect(lic.verificarFirma({ ...g, firma: Buffer.alloc(64).toString('base64') })).toBe(false)
  })

  it('RECHAZA una concesión firmada con OTRA clave privada', () => {
    // El escenario real: alguien monta su propio "servidor de licencias".
    const otro = crypto.generateKeyPairSync('ed25519')
    const datos = {
      deviceId: 'ABC123DEVICE', plan: 'master',
      emitidoEn: new Date().toISOString(), validoHasta: enDias(3650), licenciaHasta: null,
    }
    const firma = crypto.sign(null, Buffer.from(lic.payloadCanonico(datos), 'utf8'),
                              otro.privateKey).toString('base64')
    expect(lic.verificarFirma({ ...datos, firma })).toBe(false)
  })

  it('no revienta con una firma corrupta', () => {
    expect(() => lic.verificarFirma({ ...grantValido(), firma: 'no-es-base64-!!' })).not.toThrow()
    expect(lic.verificarFirma({ firma: null })).toBe(false)
  })
})

describe('concesión guardada en disco', () => {
  const guardar = (g) => fs.writeFileSync(path.join(raiz, 'license-grant.json'), JSON.stringify(g))

  it('una concesión válida y vigente habilita la app', () => {
    guardar(grantValido())
    const r = lic.validarGrantLocal('ABC123DEVICE')
    expect(r.valido).toBe(true)
    expect(r.grant.plan).toBe('professional')
  })

  it('sin concesión no hay licencia', () => {
    expect(lic.validarGrantLocal('ABC123DEVICE').motivo).toBe('sin-concesion')
  })

  it('EDITAR el archivo a mano lo invalida — el ataque obvio', () => {
    const g = grantValido()
    guardar({ ...g, plan: 'master', validoHasta: enDias(3650) })
    const r = lic.validarGrantLocal('ABC123DEVICE')
    expect(r.valido).toBe(false)
    expect(r.motivo).toBe('firma-invalida')
  })

  it('COPIAR el archivo a otra máquina no sirve', () => {
    guardar(grantValido())                       // concesión de ABC123DEVICE
    const r = lic.validarGrantLocal('OTRA_MAQUINA')
    expect(r.valido).toBe(false)
    expect(r.motivo).toBe('otro-dispositivo')
  })

  it('una concesión vencida pide revalidar, no queda activa', () => {
    guardar(firmarComoServidor({
      deviceId: 'ABC123DEVICE', plan: 'professional',
      emitidoEn: enDias(-10), validoHasta: enDias(-3), licenciaHasta: null,
    }))
    const r = lic.validarGrantLocal('ABC123DEVICE')
    expect(r.valido).toBe(false)
    expect(r.motivo).toBe('vencida')
  })

  it('una licencia con vencimiento pasado no vale aunque la concesión esté vigente', () => {
    guardar(firmarComoServidor({
      deviceId: 'ABC123DEVICE', plan: 'professional',
      emitidoEn: new Date().toISOString(),
      validoHasta: enDias(7),        // concesión vigente
      licenciaHasta: enDias(-1),     // pero la licencia venció
    }))
    expect(lic.validarGrantLocal('ABC123DEVICE').motivo).toBe('licencia-vencida')
  })

  it('un archivo con JSON roto no rompe la app', () => {
    fs.writeFileSync(path.join(raiz, 'license-grant.json'), '{roto')
    expect(() => lic.validarGrantLocal('ABC123DEVICE')).not.toThrow()
    expect(lic.validarGrantLocal('ABC123DEVICE').valido).toBe(false)
  })

  it('el ID de dispositivo no distingue mayúsculas', () => {
    guardar(grantValido())
    expect(lic.validarGrantLocal('abc123device').valido).toBe(true)
  })

  it('funciona SIN conexión mientras la concesión esté vigente', () => {
    // El punto de los 7 días: el consultorio sin internet sigue trabajando.
    guardar(firmarComoServidor({
      deviceId: 'ABC123DEVICE', plan: 'professional',
      emitidoEn: enDias(-6), validoHasta: enDias(1), licenciaHasta: null,
    }))
    expect(lic.validarGrantLocal('ABC123DEVICE').valido).toBe(true)
  })
})

describe('configuración', () => {
  it('detecta que falta pegar las claves y no finge que anda', () => {
    const sinConfig = path.join(raiz, 'sinconfig.cjs')
    fs.writeFileSync(sinConfig, fuente)      // el original, con el placeholder
    const m = require_(sinConfig)
    expect(m.estaConfigurado()).toBe(false)
  })

  it('la clave pegada SOLA no alcanza — falta confirmar el despliegue', () => {
    // El bug: generateKeys.js pegaba la clave, estaConfigurado() daba true, y
    // la app empezaba a consultar un servidor que todavía no existía. Quedaba
    // imposible activar cualquier licencia hasta terminar el deploy.
    const soloClave = path.join(raiz, 'soloclave.cjs')
    fs.writeFileSync(soloClave, fuente.replace(
      /const PUBLIC_KEY_PEM = `[^`]*`/, 'const PUBLIC_KEY_PEM = ' + JSON.stringify(PUB)
    ))
    expect(require_(soloClave).estaConfigurado()).toBe(false)
  })

  it('con la clave pegada Y el servidor desplegado, sí', () => {
    expect(lic.estaConfigurado()).toBe(true)
  })
})
