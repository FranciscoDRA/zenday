import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * El respaldo mezclaba los dos modos, y restaurar borraba datos del otro.
 *
 * Dos fallas encadenadas:
 *
 *   a) App.jsx le pasaba `clients={[...patientsPro, ...patientsEnt]}`, pero al
 *      restaurar `setClients` escribe TODO en la lista del modo actual. Con 40
 *      pacientes y 12 clientes comerciales, restaurar estando en profesional
 *      dejaba 52 personas en la lista clínica.
 *
 *   b) Le pasaba `appointments={sharedProps.appointments}`, que es
 *      appointmentsByMode — la lista YA FILTRADA. Al restaurar se reemplaza el
 *      array completo, así que un respaldo hecho en profesional borraba todos
 *      los pedidos de emprendedor. Del estado y de localStorage, porque el
 *      writeCollection va con allowEmpty:true.
 *
 * Ahora el respaldo se lleva los datos del modo actual y el array completo de
 * pedidos, guarda de qué modo es, y se niega a restaurarse sobre el otro.
 *
 * Esto importa más desde que emprendedor dejó de ser "un modo que quedó" para
 * ser un nivel de licencia que se vende: pasó de ser un bug propio a ser un
 * bug de los clientes.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const app    = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
const backup = fs.readFileSync(path.join(SRC, 'components', 'common', 'BackupManager.jsx'), 'utf8')

/**
 * Quita comentarios antes de buscar.
 *
 * Sin esto, las aserciones negativas se disparan con los comentarios que
 * explican el bug — que citan textualmente el código viejo. Ya pasó dos veces
 * en esta suite: un test que falla por su propia documentación.
 */
const sinComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** El bloque JSX donde se monta BackupManager. */
const bloqueBackup = app.slice(app.indexOf('<BackupManager'), app.indexOf('</>', app.indexOf('<BackupManager')))

describe('el respaldo no mezcla los modos', () => {
  it('NO concatena los clientes de los dos modos', () => {
    expect(sinComentarios(app)).not.toMatch(/\[\s*\.\.\.patientsPro\s*,\s*\.\.\.patientsEnt\s*\]/)
  })

  it('se lleva los clientes del modo actual', () => {
    expect(app).toMatch(/userMode === 'entrepreneur' \? patientsEnt : patientsPro/)
    expect(bloqueBackup).toMatch(/clients=\{clientesDelModo\}/)
  })

  it('se lleva los pedidos COMPLETOS, no la vista filtrada', () => {
    // sharedProps.appointments es appointmentsByMode: si el respaldo se lo
    // lleva filtrado, restaurar borra los del otro modo.
    expect(bloqueBackup).not.toMatch(/appointments=\{sharedProps\.appointments\}/)
    expect(bloqueBackup).toMatch(/appointments=\{Array\.isArray\(appointments\)/)
  })
})

describe('el respaldo sabe de qué modo es', () => {
  it('lo guarda en metadata, no en el payload', () => {
    // El checksum se calcula sobre el payload: meterlo ahí invalidaría todos
    // los respaldos que el usuario ya tiene guardados.
    const limpio = sinComentarios(backup)

    expect(limpio).toContain('userMode: options.userMode')

    // El payload va desde `const payload = {` hasta la línea del checksum,
    // que es lo primero que viene después. Recortar hasta el primer `}` no
    // servía: se cortaba en el `{}` de `settings: data.settings || {}`.
    const desde = limpio.indexOf('const payload = {')
    const payload = limpio.slice(desde, limpio.indexOf('generateChecksum', desde))
    expect(payload).toContain('products:')      // es el bloque correcto
    expect(payload).not.toContain('userMode')
  })

  it('los tres caminos que crean respaldos pasan el modo', () => {
    // manual, automático y el de emergencia previo a restaurar.
    // Se toma una ventana desde cada llamada en vez de casar paréntesis: la
    // del respaldo manual va en varias líneas y `[^)]*` cortaba antes de
    // llegar al argumento.
    const limpio = sinComentarios(backup)
    const llamadas = []
    let i = limpio.indexOf('BackupService.createBackup(')
    while (i !== -1) {
      llamadas.push(limpio.slice(i, i + 200))
      i = limpio.indexOf('BackupService.createBackup(', i + 1)
    }
    expect(llamadas.length).toBe(3)
    for (const l of llamadas) expect(l).toContain('userMode')
  })
})

describe('restaurar sobre el otro modo se rechaza', () => {
  it('compara el modo del respaldo con el actual antes de tocar nada', () => {
    const bloque = backup.slice(backup.indexOf('const executeRestore'),
                                backup.indexOf('if (mode === \'full\')'))
    expect(bloque).toContain('metadata?.userMode')
    expect(bloque).toMatch(/modoDelRespaldo !== userMode/)
    // y frena ANTES de crear el respaldo de emergencia y de escribir nada
    expect(bloque.indexOf('modoDelRespaldo !== userMode'))
      .toBeLessThan(bloque.indexOf('restoreFull') === -1 ? bloque.length : bloque.indexOf('restoreFull'))
  })

  it('los respaldos viejos sin modo se siguen pudiendo restaurar', () => {
    // Negarse con los que el usuario ya tenía guardados lo dejaría sin poder
    // restaurar nada. La guarda sólo actúa si el campo existe.
    const bloque = backup.slice(backup.indexOf('const executeRestore'),
                                backup.indexOf('if (mode === \'full\')'))
    expect(bloque).toMatch(/if \(modoDelRespaldo && userMode &&/)
  })
})
