import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const store = require_('../electron/documentStore.cjs')

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-docs-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const dataUrl = (mime, texto) =>
  `data:${mime};base64,${Buffer.from(texto, 'utf8').toString('base64')}`

const PDF = dataUrl('application/pdf', 'contenido del estudio del paciente')

beforeEach(() => {
  fs.rmSync(path.join(raiz, 'client-documents'), { recursive: true, force: true })
  store.setRoot(raiz)
})

describe('guardar y leer adjuntos', () => {
  it('guarda un archivo en disco y devuelve sus metadatos', () => {
    const res = store.save('paciente-1', { name: 'estudio.pdf', mimeType: 'application/pdf' }, PDF)
    expect(res.ok).toBe(true)
    expect(res.doc.name).toBe('estudio.pdf')
    expect(res.doc.size).toBeGreaterThan(0)
  })

  it('los metadatos NO incluyen los bytes — eso es lo que libera la memoria', () => {
    store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    const lista = store.list('p1')
    expect(lista).toHaveLength(1)
    expect(lista[0].data).toBeUndefined()
    expect(lista[0].name).toBe('a.pdf')
  })

  it('el archivo queda realmente escrito en el disco', () => {
    const res = store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    const f = path.join(raiz, 'client-documents', 'p1', res.doc.fileName)
    expect(fs.existsSync(f)).toBe(true)
    expect(fs.statSync(f).size).toBe(res.doc.size)
  })

  it('read devuelve el contenido intacto', () => {
    const res = store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    const leido = store.read('p1', res.doc.id)
    expect(leido.ok).toBe(true)
    const texto = Buffer.from(leido.dataUrl.split(',')[1], 'base64').toString('utf8')
    expect(texto).toBe('contenido del estudio del paciente')
  })

  it('rechaza un nombre duplicado', () => {
    store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    const res = store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Ya existe/)
  })

  it('los adjuntos de un cliente no se mezclan con los de otro', () => {
    store.save('p1', { name: 'de-ana.pdf', mimeType: 'application/pdf' }, PDF)
    store.save('p2', { name: 'de-bruno.pdf', mimeType: 'application/pdf' }, PDF)
    expect(store.list('p1').map(d => d.name)).toEqual(['de-ana.pdf'])
    expect(store.list('p2').map(d => d.name)).toEqual(['de-bruno.pdf'])
  })

  it('un cliente sin adjuntos devuelve lista vacía, no error', () => {
    expect(store.list('inexistente')).toEqual([])
  })
})

