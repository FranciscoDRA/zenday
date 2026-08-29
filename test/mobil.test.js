import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { esElectron, esCapacitor, esMobil } from '../src/utils/platform'

/**
 * Base de la versión para celular (Capacitor + Android). El grueso de esto no
 * se puede probar "de verdad" en Node (hace falta un WebView real, o al menos
 * un DOM) — se verificó a mano contra un emulador de Android real (build de
 * Gradle exitoso, APK instalado, la app abre y muestra la pantalla de login
 * sin errores de consola). Estos tests cubren lo que SÍ es lógica pura
 * (platform.js) y que las piezas queden conectadas donde tienen que estarlo.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('platform.js: detecta el runtime sin Capacitor ni Electron presentes', () => {
  it('en un entorno de test (sin window.electronAPI ni bridge nativo) da todo en false', () => {
    expect(esElectron()).toBe(false)
    expect(esCapacitor()).toBe(false)
    expect(esMobil()).toBe(false)
  })
})

describe('mobileShim.js: sólo shimea lo que de verdad no tiene fallback propio', () => {
  const fuente = leer('src', 'utils', 'mobileShim.js')

  it('instala fetchExternal y getAppVersion nada más', () => {
    expect(fuente).toMatch(/fetchExternal: async/)
    expect(fuente).toMatch(/getAppVersion: async/)
  })

  it('NO shimea checkLicense/activateLicense/deleteLicense/getDeviceId a propósito', () => {
    // App.jsx ya cae a `setLicenseChecked(true)` sin licenseStatus cuando
    // checkLicense no existe — shimearlo rompería ese camino ya seguro.
    const declaraciones = fuente.match(/^\s{4}\w+: /gm) || []
    for (const linea of declaraciones) {
      expect(linea).not.toMatch(/checkLicense|activateLicense|deleteLicense|getDeviceId/)
    }
  })

  it('NO shimea openExternal/openFile/saveFile/docsX: cada call site ya tiene su propio fallback', () => {
    const declaraciones = fuente.match(/^\s{4}\w+: /gm) || []
    for (const linea of declaraciones) {
      expect(linea).not.toMatch(/openExternal|openFile|saveFile|docsList|docsSave|docsRead|docsDelete|docsMigrate/)
    }
  })

  it('se instala antes de montar React, en main.jsx', () => {
    const main = leer('src', 'main.jsx')
    const ordenImport = main.indexOf('instalarMobileShimSiHaceFalta')
    const ordenLlamada = main.indexOf('instalarMobileShimSiHaceFalta()')
    const ordenRender = main.indexOf('createRoot(')
    expect(ordenImport).toBeGreaterThan(-1)
    expect(ordenLlamada).toBeGreaterThan(ordenImport)
    expect(ordenRender).toBeGreaterThan(ordenLlamada)
  })
})

describe('Licencia: el celular entra sin activar nada, siendo miembro de un negocio', () => {
  it('App.jsx cae a licenseChecked=true sin licenseStatus cuando no hay checkLicense (mobileShim no lo tapa)', () => {
    const fuente = leer('src', 'App.jsx')
    const bloque = fuente.slice(fuente.indexOf('// ========== useEffect DE LICENCIA'), fuente.indexOf('// ========== ESCUCHAR ACTUALIZACIONES'))
    expect(bloque).toMatch(/if \(window\.electronAPI\?\.checkLicense\)/)
    expect(bloque).toMatch(/} else {\s*\n\s*setLicenseChecked\(true\)/)
  })

  it('con licenseStatus null, el gate de "expired/invalid" nunca se activa (no hay LicenseScreen bloqueando)', () => {
    const fuente = leer('src', 'App.jsx')
    expect(fuente).toMatch(/licenseStatus\?\.status === 'expired' \|\| licenseStatus\?\.status === 'invalid'/)
  })

  it('SettingsScreen.jsx muestra un mensaje propio en la sección Licencia cuando esMobil(), no el formulario de activar', () => {
    const fuente = leer('src', 'components', 'screens', 'SettingsScreen.jsx')
    const bloque = fuente.slice(fuente.indexOf("activeSection === 'license'"), fuente.indexOf("activeSection === 'data'"))
    expect(bloque).toMatch(/esMobil\(\) \?/)
    expect(bloque).toMatch(/No hace falta activar nada acá/)
  })
})

describe('Navegación móvil: Sidebar se convierte en una franja inferior', () => {
  it('esMobil() gatea un render alternativo de Sidebar antes del layout de escritorio', () => {
    const fuente = leer('src', 'components', 'layout', 'Sidebar.jsx')
    expect(fuente).toMatch(/if \(esMobil\(\)\) \{/)
    expect(fuente).toMatch(/mobile-bottom-nav/)
    // Usa la MISMA lista de tabs ya filtrada por rol — no una lista aparte
    // que se pueda desincronizar de la de escritorio.
    const idxMobil = fuente.indexOf('if (esMobil())')
    const idxTabsFilter = fuente.indexOf('const tabs = getTabs().filter')
    expect(idxTabsFilter).toBeGreaterThan(-1)
    expect(idxTabsFilter).toBeLessThan(idxMobil)
  })

  it('App.css define el layout de la franja inferior y esconde los botones de ventana en Android', () => {
    const css = leer('src', 'App.css')
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{/)
    expect(css).toMatch(/body\.es-capacitor \.win-control \{ display: none; \}/)
    expect(css).toMatch(/env\(safe-area-inset-bottom/)
  })
})

describe('WindowControls: se esconden los 3 botones de ventana en el celular, no la barra entera', () => {
  it('mostrarControlesDeVentana depende de esMobil(), y la barra de acciones queda afuera de esa condición', () => {
    const fuente = leer('src', 'components', 'common', 'WindowControls.jsx')
    expect(fuente).toMatch(/const mostrarControlesDeVentana = !esMobil\(\)/)
    const idxAcciones = fuente.indexOf('Acciones:')
    const idxCondicion = fuente.indexOf('{mostrarControlesDeVentana &&')
    expect(idxAcciones).toBeGreaterThan(-1)
    expect(idxCondicion).toBeGreaterThan(idxAcciones)
  })
})
