// src/utils/datosDeEjemplo.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  POR QUÉ EXISTE ESTO
//
//  Quien instala ZenDay crea su negocio y cae en un Panel con todo en $0 y ocho
//  menús vacíos. Tiene 14 días para decidir si paga, y en ninguno de esos días
//  ve cómo se ve el programa FUNCIONANDO — salvo que cargue treinta clientes a
//  mano primero, que es justo lo que no va a hacer para evaluar algo.
//
//  Con un juego de datos de ejemplo, el Panel muestra plata, la agenda muestra
//  gente, Finanzas tiene con qué comparar el mes anterior y Pagos Pendientes
//  tiene algo pendiente. En treinta segundos se entiende el producto.
//
//  DOS REGLAS QUE NO SE NEGOCIAN
//
//  1. Todo lo generado acá lleva `origenEjemplo: true`. Borrar los ejemplos
//     filtra por ese campo y sólo por ese campo, así que es imposible que se
//     lleve puesto un dato real por más parecido que sea.
//
//  2. Los ids son fijos y con prefijo `ejemplo-`. Eso hace que cargar dos veces
//     no duplique nada, que se reconozcan de un vistazo en la consola de
//     Firebase, y que el borrado sea exacto.
//
//  Nada acá adentro usa Date.now() ni Math.random(): la fecha entra por
//  parámetro. Si no, los tests darían distinto según el día y la hora en que
//  corran, que es exactamente el bug que ya nos comió una tarde.
// ─────────────────────────────────────────────────────────────────────────────

/** Campo que marca un registro como de ejemplo. Nada más decide el borrado. */
export const MARCA = 'origenEjemplo'

export const esEjemplo = (x) => x?.[MARCA] === true

/** Quita los de ejemplo de una lista, dejando los reales intactos. */
export const sinEjemplos = (lista) =>
  (Array.isArray(lista) ? lista : []).filter(x => !esEjemplo(x))

/** Cuántos de ejemplo hay en una lista. */
export const contarEjemplos = (lista) =>
  (Array.isArray(lista) ? lista : []).filter(esEjemplo).length

// ─── Fechas, siempre en hora local ───────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')

/** Date → 'YYYY-MM-DD' local. Nunca toISOString(): eso pasa a UTC. */
const clave = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Date + hora → 'YYYY-MM-DDTHH:mm:00' local, que es como los guarda la app. */
const momento = (d, hora, minuto = 0) =>
  `${clave(d)}T${pad(hora)}:${pad(minuto)}:00`

/** `hoy` corrido n días (negativo = pasado). No muta el original. */
const correr = (hoy, n) => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  d.setDate(d.getDate() + n)
  return d
}

/** El mismo día de hace un mes, para que la comparativa tenga con qué comparar. */
const mesAnterior = (hoy, dia) => new Date(hoy.getFullYear(), hoy.getMonth() - 1, dia)

// ─── Los datos ───────────────────────────────────────────────────────────────

const PERSONAS = [
  { nom: 'Lucía Fernández',  tel: '099 412 887', mail: 'lucia.fernandez@mail.com' },
  { nom: 'Martín Rodríguez', tel: '098 771 203', mail: 'martin.rod@mail.com' },
  { nom: 'Valentina Souza',  tel: '091 335 640', mail: 'vsouza@mail.com' },
  { nom: 'Diego Pereyra',    tel: '094 508 112', mail: 'diego.pereyra@mail.com' },
  { nom: 'Camila Antúnez',   tel: '092 640 771', mail: 'cami.antunez@mail.com' },
  { nom: 'Rodrigo Silva',    tel: '096 227 495', mail: 'rsilva@mail.com' },
]

const SERVICIOS_PRO = [
  { titulo: 'Sesión',            precio: 1800, dur: 50 },
  { titulo: 'Primera consulta',  precio: 2200, dur: 60 },
  { titulo: 'Control',           precio: 1400, dur: 30 },
]

const ARTICULOS_EMP = [
  { titulo: 'Pedido a medida',   precio: 2600, dur: 60 },
  { titulo: 'Pedido del catálogo', precio: 1500, dur: 30 },
]

const PRODUCTOS = [
  { nom: 'Producto A',  cod: 'A-100', precio: 890,  stock: 12, cat: 'Línea principal' },
  { nom: 'Producto B',  cod: 'B-220', precio: 1450, stock: 4,  cat: 'Línea principal' },
  { nom: 'Producto C',  cod: 'C-045', precio: 620,  stock: 0,  cat: 'Accesorios' },
  { nom: 'Producto D',  cod: 'D-310', precio: 2100, stock: 27, cat: 'Premium' },
  { nom: 'Producto E',  cod: 'E-008', precio: 340,  stock: 60, cat: 'Accesorios' },
]

const GASTOS = [
  { desc: 'Alquiler del local',   monto: 18000, cat: 'Alquiler' },
  { desc: 'Luz y agua',           monto: 3400,  cat: 'Servicios' },
  { desc: 'Insumos',              monto: 5200,  cat: 'Insumos' },
  { desc: 'Publicidad en redes',  monto: 2500,  cat: 'Marketing' },
]

