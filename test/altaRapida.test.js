import { describe, it, expect } from 'vitest'
import {
  interpretar, parsearFecha, parsearHora, parsearPrecioExplicito,
  buscarPorNombre, normalizar, aInicio, describir,
} from '../src/utils/altaRapida.js'

/**
 * Escribir una línea en vez de llenar catorce campos.
 *
 * Suena el teléfono: "¿me das hora el jueves a las cuatro?". Hoy eso son seis
 * pasos y un formulario de 14 campos, con la persona esperando en la línea.
 * Con esto es `lucia jueves 16 corte` y Enter.
 *
 * Los dos principios que mandan sobre "ser inteligente", y que estos tests
 * defienden:
 *
 *   1. PREDECIBLE antes que astuto. Si el usuario no puede anticipar cómo se
 *      interpreta lo que escribe, deja de usarlo a la tercera sorpresa.
 *   2. NUNCA INVENTAR. Lo que no se entiende queda vacío y se avisa. Un turno
 *      con un precio adivinado es peor que un campo en blanco: el error se
 *      descubre a fin de mes, cuando la caja no cierra.
 *
 * HOY es jueves 27 de agosto de 2026, fijo. Si dependiera del reloj, estos
 * tests darían distinto según el día en que corran.
 */

const HOY = new Date(2026, 7, 27, 10, 0)

const CLIENTES = [
  { id: '1', name: 'Lucía Fernández' },
  { id: '2', name: 'Martín Rodríguez' },
  { id: '3', name: 'Juan Carlos Pérez' },
  { id: '4', name: 'Ana' },
]
const ARTICULOS = [
  { id: 'a', name: 'Corte',  price: 800 },
  { id: 'b', name: 'Color',  price: 2500 },
  { id: 'c', name: 'Oso Saxofonista', price: 2600 },
]

const leer = (frase) => interpretar(frase, { clientes: CLIENTES, articulos: ARTICULOS, hoy: HOY })

