import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { registrarError } from './utils/reporteDeErrores'

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
