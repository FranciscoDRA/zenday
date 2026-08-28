import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { registrarError } from './utils/reporteDeErrores'

// Ver el comentario largo en electron/main.cjs: mismo DSN (no es secreto),
// mismos cuidados de privacidad. sendDefaultPii:false e integrations:[] a
// propósito — sin esto @sentry/electron agrega captura de breadcrumbs de
// navegación/DOM por defecto, que en una pantalla de historias clínicas
// puede terminar mandando texto que no tiene que salir de la máquina.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || 'https://3d9074b064d477ba3b407155725f96d1@o4511989052080128.ingest.us.sentry.io/4511989066366976',
  environment: import.meta.env.DEV ? 'development' : 'production',
  sendDefaultPii: false,
  integrations: [],
})

// Errores que NO pasan por React: promesas rechazadas sin catch, callbacks
// sueltos, fallos dentro de setTimeout. El ErrorBoundary no los ve.
//
// Antes esto SOLO escribía en <userData>/zenday-errors.log y la pantalla no
// mostraba nada. Con lo cual el error del teléfono numérico —que reventaba
// adentro del guardado de un cliente— se registró prolijamente en un archivo
// mientras el usuario apretaba "Guardar" once veces sin entender nada.
//
// Ahora ademas pasa por registrarError(), que filtra el ruido de red, silencia
// los repetidos, y avisa a <AvisoDeError /> para que aparezca un cartel.
// Sigue sin salir nada de la maquina: el log es local y el reporte se copia al
// portapapeles para que lo mande el usuario si quiere.
if (typeof window !== 'undefined') {
  const registrar = (scope, message, stack) => {
    window.electronAPI?.logError?.({ scope, message, stack })
    registrarError({ scope, message, stack })
  }

  window.addEventListener('error', (e) => {
    registrar('window.onerror', e?.message, e?.error?.stack || `${e?.filename}:${e?.lineno}:${e?.colno}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    registrar('promesa sin catch', e?.reason?.message || String(e?.reason), e?.reason?.stack)
  })
}

// Boundary de raíz: si algo falla antes de que App llegue a montar (por ejemplo
// un dato corrupto leído en un inicializador de useState), el usuario ve una
// pantalla con opción de reiniciar y de exportar un respaldo de emergencia,
// en vez de una ventana en blanco.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
