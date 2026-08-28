import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/**
 * Regresión de los 10 hallazgos de la auditoría "audita todo" sobre
 * c032082..HEAD: 8 agentes revisaron el diff completo por ángulos distintos,
 * cada candidato pasó por un segundo agente de verificación independiente, y
 * estos son los que sobrevivieron confirmados. La mayoría se prueba por
 * escaneo estático del código fuente (el patrón ya establecido en este
 * proyecto para lógica de Electron/Firestore que no se puede montar en un
 * entorno de test sin DOM) — el reset de trial sí se prueba de punta a punta,
 * porque licenseManager.cjs no depende de `electron` y se puede cargar solo.
 */

describe('App.jsx: el guard de snapshot vacío protege también los snapshots de caché', () => {
  it('ya no excluye fromCache de la protección', () => {
    const fuente = leer('src', 'App.jsx')
    const bloque = fuente.slice(fuente.indexOf('const guard = (col, apply)'), fuente.indexOf('const guard = (col, apply)') + 400)
    // Antes: `data.length === 0 && previous.length > 0 && !meta?.fromCache`.
    // Un snapshot inicial fromCache:true vacío pasaba de largo y pisaba el
    // estado + la copia de localStorage con datos reales existiendo.
    expect(bloque).not.toMatch(/fromCache/)
    expect(bloque).toMatch(/data\.length === 0 && previous\.length > 0/)
  })
})

describe('useBusinessId.js: la reparación de membresía no pisa a otro miembro concurrente', () => {
  it('usa merge:true + arrayUnion en vez de un setDoc de reemplazo total', () => {
    const fuente = leer('src', 'hooks', 'useBusinessId.js')
    const bloque = fuente.slice(fuente.indexOf('businessSnap.exists()'), fuente.indexOf('businessSnap.exists()') + 700)
    expect(bloque).toMatch(/members:\s*arrayUnion\(user\.uid\)/)
    expect(bloque).toMatch(/\{\s*merge:\s*true\s*\}/)
  })
})

describe('EmprendedorPanel.jsx: el chequeo de choque de horario al entregar un pedido ya no es código muerto', () => {
  it('siempre pasa por addAppointment, nunca por un setAppointments directo', () => {
    const fuente = leer('src', 'components', 'screens', 'EmprendedorPanel.jsx')
    // Antes: `if (typeof setAppointments === 'function') { setAppointments(...) }
    // else if (addAppointment) { ... }` — App.jsx siempre pasa setAppointments
    // como función, así que la rama con el chequeo de choque nunca corría.
    expect(fuente).not.toMatch(/typeof setAppointments === 'function'/)
    expect(fuente).toMatch(/addAppointment\(nuevaAppointment\) === false/)
    // El prop ya no se recibe: si volviera a aparecer en la firma del
    // componente, es señal de que alguien reintrodujo la rama muerta.
    const firma = fuente.slice(fuente.indexOf('export default function EmprendedorPanel'), fuente.indexOf('}) {'))
    expect(firma).not.toMatch(/setAppointments/)
  })
})

describe('pdfReportGenerator.js: el PDF exportado filtra por la misma fecha que la pantalla', () => {
  it('generateSalesReport y generateCustomersReport usan getRevenueDate, no a.startTime, para el rango', () => {
    const fuente = leer('src', 'utils', 'pdfReportGenerator.js')
    expect(fuente).toMatch(/import \{ todayKey, parseLocalDate, getRevenueDate \} from '\.\/helpers'/)

    const ventas = fuente.slice(
      fuente.indexOf('export function generateSalesReport'),
      fuente.indexOf('export function generateSalesReport') + 1000
    )
    expect(ventas).toMatch(/const d = new Date\(getRevenueDate\(a\)\)/)

    const clientes = fuente.slice(
      fuente.indexOf('export function generateCustomersReport'),
      fuente.indexOf('export function generateCustomersReport') + 1000
    )
    expect(clientes).toMatch(/const d = new Date\(getRevenueDate\(a\)\)/)
  })
})

