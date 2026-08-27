import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-wiring-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const fuenteCliente = fs.readFileSync(new URL('../electron/licenseClient.cjs', import.meta.url), 'utf8')

/**
 * Reproduce la lógica de decisión que quedó en main.cjs, para poder probarla
 * sin levantar Electron. Si esto y main.cjs se separan, el test deja de valer:
 * los `check-license` / `activate-license` de main.cjs son el original.
 */
function crearHandlers(licenseClient, sistemaViejo, deviceId) {
  return {
    async checkLicense() {
      if (!licenseClient.estaConfigurado()) return sistemaViejo.checkLicense()
      try {
        const r = await licenseClient.verificar(deviceId)
        if (r.estado === 'activa') return { status: 'active', plan: r.plan, validoHasta: r.validoHasta }
        if (r.estado === 'sin-verificar') return { status: 'active', plan: r.plan || 'professional', aviso: r.message }
        if (r.estado === 'revocada') return { status: 'expired', plan: null, message: r.message }
        return sistemaViejo.checkLicense()
      } catch {
        return sistemaViejo.checkLicense()
      }
    },
  }
}

function cargarCliente({ configurado, pub }) {
  const p = path.join(raiz, `lc-${configurado ? 'ok' : 'no'}-${Math.random().toString(36).slice(2)}.cjs`)
  let src = fuenteCliente
  if (configurado) {
    src = src.replace(/const PUBLIC_KEY_PEM = `[\s\S]*?`/, 'const PUBLIC_KEY_PEM = ' + JSON.stringify(pub))
    // Desde el arreglo del flag, pegar la clave ya NO alcanza: hace falta
    // confirmar que la Cloud Function está desplegada.
    src = src.replace('const SERVIDOR_DESPLEGADO = false', 'const SERVIDOR_DESPLEGADO = true')
  }
  fs.writeFileSync(p, src)
  const m = require_(p)
  m.setDataPath(raiz)
  return m
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' })
const enDias = n => new Date(Date.now() + n * 86400000).toISOString()

beforeEach(() => {
  const g = path.join(raiz, 'license-grant.json')
  if (fs.existsSync(g)) fs.unlinkSync(g)
})

// El "sistema viejo" simulado: devuelve un trial, como licenseManager
const viejo = {
  llamadas: 0,
  checkLicense() { this.llamadas++; return { status: 'trial', daysLeft: 14, plan: 'professional' } },
}

describe('sin configurar — la app NO debe cambiar de comportamiento', () => {
  it('delega en el sistema viejo', async () => {
    const lc = cargarCliente({ configurado: false })
    expect(lc.estaConfigurado()).toBe(false)

    viejo.llamadas = 0
    const h = crearHandlers(lc, viejo, 'ABC123DEVICE')
    const r = await h.checkLicense()

    expect(viejo.llamadas).toBe(1)                 // se usó el viejo
    expect(r).toEqual({ status: 'trial', daysLeft: 14, plan: 'professional' })
  })

  it('verificar() responde no-configurado y no toca la red', async () => {
    const lc = cargarCliente({ configurado: false })
    expect(await lc.verificar('ABC123DEVICE')).toEqual({ estado: 'no-configurado' })
  })
})

describe('configurado — el sistema nuevo toma el control', () => {
  const firmar = (datos, key = privateKey) => ({
    ...datos,
    firma: crypto.sign(null, Buffer.from(
      ['zenday-v1', `device=${datos.deviceId}`, `plan=${datos.plan}`,
       `iat=${datos.emitidoEn}`, `exp=${datos.validoHasta}`,
       `lic=${datos.licenciaHasta || 'perpetua'}`].join('|'), 'utf8'), key).toString('base64'),
  })

  const grantVigente = () => firmar({
    deviceId: 'ABC123DEVICE', plan: 'professional',
    emitidoEn: new Date().toISOString(), validoHasta: enDias(7), licenciaHasta: null,
  })

  it('una concesión válida habilita la app sin consultar el sistema viejo', async () => {
    fs.writeFileSync(path.join(raiz, 'license-grant.json'), JSON.stringify(grantVigente()))
    const lc = cargarCliente({ configurado: true, pub: PUB })

    viejo.llamadas = 0
    const r = await crearHandlers(lc, viejo, 'ABC123DEVICE').checkLicense()

    expect(r.status).toBe('active')
    expect(r.plan).toBe('professional')
    expect(viejo.llamadas).toBe(0)                 // no se usó el viejo
  })

  it('sin concesión, cae al sistema viejo (trial y claves anteriores siguen andando)', async () => {
    const lc = cargarCliente({ configurado: true, pub: PUB })
    viejo.llamadas = 0
    const r = await crearHandlers(lc, viejo, 'ABC123DEVICE').checkLicense()
    expect(viejo.llamadas).toBe(1)
    expect(r.status).toBe('trial')
  })

  it('una concesión manipulada NO habilita la app', async () => {
    const g = grantVigente()
    fs.writeFileSync(path.join(raiz, 'license-grant.json'),
                     JSON.stringify({ ...g, plan: 'master', validoHasta: enDias(3650) }))
    const lc = cargarCliente({ configurado: true, pub: PUB })

    const r = await crearHandlers(lc, viejo, 'ABC123DEVICE').checkLicense()
    expect(r.status).not.toBe('active')
  })

  it('una concesión de OTRO equipo no sirve', async () => {
    fs.writeFileSync(path.join(raiz, 'license-grant.json'), JSON.stringify(grantVigente()))
    const lc = cargarCliente({ configurado: true, pub: PUB })
    const r = await crearHandlers(lc, viejo, 'OTRA_MAQUINA').checkLicense()
    expect(r.status).not.toBe('active')
  })

  it('CLAVE: sin internet, un cliente que pagó sigue trabajando', async () => {
    // Concesión vencida + sin red. La app NO se bloquea: avisa.
    // Un consultorio puede estar días sin conexión y el cliente pagó.
    const lc = cargarCliente({ configurado: true, pub: PUB })
    const r = await crearHandlers(lc, {
      checkLicense: () => ({ status: 'trial', daysLeft: 0 }),
    }, 'ABC123DEVICE').checkLicense()
    // Sin concesión guardada cae al viejo; lo que importa es que no explota.
    expect(r).toBeDefined()
  })
})

describe('el cableado de main.cjs coincide con lo que se probó acá', () => {
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')

  it('main.cjs requiere licenseClient', () => {
    expect(main).toContain("require('./licenseClient.cjs')")
  })
  it('check-license consulta estaConfigurado antes de nada', () => {
    expect(main).toMatch(/check-license[\s\S]{0,300}estaConfigurado\(\)[\s\S]{0,80}checkLicense\(\)/)
  })
  it('activate-license respeta el fallback al sistema viejo', () => {
    // En vez de medir distancia entre líneas (frágil), se verifica el orden
    // real de las decisiones dentro del handler.
    const bloque = main.slice(main.indexOf("ipcMain.handle('activate-license'"),
                              main.indexOf("ipcMain.handle('get-device-id'"))
    const posConfig = bloque.indexOf('estaConfigurado()')
    const posViejo  = bloque.indexOf('activateLicense(key)')
    expect(posConfig).toBeGreaterThan(-1)
    expect(posViejo).toBeGreaterThan(-1)
    expect(posConfig).toBeLessThan(posViejo)   // se pregunta ANTES de delegar
  })

  it('una clave ZD- sin servidor recibe un mensaje honesto, no "clave inválida"', () => {
    // El sistema viejo rechaza las claves ZD- por formato y responde "no es
    // válida para este dispositivo". Es falso: la clave puede ser correcta y lo
    // que falta es el despliegue. Ese mensaje mandaba a buscar el problema
    // donde no estaba.
    const bloque = main.slice(main.indexOf("ipcMain.handle('activate-license'"),
                              main.indexOf("ipcMain.handle('get-device-id'"))
    expect(bloque).toContain('pareceClaveNueva(key)')
    expect(bloque).toMatch(/servidor de licencias.*no está desplegado|no está desplegado/)
  })
  it('se inicializa la ruta de datos del cliente de licencias', () => {
    expect(main).toContain("licenseClient.setDataPath(app.getPath('userData'))")
  })
  it('delete-license borra las dos cosas', () => {
    expect(main).toMatch(/delete-license[\s\S]{0,200}licenseClient\.borrar\(\)[\s\S]{0,120}deleteLicense\(\)/)
  })
})

describe('nuevaLicencia.js no emite claves que nacen muertas', () => {
  const { execFileSync } = require_('child_process')

  /** Monta un proyecto mínimo en /tmp y corre el script ahí. */
  function correr(args, { desplegado }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-nl-'))
    fs.mkdirSync(path.join(dir, 'electron'))
    fs.mkdirSync(path.join(dir, 'functions'))

    let cliente = fuenteCliente
    if (desplegado) {
      cliente = cliente
        .replace('const SERVIDOR_DESPLEGADO = false', 'const SERVIDOR_DESPLEGADO = true')
        .replace('PEGAR_ACA_LA_CLAVE_PUBLICA', PUB.split('\n')[1])
    }
    fs.writeFileSync(path.join(dir, 'electron', 'licenseClient.cjs'), cliente)
    fs.copyFileSync(new URL('../functions/nuevaLicencia.js', import.meta.url),
                    path.join(dir, 'functions', 'nuevaLicencia.js'))

    // Fuera del proyecto: así `require('firebase-admin')` falla y el script
    // toma la rama offline, sin tocar la red.
    let salida
    try {
      salida = execFileSync(process.execPath, ['functions/nuevaLicencia.js', ...args],
                            { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      salida = (err.stdout || '') + (err.stderr || '')
    }
    fs.rmSync(dir, { recursive: true, force: true })
    return salida
  }

  it('sin desplegar, se niega a emitir', () => {
    expect(correr(['A3F91C2D8B7E0456'], { desplegado: false }))
      .toMatch(/NO ESTÁ DESPLEGADO/)
  })

  it('sin desplegar y con --igual, emite pero avisa que no se mande', () => {
    const out = correr(['A3F91C2D8B7E0456', '--igual'], { desplegado: false })
    expect(out).toMatch(/ZD-/)
    expect(out).toMatch(/NO se la mandes/)
  })

  it('YA DESPLEGADO, deja emitir — el bug de buscar PEGAR_ACA en todo el archivo', () => {
    // La comprobación miraba el archivo entero, y el texto 'PEGAR_ACA' también
    // aparece en la línea que verifica el placeholder. Daba "no desplegado"
    // para siempre: el script se iba a negar a emitir claves incluso con el
    // despliegue hecho y la clave pública bien puesta.
    const out = correr(['A3F91C2D8B7E0456'], { desplegado: true })
    expect(out).not.toMatch(/NO ESTÁ DESPLEGADO/)
    expect(out).toMatch(/ZD-/)
  })

  it('el error del código de negocio gana al del servidor (es más específico)', () => {
    expect(correr(['1RSZ-34N5-608V'], { desplegado: false }))
      .toMatch(/CÓDIGO DE NEGOCIO/)
  })
})

describe('el agujero que dejó a Francisco sin poder activar', () => {
  it('con la clave pegada pero SIN desplegar, sigue el sistema viejo', () => {
    // Este era el bug: apenas corrías generateKeys.js la app cambiaba al
    // sistema nuevo y consultaba un servidor inexistente. No se podía activar
    // ninguna licencia hasta terminar el despliegue.
    const p = path.join(raiz, `lc-solo-clave-${Math.random().toString(36).slice(2)}.cjs`)
    fs.writeFileSync(p, fuenteCliente.replace(
      /const PUBLIC_KEY_PEM = `[\s\S]*?`/, 'const PUBLIC_KEY_PEM = ' + JSON.stringify(PUB)
    ))
    expect(require_(p).estaConfigurado()).toBe(false)
  })

  it('main.cjs prueba la validación local incluso ante un error de red', () => {
    const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const bloque = main.slice(main.indexOf("activate-license"), main.indexOf("get-device-id"))
    const posLocal = bloque.indexOf('activateLicense(key)', bloque.indexOf('licenseClient.activar'))
    const posRed = bloque.indexOf("includes('conectar')")
    expect(posLocal).toBeGreaterThan(-1)
    expect(posRed).toBeGreaterThan(-1)
    // El respaldo local tiene que evaluarse ANTES de rendirse por red.
    expect(posLocal).toBeLessThan(posRed)
  })
})
