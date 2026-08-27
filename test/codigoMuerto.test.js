import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Archivos que no puede ejecutar nadie.
 *
 * Se arranca en main.jsx y App.jsx y se sigue cada `import` hasta donde llegue.
 * Lo que no aparece en ese recorrido no se puede ejecutar nunca: está en la
 * carpeta, pesa, aparece en las búsquedas, y no corre.
 *
 * Eran 4090 líneas. Dos de ellas no eran simple basura:
 *
 *   screens/AppointmentCard.jsx — una copia vieja de App.jsx guardada con otro
 *     nombre. Todos sus imports son relativos a src/ pero el archivo está en
 *     src/components/screens/, así que ninguno resuelve: el archivo ni siquiera
 *     se puede cargar. Y quedó al lado del AppointmentCard de verdad
 *     (common/AppointmentCard.jsx), listo para que alguien importe el que no es.
 *
 *   services/backupService.js + hooks/useAutoBackup.js — un SEGUNDO BackupService
 *     con otro formato de respaldo, y un hook que le llama a
 *     `BackupService.setupAutoBackup(...)`, un método que no existe en esa clase.
 *     Si alguien enganchaba ese hook, cada hora tiraba un error mudo y el usuario
 *     iba a creer que tenía respaldos automáticos andando. No los iba a tener.
 *
 * Este test corre el mismo recorrido, así que si mañana aparece otro archivo
 * huérfano, salta acá.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const SRC = path.join(RAIZ, 'src')

/**
 * Archivos que están sueltos a propósito. Si agregás uno, poné POR QUÉ:
 * un allowlist sin motivos se convierte en el lugar donde se esconde la basura.
 */
const PERMITIDOS = {
  // (por ahora, ninguno)
}

function listarFuentes(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listarFuentes(p, acc)
    else if (/\.jsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** `import x from './algo'` → la ruta real del archivo, o null si no es local. */
function resolver(desde, spec, todos) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(desde), spec)
  for (const cand of [base, base + '.js', base + '.jsx',
                      path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (todos.includes(cand)) return cand
  }
  return null
}

function alcanzables(todos) {
  const RE = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g
  const vistos = new Set()
  const pila = ['main.jsx', 'App.jsx'].map(f => path.join(SRC, f)).filter(f => todos.includes(f))
  pila.forEach(f => vistos.add(f))

  while (pila.length) {
    const f = pila.pop()
    const txt = fs.readFileSync(f, 'utf8')
    for (const m of txt.matchAll(RE)) {
      const destino = resolver(f, m[1], todos)
      if (destino && !vistos.has(destino)) { vistos.add(destino); pila.push(destino) }
    }
  }
  return vistos
}

describe('no queda código que no ejecuta nadie', () => {
  const todos = listarFuentes(SRC)
  const vivos = alcanzables(todos)
  const huerfanos = todos
    .filter(f => !vivos.has(f))
    .map(f => path.relative(RAIZ, f).replace(/\\/g, '/'))
    .filter(f => !(f in PERMITIDOS))
    .sort()

  it('el recorrido de imports arranca de verdad', () => {
    // Si main.jsx cambiara de nombre, `vivos` quedaría casi vacío y el test de
    // abajo marcaría TODO como huérfano. Esta guarda evita ese falso positivo.
    expect(vivos.size).toBeGreaterThan(30)
  })

  it('ningún archivo queda fuera del árbol', () => {
    expect(huerfanos).toEqual([])
  })
})

describe('las dos trampas concretas ya no están', () => {
  const existe = (...p) => fs.existsSync(path.join(SRC, ...p))

  it('la copia vieja de App.jsx disfrazada de AppointmentCard', () => {
    expect(existe('components', 'screens', 'AppointmentCard.jsx')).toBe(false)
  })

  it('el AppointmentCard de verdad sigue en su lugar', () => {
    expect(existe('components', 'common', 'AppointmentCard.jsx')).toBe(true)
  })

  it('el segundo BackupService y el hook que lo llamaba', () => {
    expect(existe('services', 'backupService.js')).toBe(false)
    expect(existe('hooks', 'useAutoBackup.js')).toBe(false)
  })

  it('el BackupManager que sí se usa sigue estando', () => {
    expect(existe('components', 'common', 'BackupManager.jsx')).toBe(true)
  })
})