describe('electron/main.cjs: fetch-external ya no confía en el hostname sin resolver DNS', () => {
  it('resuelve la IP y valida CADA dirección resuelta antes de conectar (pinning)', () => {
    const fuente = leer('electron', 'main.cjs')
    const bloque = fuente.slice(
      fuente.indexOf("ipcMain.handle('fetch-external'"),
      fuente.indexOf("ipcMain.handle('fetch-external'") + 3000
    )
    expect(bloque).toMatch(/dns\.lookup\(parsedUrl\.hostname,\s*\{\s*all:\s*true\s*\}/)
    expect(bloque).toMatch(/addresses\.some\(a => isPrivateAddress\(a\.address\)\)/)
    // La conexión real tiene que ir a la IP resuelta y validada, no de nuevo
    // al hostname (si no, Node vuelve a resolver el DNS al conectar y el
    // chequeo de arriba no sirvió de nada).
    expect(bloque).toMatch(/connectTo\(addresses\[0\]\.address\)/)
    // El SNI/certificado TLS tienen que seguir siendo los del dominio real.
    expect(bloque).toMatch(/servername: parsedUrl\.protocol === 'https:' \? parsedUrl\.hostname : undefined/)
  })
})

describe('ProductsScreen.jsx: el chequeo de "producto con pedido activo" no ignora in-progress', () => {
  it('usa el ACTIVE_STATUSES compartido en vez de un Set local incompleto', () => {
    const fuente = leer('src', 'components', 'screens', 'ProductsScreen.jsx')
    expect(fuente).toMatch(/import \{ ACTIVE_STATUSES \} from '\.\.\/\.\.\/utils\/constants'/)
    expect(fuente).not.toMatch(/ESTADOS_ACTIVOS/)
    expect(fuente).toMatch(/ACTIVE_STATUSES\.has\(a\.status\)/)
  })
})

describe('NewAppointmentScreen.jsx: el precio tipeado en el alta rápida sobrevive al montar la pantalla', () => {
  it('el efecto de recálculo de precio se salta la primera corrida cuando pre.price viene seteado', () => {
    const fuente = leer('src', 'components', 'screens', 'NewAppointmentScreen.jsx')
    expect(fuente).toMatch(/const skipFirstPriceCalc = useRef\(pre\?\.price != null\)/)
    const bloque = fuente.slice(
      fuente.indexOf('const skipFirstPriceCalc'),
      fuente.indexOf('const skipFirstPriceCalc') + 500
    )
    expect(bloque).toMatch(/if \(skipFirstPriceCalc\.current\) \{/)
  })
})

describe('AppointmentDetailScreen.jsx: editar la fecha de pago no muestra "actualizado" si falló', () => {
  it('handleEditPaymentDateConfirm chequea el retorno de markAsPaid/updateAppointment', () => {
    const fuente = leer('src', 'components', 'screens', 'AppointmentDetailScreen.jsx')
    const bloque = fuente.slice(
      fuente.indexOf('const handleEditPaymentDateConfirm'),
      fuente.indexOf('const handleDelete')
    )
    expect(bloque).toMatch(/if \(actualizado === false\) return/)
    // El toast de éxito tiene que estar DESPUÉS del chequeo, no antes.
    expect(bloque.indexOf('actualizado === false')).toBeLessThan(bloque.indexOf('Fecha de pago actualizada'))
  })
})

describe('licenseManager.cjs: borrar trial.dat solo ya no resetea el trial', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-trialreset-'))
  afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

  const fuente = leer('electron', 'licenseManager.cjs')

  function cargarModulo() {
    const p = path.join(raiz, `lm-${Math.random().toString(36).slice(2)}.cjs`)
    fs.writeFileSync(p, fuente)
    const m = require_(p)
    const datos = fs.mkdtempSync(path.join(raiz, 'datos-'))
    m.setDataPath(datos)
    return { m, trialFile: path.join(datos, 'trial.dat') }
  }

  it('el ancla del Registro preserva la fecha real de inicio aunque se borre el archivo', () => {
    const { m, trialFile } = cargarModulo()
    try {
      const primero = m.getTrialInfo()
      expect(primero.active).toBe(true)
      expect(primero.startedAt).toBeTruthy()

      // El ataque de un clic: borrar sólo el archivo local.
      fs.unlinkSync(trialFile)
      expect(fs.existsSync(trialFile)).toBe(false)

      const segundo = m.getTrialInfo()

      if (process.platform === 'win32') {
        // Con el ancla en el Registro, la fecha real se recupera: no es un
        // trial nuevo con daysLeft de vuelta a full de la nada.
        expect(segundo.startedAt).toBe(primero.startedAt)
        // Y se autorepara: el archivo vuelve a existir con la fecha real.
        expect(fs.existsSync(trialFile)).toBe(true)
      } else {
        // Fuera de Windows no hay ancla de Registro todavía (ver comentario en
        // licenseManager.cjs): documentado, no se afirma una protección que
        // no existe en esta plataforma.
        expect(segundo.active).toBe(true)
      }
    } finally {
      m.deleteTrialAnchor()
    }
  })

  it('un cliente nuevo de verdad (sin ancla previa) sigue arrancando el trial con normalidad', () => {
    const { m, trialFile } = cargarModulo()
    try {
      const info = m.getTrialInfo()
      expect(info.active).toBe(true)
      expect(info.daysLeft).toBe(14)
      expect(fs.existsSync(trialFile)).toBe(true)
    } finally {
      m.deleteTrialAnchor()
    }
  })
})