/**
 * Genera el juego completo de datos de ejemplo.
 *
 * @param {object}  opciones
 * @param {string}  opciones.userMode  'professional' | 'entrepreneur'
 * @param {Date}    opciones.hoy       fecha de referencia (obligatoria: sin esto
 *                                     los tests dependerían del reloj)
 * @returns {{patients:Array, appointments:Array, products:Array, expenses:Array}}
 */
export function generarEjemplos({ userMode = 'professional', hoy } = {}) {
  if (!(hoy instanceof Date) || Number.isNaN(hoy.getTime())) {
    throw new Error('generarEjemplos necesita una fecha `hoy` válida')
  }

  const esEmp = userMode === 'entrepreneur'
  const catalogo = esEmp ? ARTICULOS_EMP : SERVICIOS_PRO
  const marca = { [MARCA]: true }

  // ── Clientes ───────────────────────────────────────────────────────────────
  const patients = PERSONAS.map((p, i) => ({
    id: `ejemplo-cliente-${i + 1}`,
    name: p.nom,
    phone: p.tel,
    email: p.mail,
    address: '',
    birthDate: '',
    observations: i === 0 ? 'Cliente de ejemplo — se puede borrar desde Configuración.' : '',
    notes: [],
    attachments: [],
    ...marca,
  }))

  // ── Citas / pedidos ────────────────────────────────────────────────────────
  //
  // El reparto está pensado para que cada pantalla tenga algo que mostrar:
  //   · hoy            → el Panel y la Agenda no aparecen vacíos
  //   · cobradas       → Finanzas muestra ingresos
  //   · sin cobrar     → Pagos Pendientes tiene con qué llenarse
  //   · mes anterior   → la comparativa mensual tiene contra qué comparar
  //
  const plan = [
    // [díasDesdeHoy, hora, índiceCliente, índiceServicio, estado, cobrada]
    [ 0,  9, 0, 0, 'completed', true ],
    [ 0, 11, 1, 1, 'completed', false],   // atendida, todavía sin cobrar
    [ 0, 16, 2, 0, 'confirmed', false],   // por venir
    [ 1, 10, 3, 2, 'scheduled', false],
    [ 2, 15, 4, 0, 'scheduled', false],
    [-2, 10, 5, 0, 'completed', true ],
    [-3, 17, 0, 1, 'completed', true ],
    [-5, 12, 2, 2, 'completed', false],   // deuda vieja
    [-8, 14, 3, 0, 'completed', true ],
  ]

  const appointments = plan.map(([dias, hora, iCli, iSrv, estado, cobrada], i) => {
    const dia = correr(hoy, dias)
    const srv = catalogo[iSrv % catalogo.length]
    const cli = patients[iCli]
    const inicio = momento(dia, hora)
    const fin = momento(dia, hora + Math.floor(srv.dur / 60), srv.dur % 60)

    return {
      id: `ejemplo-cita-${i + 1}`,
      patientId: cli.id,
      patientName: cli.name,
      title: srv.titulo,
      startTime: inicio,
      endTime: fin,
      duration: srv.dur,
      price: srv.precio,
      status: esEmp && estado === 'completed' ? 'delivered'
            : esEmp && estado === 'confirmed' ? 'pending'
            : esEmp && estado === 'scheduled' ? 'pending'
            : estado,
      paid: cobrada,
      // La fecha de cobro importa: es la que decide en qué mes entra la plata.
      ...(cobrada ? { paymentDate: inicio } : {}),
      notes: '',
      ...marca,
    }
  })

  // Tres del mes pasado, para que la comparativa no arranque contra cero.
  const previas = [[4, 11, 1, 0], [12, 16, 3, 1], [21, 10, 5, 2]]
  previas.forEach(([dia, hora, iCli, iSrv], i) => {
    const d = mesAnterior(hoy, dia)
    const srv = catalogo[iSrv % catalogo.length]
    const cli = patients[iCli]
    const inicio = momento(d, hora)
    appointments.push({
      id: `ejemplo-cita-previa-${i + 1}`,
      patientId: cli.id,
      patientName: cli.name,
      title: srv.titulo,
      startTime: inicio,
      endTime: momento(d, hora + 1),
      duration: srv.dur,
      price: srv.precio,
      status: esEmp ? 'delivered' : 'completed',
      paid: true,
      paymentDate: inicio,
      notes: '',
      ...marca,
    })
  })

  // ── Artículos ──────────────────────────────────────────────────────────────
  const products = PRODUCTOS.map((p, i) => ({
    id: `ejemplo-articulo-${i + 1}`,
    name: p.nom,
    code: p.cod,
    price: p.precio,
    stock: p.stock,
    category: p.cat,
    description: '',
    ...marca,
  }))

  // ── Gastos: este mes y el anterior ─────────────────────────────────────────
  const expenses = []
  GASTOS.forEach((g, i) => {
    expenses.push({
      id: `ejemplo-gasto-${i + 1}`,
      description: g.desc,
      amount: g.monto,
      category: g.cat,
      date: clave(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(3 + i * 5, 28))),
      notes: '',
      ...marca,
    })
  })
  GASTOS.slice(0, 2).forEach((g, i) => {
    expenses.push({
      id: `ejemplo-gasto-previo-${i + 1}`,
      description: g.desc,
      amount: g.monto,
      category: g.cat,
      date: clave(mesAnterior(hoy, 5 + i * 7)),
      notes: '',
      ...marca,
    })
  })

  return { patients, appointments, products, expenses }
}