describe('validaciones', () => {
  it('rechaza tipos de archivo no permitidos (nada de ejecutables)', () => {
    const res = store.save('p1', { name: 'virus.exe', mimeType: 'application/x-msdownload' },
                           dataUrl('application/x-msdownload', 'MZ'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no permitido/i)
  })

  it('rechaza un archivo vacío', () => {
    const res = store.save('p1', { name: 'vacio.pdf', mimeType: 'application/pdf' }, 'data:application/pdf;base64,')
    expect(res.ok).toBe(false)
  })

  it('rechaza archivos de más de 25 MB', () => {
    const grande = `data:application/pdf;base64,${'A'.repeat(40 * 1024 * 1024)}`
    expect(store.save('p1', { name: 'g.pdf', mimeType: 'application/pdf' }, grande).ok).toBe(false)
  })

  it('rechaza algo que no sea un data: URL', () => {
    expect(store.save('p1', { name: 'a.pdf' }, 'no soy un data url').ok).toBe(false)
  })
})

describe('seguridad — los ids vienen del renderer, son texto no confiable', () => {
  it('un patientId con ../ no escribe fuera de la carpeta de la app', () => {
    store.save('../../../etc/evil', { name: 'x.pdf', mimeType: 'application/pdf' }, PDF)

    // No se creó nada fuera de la raíz
    expect(fs.existsSync(path.join(raiz, '..', 'etc'))).toBe(false)

    // Y lo que se creó resuelve DENTRO de client-documents. Los separadores se
    // reemplazan por "_", así que ".._.._" es un nombre de carpeta común y
    // corriente: no navega hacia arriba. Esa es la propiedad que importa.
    const base = path.resolve(path.join(raiz, 'client-documents'))
    for (const d of fs.readdirSync(base)) {
      const resuelto = path.resolve(base, d)
      expect(resuelto.startsWith(base + path.sep)).toBe(true)
      expect(d).not.toContain(path.sep)
    }
  })

  it('un patientId con separadores de Windows tampoco escapa', () => {
    store.save('..\\..\\Windows\\System32', { name: 'x.pdf', mimeType: 'application/pdf' }, PDF)
    const base = path.resolve(path.join(raiz, 'client-documents'))
    for (const d of fs.readdirSync(base)) {
      expect(path.resolve(base, d).startsWith(base + path.sep)).toBe(true)
    }
  })

  it('un documentId con ../ no lee fuera de la carpeta', () => {
    expect(store.read('p1', '../../../etc/passwd').ok).toBe(false)
  })

  it('un patientId vacío no rompe nada', () => {
    expect(store.save('', { name: 'a.pdf' }, PDF).ok).toBe(false)
    expect(store.list('')).toEqual([])
  })
})

describe('borrado', () => {
  it('borra el archivo del disco, no sólo la referencia', () => {
    const res = store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    const f = path.join(raiz, 'client-documents', 'p1', res.doc.fileName)
    expect(fs.existsSync(f)).toBe(true)

    store.remove('p1', res.doc.id)
    expect(fs.existsSync(f)).toBe(false)
    expect(store.list('p1')).toEqual([])
  })

  it('borrar algo que no existe no revienta', () => {
    expect(store.remove('p1', 'no-existe').ok).toBe(true)
  })

  it('removeAll limpia todo el cliente', () => {
    store.save('p1', { name: 'a.pdf', mimeType: 'application/pdf' }, PDF)
    store.save('p1', { name: 'b.pdf', mimeType: 'application/pdf' }, PDF)
    store.removeAll('p1')
    expect(store.list('p1')).toEqual([])
    expect(fs.existsSync(path.join(raiz, 'client-documents', 'p1'))).toBe(false)
  })
})

describe('migración desde localStorage — acá no se puede perder nada', () => {
  const viejos = [
    { id: 1, name: 'analisis.pdf', mimeType: 'application/pdf', type: 'document',
      data: PDF, uploadDate: '2026-01-01T10:00:00.000Z' },
    { id: 2, name: 'foto.png', mimeType: 'image/png', type: 'image',
      data: dataUrl('image/png', 'bytes de la imagen'), uploadDate: '2026-02-01T10:00:00.000Z' },
  ]

  it('mueve los adjuntos al disco y autoriza borrar la clave vieja', () => {
    const res = store.migrate('p1', viejos)
    expect(res.migrados).toBe(2)
    expect(res.fallidos).toBe(0)
    expect(res.puedeBorrarse).toBe(true)
    expect(store.list('p1')).toHaveLength(2)
  })

  it('conserva el contenido exacto', () => {
    store.migrate('p1', viejos)
    const doc = store.list('p1').find(d => d.name === 'analisis.pdf')
    const leido = store.read('p1', doc.id)
    expect(Buffer.from(leido.dataUrl.split(',')[1], 'base64').toString('utf8'))
      .toBe('contenido del estudio del paciente')
  })

  it('conserva la fecha original de subida', () => {
    store.migrate('p1', viejos)
    const doc = store.list('p1').find(d => d.name === 'analisis.pdf')
    expect(doc.uploadDate).toBe('2026-01-01T10:00:00.000Z')
  })

  it('NO autoriza borrar la clave vieja si algún archivo falló', () => {
    const conRoto = [...viejos, { id: 3, name: 'roto.pdf', mimeType: 'application/pdf', data: null }]
    const res = store.migrate('p1', conRoto)
    expect(res.fallidos).toBeGreaterThan(0)
    expect(res.puedeBorrarse).toBe(false)   // los datos viejos se conservan
  })

  it('es idempotente: correrla dos veces no duplica', () => {
    store.migrate('p1', viejos)
    store.migrate('p1', viejos)
    expect(store.list('p1')).toHaveLength(2)
  })

  it('una lista vacía es un caso normal, no un error', () => {
    const res = store.migrate('p1', [])
    expect(res.ok).toBe(true)
    expect(res.puedeBorrarse).toBe(true)
  })
})

describe('capacidad — el motivo de todo esto', () => {
  it('guarda 20 MB de adjuntos, muy por encima del techo de localStorage', () => {
    // localStorage se agota entre 5 y 10 MB. Antes, dos PDFs de 2 MB dejaban a
    // la app entera sin poder guardar pedidos ni clientes.
    const unMega = `data:application/pdf;base64,${Buffer.alloc(1024 * 1024, 65).toString('base64')}`
    for (let i = 0; i < 20; i++) {
      const res = store.save('p1', { name: `doc-${i}.pdf`, mimeType: 'application/pdf' }, unMega)
      expect(res.ok).toBe(true)
    }
    expect(store.list('p1')).toHaveLength(20)
    const total = store.list('p1').reduce((s, d) => s + d.size, 0)
    expect(total).toBeGreaterThan(20 * 1024 * 1024 * 0.9)
  })
})