// ─────────────────────────────────────────────────────────────────────────────
//  La frase completa
// ─────────────────────────────────────────────────────────────────────────────
describe('la frase que se escribe atendiendo el teléfono', () => {
  it('"lucia jueves 16 corte" se entiende entera', () => {
    const r = leer('lucia jueves 16 corte')
    expect(r.cliente.name).toBe('Lucía Fernández')
    expect(r.fechaClave).toBe('2026-09-03')
    expect(r.hora).toEqual({ hora: 16, minuto: 0 })
    expect(r.articulo.name).toBe('Corte')
    expect(r.precio).toBe(800)          // sale del artículo
    expect(r.faltantes).toEqual([])
  })

  it('el orden de las palabras no importa', () => {
    const a = leer('lucia jueves 16 corte')
    const b = leer('corte 16 lucia jueves')
    const c = leer('jueves lucia corte 16')
    for (const r of [b, c]) {
      expect(r.cliente.id).toBe(a.cliente.id)
      expect(r.fechaClave).toBe(a.fechaClave)
      expect(r.hora).toEqual(a.hora)
      expect(r.articulo.id).toBe(a.articulo.id)
    }
  })

  it('un precio escrito a mano le gana al del artículo', () => {
    // El del catálogo es la sugerencia; lo que se escribe es la decisión.
    expect(leer('lucia jueves 16 corte $1200').precio).toBe(1200)
  })

  it('sirve igual para un pedido de emprendedor', () => {
    const r = leer('ana viernes oso')
    expect(r.cliente.name).toBe('Ana')
    expect(r.articulo.name).toBe('Oso Saxofonista')
    expect(r.precio).toBe(2600)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Nunca inventar
// ─────────────────────────────────────────────────────────────────────────────
describe('lo que no entiende lo deja vacío y lo dice', () => {
  it('sin hora ni precio, los enumera', () => {
    const r = leer('lucia hoy')
    expect(r.hora).toBeNull()
    expect(r.precio).toBeNull()
    expect(r.faltantes).toEqual(['hora', 'precio'])
  })

  it('sin cliente no se ofrece crear', () => {
    // Un turno sin cliente no es un turno. Mejor abrir el formulario.
    const r = leer('corte mañana 11')
    expect(r.cliente).toBeNull()
    expect(r.entendido).toBe(false)
    expect(r.faltantes).toContain('cliente')
  })

  it('sin fecha tampoco', () => {
    expect(leer('lucia corte').entendido).toBe(false)
  })

  it('con cliente y fecha ya alcanza para ofrecerlo', () => {
    // El resto se completa en el formulario, que igual abre con lo entendido.
    expect(leer('lucia hoy').entendido).toBe(true)
  })

  it('un nombre que no existe NO se aproxima a cualquiera', () => {
    const r = leer('zzzz hoy')
    expect(r.cliente).toBeNull()
  })

  it('texto vacío o basura no rompe', () => {
    for (const s of ['', '   ', '!!!', '???']) {
      expect(() => leer(s)).not.toThrow()
      expect(leer(s).entendido).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  La única ambigüedad real
// ─────────────────────────────────────────────────────────────────────────────
describe('"16" ¿son las cuatro de la tarde o dieciséis pesos?', () => {
  it('un número de 0 a 23 sin hora previa es la HORA', () => {
    expect(leer('lucia hoy 16').hora).toEqual({ hora: 16, minuto: 0 })
  })

  it('el segundo número ya es el precio', () => {
    const r = leer('lucia hoy 16 900')
    expect(r.hora).toEqual({ hora: 16, minuto: 0 })
    expect(r.precio).toBe(900)
  })

  it('un número mayor a 23 es precio aunque no haya hora', () => {
    const r = leer('lucia hoy 900')
    expect(r.hora).toBeNull()
    expect(r.precio).toBe(900)
  })

  it('con $ se fuerza a precio, aunque sea chico', () => {
    // La salida para quien cobra $16: escribirlo con signo y se acabó la duda.
    const r = leer('lucia hoy $16')
    expect(r.precio).toBe(16)
    expect(r.hora).toBeNull()
  })

  it('si ya hay hora explícita, el número chico es precio', () => {
    const r = leer('lucia hoy 9:30 20')
    expect(r.hora).toEqual({ hora: 9, minuto: 30 })
    expect(r.precio).toBe(20)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Fechas
// ─────────────────────────────────────────────────────────────────────────────
describe('las fechas', () => {
  const clave = (t) => { const d = parsearFecha(t, HOY); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null }

  it('hoy, mañana, pasado', () => {
    expect(clave('hoy')).toBe('2026-08-27')
    expect(clave('mañana')).toBe('2026-08-28')
    expect(clave('manana')).toBe('2026-08-28')   // sin acento, como se escribe rápido
    expect(clave('pasado')).toBe('2026-08-29')
  })

  it('un día de la semana es el PRÓXIMO, no el de hoy', () => {
    // Hoy es jueves. "jueves" tiene que ser el que viene: quien quiere hoy
    // escribe "hoy", que es más corto y no deja lugar a duda.
    expect(clave('jueves')).toBe('2026-09-03')
    expect(clave('viernes')).toBe('2026-08-28')
    expect(clave('lunes')).toBe('2026-08-31')
  })

  it('las abreviaturas también', () => {
    expect(clave('vie')).toBe('2026-08-28')
    expect(clave('lun')).toBe('2026-08-31')
  })

  it('3/9 y 3-9', () => {
    expect(clave('3/9')).toBe('2026-09-03')
    expect(clave('3-9')).toBe('2026-09-03')
  })

  it('una fecha ya pasada sin año se toma del año que viene', () => {
    // El "3/1" escrito en agosto es el enero que viene, no siete meses atrás.
    expect(clave('3/1')).toBe('2027-01-03')
  })

  it('con año explícito se respeta', () => {
    expect(clave('3/1/2026')).toBe('2026-01-03')
  })

  it('fechas imposibles se rechazan', () => {
    expect(clave('45/9')).toBeNull()
    expect(clave('3/45')).toBeNull()
    expect(clave('cualquiera')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Horas
// ─────────────────────────────────────────────────────────────────────────────
describe('las horas', () => {
  it('los formatos que se escriben de verdad', () => {
    expect(parsearHora('16:30')).toEqual({ hora: 16, minuto: 30 })
    expect(parsearHora('16.30')).toEqual({ hora: 16, minuto: 30 })
    expect(parsearHora('16h30')).toEqual({ hora: 16, minuto: 30 })
    expect(parsearHora('16h')).toEqual({ hora: 16, minuto: 0 })
    expect(parsearHora('16hs')).toEqual({ hora: 16, minuto: 0 })
    expect(parsearHora('4pm')).toEqual({ hora: 16, minuto: 0 })
    expect(parsearHora('9am')).toEqual({ hora: 9, minuto: 0 })
    expect(parsearHora('12am')).toEqual({ hora: 0, minuto: 0 })
    expect(parsearHora('12pm')).toEqual({ hora: 12, minuto: 0 })
  })

  it('un número pelado NO es hora acá', () => {
    // Lo decide interpretar(), que sabe si ya hay hora y si puede ser precio.
    expect(parsearHora('16')).toBeNull()
  })

  it('horas imposibles se rechazan', () => {
    expect(parsearHora('25:00')).toBeNull()
    expect(parsearHora('16:99')).toBeNull()
    expect(parsearHora('15pm')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Nombres
// ─────────────────────────────────────────────────────────────────────────────
describe('encontrar al cliente', () => {
  it('sin acentos y en minúscula', () => {
    expect(leer('lucia hoy').cliente.name).toBe('Lucía Fernández')
    expect(leer('LUCIA hoy').cliente.name).toBe('Lucía Fernández')
  })

  it('por el apellido también', () => {
    expect(leer('rodriguez hoy').cliente.name).toBe('Martín Rodríguez')
  })

  it('un nombre compuesto no se parte al medio', () => {
    // Se prueban las combinaciones largas primero: "juan carlos" antes que "juan".
    expect(leer('juan carlos hoy').cliente.name).toBe('Juan Carlos Pérez')
  })

  it('una sola letra no alcanza para elegir a nadie', () => {
    // Si no, escribir "a" elegiría a Ana y sería imposible de predecir.
    expect(buscarPorNombre(['a'], CLIENTES)).toBeNull()
  })

  it('normalizar saca acentos', () => {
    expect(normalizar('Lucía Fernández')).toBe('lucia fernandez')
    expect(normalizar(null)).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Salida
// ─────────────────────────────────────────────────────────────────────────────
describe('lo que sale para guardar', () => {
  it('la fecha va en hora LOCAL, nunca en UTC', () => {
    // toISOString() correría el día, que es el bug que ya nos costó una tarde.
    const r = leer('lucia jueves 16 corte')
    expect(aInicio(r)).toBe('2026-09-03T16:00:00')
  })

  it('sin hora, arranca a las 9', () => {
    expect(aInicio(leer('lucia hoy'))).toBe('2026-08-27T09:00:00')
  })

  it('sin fecha no hay inicio', () => {
    expect(aInicio({ fecha: null })).toBeNull()
  })

  it('describir da algo legible', () => {
    expect(describir(leer('lucia jueves 16 corte'))).toMatch(/jueves.*16:00/)
  })
})

describe('la fecha entra por parámetro, no del reloj', () => {
  it('sin fecha válida avisa en vez de inventar', () => {
    expect(() => interpretar('lucia hoy', { clientes: CLIENTES })).toThrow(/fecha/i)
    expect(() => interpretar('lucia hoy', { hoy: 'jueves' })).toThrow(/fecha/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Cableado: Ctrl+K → formulario cargado
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leerArch = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('está enchufado al Ctrl+K que ya existía', () => {
  const buscador = leerArch('components', 'common', 'GlobalSearch.jsx')
  const app      = leerArch('App.jsx')
  const nueva    = leerArch('components', 'screens', 'NewAppointmentScreen.jsx')
  const css      = leerArch('App.css')

  it('la búsqueda interpreta lo que se escribe', () => {
    expect(buscador).toMatch(/import \{ interpretar, describir, aInicio \}/)
    expect(buscador).toMatch(/interpretar\(query, \{ clientes: patients, articulos: products/)
  })

  it('interpreta sobre el texto SIN retardo', () => {
    // Buscar puede esperar 300ms porque recorre listas grandes. Sugerir crear
    // no: tiene que responder mientras se escribe, o se siente roto.
    const bloque = buscador.slice(buscador.indexOf('const altaRapida = useMemo'),
                                  buscador.indexOf('const confirmarAlta'))
    expect(bloque).toMatch(/\[query, patients, products, onAltaRapida\]/)
    expect(bloque).not.toMatch(/debounced/)
  })

  it('una frase rara nunca tira abajo la búsqueda', () => {
    const bloque = buscador.slice(buscador.indexOf('const altaRapida = useMemo'),
                                  buscador.indexOf('const confirmarAlta'))
    expect(bloque).toMatch(/try \{/)
    expect(bloque).toMatch(/catch/)
  })

  it('Enter crea, salvo que se haya bajado a un resultado', () => {
    // Sin la condición de `focused`, bajar con las flechas y apretar Enter
    // crearía un turno en vez de abrir el resultado marcado.
    expect(buscador).toMatch(/e\.key === 'Enter' && altaRapida && focused === -1/)
  })

  it('la tarjeta va DENTRO del desplegable, no flotando aparte', () => {
    // Las dos eran position:absolute con top:100% y se superponían.
    expect(sinComentarios(css)).not.toMatch(/\.alta-rapida \{[^}]*position:\s*absolute/)
    const i = buscador.indexOf('className="search-results"')
    const j = buscador.indexOf('</div>', buscador.indexOf('alta-rapida-enter'))
    expect(buscador.indexOf('className="alta-rapida"')).toBeGreaterThan(i)
    expect(j).toBeGreaterThan(0)
  })

  it('el desplegable se abre aunque no haya resultados', () => {
    // Escribir un cliente que existe + una fecha no encuentra nada que buscar,
    // y es justo cuando se quiere dar de alta.
    expect(buscador).toMatch(/isOpen && \(results\.length > 0 \|\| altaRapida\)/)
  })

  it('"sin resultados" no convive con la sugerencia', () => {
    expect(buscador).toMatch(/results\.length === 0 && !altaRapida/)
  })

  it('App.jsx abre el formulario con lo entendido', () => {
    expect(app).toMatch(/onAltaRapida=\{handleAltaRapida\}/)
    expect(app).toMatch(/nav\.navigate\('new', \{ prellenado \}\)/)
  })

  it('el formulario siembra los campos que llegaron', () => {
    expect(nueva).toMatch(/const pre = params\?\.prellenado \|\| null/)
    expect(nueva).toMatch(/patientId:\s*pre\?\.patientId/)
    expect(nueva).toMatch(/price:\s*pre\?\.price != null \? String\(pre\.price\) : ''/)
  })

  it('la fecha NO se vuelve a pasar por new Date()', () => {
    // Ya viene 'YYYY-MM-DDTHH:mm:00' en hora local. Parsearla otra vez sería
    // reabrir la puerta al bug de UTC que corría el día.
    // El `if` de arriba ya garantiza que existe, asi que el return no repite
    // los `?.`. Se busca el corte, que es lo que importa.
    expect(nueva).toMatch(/prellenado\.startTime\.slice\(0, 10\)/)
    expect(nueva).toMatch(/prellenado\.startTime\.slice\(11, 16\)/)
  })

  it('el CSS define todas las clases que usa la tarjeta', () => {
    const usadas = [...buscador.matchAll(/className="(alta-rapida[^"]*)"/g)].flatMap(m => m[1].split(/\s+/))
    for (const c of new Set(usadas)) expect(css, `falta .${c}`).toMatch(new RegExp(`\\.${c}\\b`))
  })
})
