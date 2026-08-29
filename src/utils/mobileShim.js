// src/utils/mobileShim.js
//
// Instala un `window.electronAPI` mínimo cuando la app NO corre dentro de
// Electron (celular vía Capacitor, o el preview de desarrollo en navegador).
//
// Por qué es tan chico
// ─────────────────────
// Antes de escribir esto se auditaron los ~50 call sites de
// `window.electronAPI.*` en todo `src/`. Casi todos ya tenían su propio
// fallback nativo del navegador (`if (window.electronAPI?.X) {...} else {
// window.open(...) }`, o un `enElectron()` que cae a localStorage para los
// adjuntos de pacientes) — agregar esos métodos acá los habría vuelto a
// romper, porque el fallback bueno sólo corre cuando `window.electronAPI` (o
// el método puntual) es falsy.
//
// Sólo quedan dos métodos sin ningún camino alternativo:
//
//  - fetchExternal: los proxies CORS de las integraciones (Firebase,
//    WooCommerce, Shopify, MercadoLibre) no tienen ningún `else`, porque en
//    Electron ese proxy es indispensable (evita CORS de verdad). Acá se
//    resuelve con fetch() directo — funciona para APIs con CORS habilitado
//    (Firebase RTDB, MercadoLibre); para WooCommerce/Shopify autoalojados,
//    que normalmente no habilitan CORS, la promesa se rechaza y el error ya
//    se muestra como toast en cada pantalla que lo llama — no revienta nada,
//    simplemente esa integración puntual no va a andar desde el celular.
//  - getAppVersion: sólo se usa para mostrarla en "Reportar problema"; sin
//    esto queda en blanco, nada crítico, pero es gratis dejarla bien.
//
// checkLicense/activateLicense/deleteLicense/getDeviceId a propósito NO están
// acá: App.jsx ya tiene `if (window.electronAPI?.checkLicense) {...} else {
// setLicenseChecked(true) }` — con licenseStatus en null, el gate de licencia
// (`licenseStatus?.status === 'expired'`) nunca se activa, así que el celular
// entra directo a la app en cuanto el usuario inicia sesión y pertenece a un
// negocio. Es exactamente el comportamiento que se buscaba: sin licencia
// propia en el celular, alcanza con ser miembro de un negocio licenciado.
import { esElectron, esMobil } from './platform'

export function instalarMobileShimSiHaceFalta() {
  if (typeof window === 'undefined' || esElectron()) return

  // Marca en <body> para que App.css pueda distinguir "app de Android" de
  // "ventana de escritorio angosta" — ambas pueden matchear los mismos
  // @media (max-width: 768px), pero sólo la primera necesita, por ejemplo,
  // sacarse el padding que Electron usa para los botones de ventana.
  if (esMobil()) document.body?.classList.add('es-capacitor')

  window.electronAPI = {
    ...window.electronAPI,

    fetchExternal: async (url, options = {}) => {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
      })
      let data
      try { data = await res.json() } catch { data = await res.text().catch(() => null) }
      return { ok: res.ok, status: res.status, data }
    },

    getAppVersion: async () => {
      try {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        return info.version
      } catch {
        return __APP_VERSION__ + ' (móvil)'
      }
    },
  }
}
