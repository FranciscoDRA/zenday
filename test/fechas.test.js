import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { toLocalDateKey, todayKey, parseLocalDate } from '../src/utils/helpers.js'

/**
 * El día que se corre solo.
 *
 * `new Date(x).toISOString().split('T')[0]` es la forma más común de sacar un
 * 'YYYY-MM-DD' en JavaScript, y en Uruguay está mal. toISOString() convierte a
 * UTC, y Uruguay va en UTC-3: todo lo que pase de las 21:00 ya cayó al día
 * siguiente en UTC.
 *
 *     cita del martes 09:00  ->  toISOString() dice martes      (bien)
 *     cita del martes 21:30  ->  toISOString() dice miércoles   (mal)
 *
 * De mañana anda; de noche se corre un día para adelante. Por eso el error
 * parecía aleatorio y sobrevivió tanto. Estaba en once lugares. Los que
 * importaban:
 *
 *   · el campo de fecha al reprogramar una cita — mostraba el día equivocado,
 *     y si guardabas sin mirar, la cita se movía de verdad
 *   · el modal de fecha de pago
 *   · la línea de tiempo del cliente, que agrupa por día
 *   · el alta de tareas en Mi Agenda: de noche elegías el 5 y nacía el 6
 *
 * vitest.config.js fija TZ='America/Montevideo' para que esto se pruebe en el
 * huso donde el error existe, sin importar dónde corran los tests.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('la conversión que rompía todo', () => {
  it('una cita de la noche NO se va al día siguiente', () => {
    const noche = new Date(2026, 7, 5, 21, 30)      // 5 de agosto, 21:30 local
    expect(noche.toISOString().split('T')[0]).toBe('2026-08-06')   // lo que hacía antes
    expect(toLocalDateKey(noche)).toBe('2026-08-05')               // lo que corresponde
  })

  it('el día se corre para ADELANTE, y sólo de noche', () => {
    // Uruguay es UTC-3 todo el año (no hay horario de verano desde 2015), asi
    // que pasar a UTC es SUMAR 3 horas. De 21:00 en adelante eso cruza la
    // medianoche. Antes del mediodia no pasa nada: por eso el error aparecia
    // "a veces" y era tan dificil de ver.
    expect(new Date(2026, 7, 5,  9, 0).toISOString().split('T')[0]).toBe('2026-08-05')  // manana: bien
    expect(new Date(2026, 7, 5, 21, 0).toISOString().split('T')[0]).toBe('2026-08-06')  // noche: mal
    expect(toLocalDateKey(new Date(2026, 7, 5, 21, 0))).toBe('2026-08-05')              // ahora bien
  })

  it('acepta un ISO string igual que un Date', () => {
    expect(toLocalDateKey('2026-08-05T21:30:00')).toBe('2026-08-05')
  })

  it('con basura devuelve vacío, no "Invalid Date"', () => {
    expect(toLocalDateKey('cualquier cosa')).toBe('')
  })

  it('todayKey da el día local de hoy', () => {
    const hoy = new Date()
    expect(todayKey()).toBe(
      `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`)
  })

  it('parseLocalDate no interpreta el texto como UTC', () => {
    // new Date('2026-08-05') da el 4 a las 21:00 en Uruguay.
    expect(new Date('2026-08-05').getDate()).toBe(4)
    expect(parseLocalDate('2026-08-05').getDate()).toBe(5)
  })
})

describe('ya no queda ningún uso peligroso en pantallas', () => {
  const ARCHIVOS = [
    ['components', 'screens', 'AppointmentDetailScreen.jsx'],
    ['components', 'screens', 'PersonalAgendaScreen.jsx'],
    ['components', 'screens', 'PatientTimeline.jsx'],
    ['components', 'screens', 'AuditLogScreen.jsx'],
    ['components', 'screens', 'ProductsScreen.jsx'],
    ['components', 'common', 'BackupManager.jsx'],
    ['utils', 'pdfReportGenerator.js'],
    ['utils', 'exportImport.js'],
  ]

  for (const f of ARCHIVOS) {
    it(f[f.length - 1], () => {
      expect(sinComentarios(leer(...f))).not.toMatch(/toISOString\(\)\.(split\('T'\)\[0\]|slice\(0, ?10\))/)
    })
  }
})

describe('reprogramar una cita muestra el día correcto', () => {
  const detalle = leer('components', 'screens', 'AppointmentDetailScreen.jsx')

  it('formatDateForInput usa la fecha local', () => {
    const bloque = detalle.slice(detalle.indexOf('const formatDateForInput'),
                                 detalle.indexOf('const formatPhoneForWhatsApp'))
    expect(bloque).toMatch(/toLocalDateKey\(dateStr\)/)
    expect(sinComentarios(bloque)).not.toMatch(/toISOString/)
  })
})

describe('el modal de fecha de pago recibe lo que le mandan', () => {
  const modal = leer('components', 'common', 'PaymentDateModal.jsx')

  it('acepta defaultDate y title', () => {
    // Estaban declarados en los dos lugares que lo usan y la función NO los
    // recibía: se perdían. "Editar fecha de pago" abría siempre con hoy, y si
    // confirmabas sin mirar pisabas la fecha real del cobro.
    expect(modal).toMatch(/PaymentDateModal\(\{[^}]*defaultDate[^}]*\}\)/)
    expect(modal).toMatch(/PaymentDateModal\(\{[^}]*title[^}]*\}\)/)
  })

  it('defaultDate manda sobre la fecha de hoy', () => {
    expect(modal).toMatch(/useState\(\s*defaultDate \|\| todayKey\(\)\s*\)/)
  })

  it('el título es el que le pasan, con "Registrar pago" de reserva', () => {
    expect(modal).toMatch(/\{title \|\| 'Registrar pago'\}/)
  })

  it('quien lo abre para editar le pasa la fecha guardada', () => {
    const detalle = leer('components', 'screens', 'AppointmentDetailScreen.jsx')
    expect(detalle).toMatch(/defaultDate=\{appointment\.paymentDate \? toLocalDateKey\(appointment\.paymentDate\) : todayKey\(\)\}/)
  })
})

describe('el PDF de cobros pendientes no depende de internet', () => {
  const pantalla = leer('components', 'screens', 'PendingPaymentsScreen.jsx')
  const generador = leer('utils', 'pdfReportGenerator.js')

  it('no baja nada de un CDN', () => {
    // Bajaba html2pdf de cloudflare al apretar el botón. Sin internet no pasaba
    // nada; y si cloudflare cambiaba el archivo, tampoco.
    const limpio = sinComentarios(pantalla)
    expect(limpio).not.toMatch(/cdnjs|cloudflare|createElement\('script'\)/)
    expect(limpio).not.toMatch(/html2pdf/)
  })

  it('usa el generador que ya venía adentro del programa', () => {
    expect(pantalla).toMatch(/import \{ generatePendingPaymentsReport \} from '\.\.\/\.\.\/utils\/pdfReportGenerator'/)
    expect(generador).toMatch(/export function generatePendingPaymentsReport/)
  })

  it('el generador reusa el encabezado y el pie de los demás reportes', () => {
    const bloque = generador.slice(generador.indexOf('export function generatePendingPaymentsReport'))
    expect(bloque).toMatch(/drawHeader\(/)
    expect(bloque).toMatch(/drawFooter\(/)
    expect(bloque).toMatch(/drawKPICards\(/)
  })

  it('aguanta una lista vacía sin romperse', () => {
    const bloque = generador.slice(generador.indexOf('export function generatePendingPaymentsReport'))
    expect(bloque).toMatch(/grupos\.length === 0/)
    expect(bloque).toMatch(/Array\.isArray\(groupedByClient\)/)
  })
})
