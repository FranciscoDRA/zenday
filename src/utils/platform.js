// src/utils/platform.js
//
// Detecta en qué runtime está corriendo la app: Electron (escritorio),
// Capacitor (Android/iOS), o navegador suelto (el preview de desarrollo). El
// resto del código no debería importar Capacitor directamente — todo pasa
// por acá para tener un solo lugar que sepa distinguir las plataformas.
import { Capacitor } from '@capacitor/core'

export function esElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

export function esCapacitor() {
  return Capacitor.isNativePlatform()
}

/** true en Android/iOS empaquetados con Capacitor — NO en el navegador suelto. */
export function esMobil() {
  return esCapacitor()
}
