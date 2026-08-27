import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * PÉRDIDA DE DATOS: los clientes del otro modo se borraban en cada arranque.
 *
 * QUÉ PASABA
 * ──────────
 * Los ocho lugares de App.jsx que cargan clientes hacen todos lo mismo:
 *
 *     if (userMode === 'entrepreneur') setPatientsEnt(...)
 *     else                             setPatientsPro(...)
 *
 * O sea que sólo se llena la lista del modo actual. La otra se queda en el []
 * con el que arranca el useState — nunca se carga desde el disco.
 *
 * Y la persistencia escribía LAS DOS, siempre:
 *
 *     useEffect(() => {
 *       if (!loaded) return
 *       writeJSON(getStorageKey('patients', 'professional'), patientsPro)
 *     }, [patientsPro, loaded])
 *
 *     useEffect(() => {
 *       if (!loaded) return
 *       writeJSON(getStorageKey('patients', 'entrepreneur'), patientsEnt)
 *     }, [patientsEnt, loaded])
 *
 * Secuencia real abriendo la app en modo profesional:
 *
 *   1. patientsPro = [], patientsEnt = []
 *   2. se cargan los clientes profesionales  -> setPatientsPro(los 40 reales)
 *   3. patientsEnt sigue en []               <- nadie lo carga nunca
 *   4. loaded pasa a true
 *   5. efecto 1: guarda los 40 profesionales    OK
 *   6. efecto 2: guarda []  sobre los de emprendedor    <-- SE BORRAN
 *
 * Y al revés igual. Cada vez que abrías la app, los clientes del modo en el que
 * NO estabas desaparecían del disco. Sin aviso, sin error, sin nada.
 *
 * EL ARREGLO
 * ──────────
 * Un solo efecto que guarda únicamente la lista del modo que de verdad se
 * cargó. La del otro modo no se toca y sigue en el disco.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')

const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const limpio = sinComentarios(app)

describe('nunca se escribe la lista de un modo que no se cargó', () => {
  it('no se guarda "professional" con el nombre del modo escrito a mano', () => {
    // Escribir el modo como literal es lo que permitía guardar la lista
    // equivocada. El modo tiene que salir de `userMode`.
    expect(limpio).not.toMatch(/writeJSON\(getStorageKey\('patients',\s*'professional'\)/)
  })

  it('tampoco "entrepreneur"', () => {
    expect(limpio).not.toMatch(/writeJSON\(getStorageKey\('patients',\s*'entrepreneur'\)/)
  })

  it('hay UN solo efecto que persiste clientes', () => {
    const escrituras = limpio.match(/writeJSON\(getStorageKey\('patients'[^)]*\)/g) || []
    expect(escrituras).toHaveLength(1)
  })

  it('guarda la lista del modo actual', () => {
    expect(limpio).toMatch(/writeJSON\(getStorageKey\('patients',\s*userMode\),\s*lista\)/)
    expect(limpio).toMatch(/const lista = userMode === 'entrepreneur' \? patientsEnt : patientsPro/)
  })

  it('el efecto reacciona a las dos listas y al modo', () => {
    // Si faltara `userMode` en las dependencias, al cambiar de modo se seguiría
    // guardando bajo la clave del modo anterior: el mismo desastre con otra cara.
    const i = limpio.indexOf("writeJSON(getStorageKey('patients', userMode)")
    const deps = limpio.slice(i).match(/\}, \[([^\]]*)\]\)/)
    expect(deps, 'no encontré las dependencias del efecto').not.toBeNull()
    for (const d of ['patientsPro', 'patientsEnt', 'loaded', 'userMode']) {
      expect(deps[1], `falta ${d} en las dependencias`).toContain(d)
    }
  })

  it('sigue esperando a que termine la carga', () => {
    // `if (!loaded) return` es lo que impide que el [] inicial se escriba encima
    // de los datos buenos antes de que lleguen. Sin eso, el bug vuelve peor.
    const i = limpio.indexOf("writeJSON(getStorageKey('patients', userMode)")
    expect(limpio.slice(Math.max(0, i - 220), i)).toMatch(/if \(!loaded\) return/)
  })
})

describe('la premisa del bug sigue siendo cierta', () => {
  // Si algún día alguien hace que se carguen LOS DOS modos a la vez, este test
  // falla y avisa que el arreglo de arriba se puede replantear.
  it('cada carga de clientes llena un solo modo', () => {
    const asignaciones = (limpio.match(/setPatients(Ent|Pro)\(/g) || []).length
    const condicionales = (limpio.match(/userMode === 'entrepreneur'\s*\?\s*setPatientsEnt|if \(userMode === 'entrepreneur'\) setPatientsEnt/g) || []).length
    expect(asignaciones).toBeGreaterThan(0)
    expect(condicionales).toBeGreaterThan(0)
  })
})
