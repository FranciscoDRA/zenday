import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  ROLES, rolDe, veHistorias, veLaCaja, puedeVerPantalla,
} from '../src/utils/businessRoles'

/**
 * businessRoles.js es el espejo, del lado del cliente, de rolEn/veHistorias/
 * veLaCaja en firestore.rules — tiene que decir EXACTAMENTE lo mismo que la
 * regla real (que ya se probó contra el emulador en firestore-rules.test.mjs:
 * 69/69 pasando, incluida la parte de roles). Estos tests son funcionales de
 * verdad (no escaneo de texto): businessRoles.js no depende de React ni de
 * Firebase, así que se puede importar y ejecutar directo.
 */
describe('rolDe: mismo default que rolEn() en firestore.rules', () => {
  it('sin campo roles, CUALQUIER miembro es dueño (compatibilidad con negocios viejos)', () => {
    expect(rolDe({ members: ['a'] }, 'a')).toBe(ROLES.DUENO)
    expect(rolDe(null, 'a')).toBe(ROLES.DUENO)
    expect(rolDe(undefined, 'a')).toBe(ROLES.DUENO)
  })

  it('con roles, el uid que figura tiene ESE rol', () => {
    const doc = { roles: { ana: 'dueno', bruno: 'profesional', clara: 'asistente' } }
    expect(rolDe(doc, 'ana')).toBe(ROLES.DUENO)
    expect(rolDe(doc, 'bruno')).toBe(ROLES.PROFESIONAL)
    expect(rolDe(doc, 'clara')).toBe(ROLES.ASISTENTE)
  })

  it('con roles, un uid que NO figura entra con el rol MÍNIMO (asistente), no el máximo', () => {
    // Si entrara como dueño, cualquiera que se sumara con el código del
    // negocio tendría acceso total sin que nadie se lo asignara.
    const doc = { roles: { ana: 'dueno' } }
    expect(rolDe(doc, 'recien-llegado')).toBe(ROLES.ASISTENTE)
  })
})

describe('veHistorias / veLaCaja: el corte de la secretaria', () => {
  it('dueño y profesional ven historias clínicas; asistente no', () => {
    expect(veHistorias(ROLES.DUENO)).toBe(true)
    expect(veHistorias(ROLES.PROFESIONAL)).toBe(true)
    expect(veHistorias(ROLES.ASISTENTE)).toBe(false)
  })

  it('sólo el dueño ve la caja', () => {
    expect(veLaCaja(ROLES.DUENO)).toBe(true)
    expect(veLaCaja(ROLES.PROFESIONAL)).toBe(false)
    expect(veLaCaja(ROLES.ASISTENTE)).toBe(false)
  })
})

describe('puedeVerPantalla: qué pantalla puede abrir cada rol', () => {
  it('la asistente ve agenda, kanban, productos, dashboard, alertas — pero no historias ni plata', () => {
    for (const abierta of ['dashboard', 'agenda', 'kanban', 'products', 'alertas', 'emprendedor', 'settings']) {
      expect(puedeVerPantalla(ROLES.ASISTENTE, abierta), abierta).toBe(true)
    }
    for (const cerrada of ['patients', 'patientDetail', 'pending', 'expenses', 'financial', 'reports', 'audit']) {
      expect(puedeVerPantalla(ROLES.ASISTENTE, cerrada), cerrada).toBe(false)
    }
  })

  it('el profesional ve historias y agenda, pero no la caja', () => {
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'patients')).toBe(true)
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'pending')).toBe(true)
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'expenses')).toBe(false)
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'financial')).toBe(false)
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'reports')).toBe(false)
    expect(puedeVerPantalla(ROLES.PROFESIONAL, 'audit')).toBe(false)
  })

  it('el dueño ve todo', () => {
    for (const pantalla of ['dashboard', 'patients', 'expenses', 'financial', 'reports', 'audit', 'pending']) {
      expect(puedeVerPantalla(ROLES.DUENO, pantalla), pantalla).toBe(true)
    }
  })

  it('una pantalla sin entrada en el mapa queda abierta a todos (agenda, detalle de cita, etc.)', () => {
    expect(puedeVerPantalla(ROLES.ASISTENTE, 'detail')).toBe(true)
    expect(puedeVerPantalla(ROLES.ASISTENTE, 'new')).toBe(true)
    expect(puedeVerPantalla(undefined, 'dashboard')).toBe(true)
  })
})

// ─── Verificación de que el gate está realmente conectado ─────────────────
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('El gate de roles está conectado en los tres lugares que importan', () => {
  it('App.jsx: useBusinessMembers alimenta myRole, y el render de cada pantalla lo chequea', () => {
    const fuente = leer('src', 'App.jsx')
    expect(fuente).toMatch(/const \{ businessDoc, myRole \} = useBusinessMembers\(businessId, user\?\.uid\)/)
    expect(fuente).toMatch(/puedeVerPantalla\(myRole, id\)/)
    expect(fuente).toMatch(/<AccesoRestringido rol={myRole} \/>/)
    // myRole también tiene que llegar a sharedProps (para SettingsScreen) y al Sidebar.
    expect(fuente).toMatch(/myRole,\s*\n\s*toast,\s*\n\s*\}/)
    expect(fuente).toMatch(/myRole={myRole}/)
  })

  it('Sidebar.jsx: los tabs se filtran por rol antes de dibujarse', () => {
    const fuente = leer('src', 'components', 'layout', 'Sidebar.jsx')
    expect(fuente).toMatch(/getTabs\(\)\.filter\(tab => puedeVerPantalla\(myRole, tab\.id\)\)/)
  })

  it('SettingsScreen.jsx: expulsar y cambiar rol sólo se ofrecen cuando myRole es dueño', () => {
    const fuente = leer('src', 'components', 'screens', 'SettingsScreen.jsx')
    const bloque = fuente.slice(fuente.indexOf('{/* Miembros:'), fuente.indexOf('{/* Unirse a otro negocio */}'))
    expect(bloque).toMatch(/myRole === ROLES\.DUENO && !esYo/)
    expect(bloque).toMatch(/handleRemoveMember\(uid, etiqueta\)/)
    expect(bloque).toMatch(/handleChangeRole\(uid, e\.target\.value\)/)
  })
})

describe('useBusinessId.js: las acciones de miembros exigen que las llame quien corresponde (la regla real está en firestore.rules)', () => {
  it('removeMember y setMemberRole existen y son funciones exportadas', () => {
    const fuente = leer('src', 'hooks', 'useBusinessId.js')
    expect(fuente).toMatch(/export async function removeMember\(businessId, targetUid\)/)
    expect(fuente).toMatch(/export async function setMemberRole\(businessId, targetUid, role\)/)
    expect(fuente).toMatch(/export function useBusinessMembers\(businessId, uid\)/)
  })
})
