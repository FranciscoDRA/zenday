import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Sólo la usa mobileShim.js, para mostrar una versión en "Reportar problema"
// cuando no hay Electron (que sí la sabe por su propio package.json) — evita
// mantener el número de versión escrito a mano en dos lugares.
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version

// Orígenes que la app necesita realmente alcanzar.
const FIREBASE = [
  'https://*.googleapis.com',
  'https://*.firebaseio.com',
  'wss://*.firebaseio.com',
  'https://*.firebaseapp.com',
  'https://*.firebasestorage.app',
].join(' ')

// CSP de producción. Lo importante es `script-src 'self'`: sin 'unsafe-inline'
// ni 'unsafe-eval', un dato malicioso guardado en un campo (nombre de cliente,
// nota, respuesta de una integración) no puede convertirse en código ejecutado.
//
// `connect-src` incluye https: y http: porque IntegrationManager permite que el
// usuario configure la URL de su propia tienda. Si algún día esas URLs se
// resuelven siempre por IPC (fetch-external), se puede cerrar a sólo Firebase.
const PROD_CSP = [
  `default-src 'self'`,
  `script-src 'self'`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  `img-src 'self' data: blob: https:`,
  `connect-src 'self' ${FIREBASE} https: http:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'none'`,
  `frame-src 'self' blob: data:`,
  `frame-ancestors 'none'`,
].join('; ')

// El server de Vite sí necesita inline/eval para el HMR, por eso la CSP de
// desarrollo es distinta y vive sólo en las cabeceras del dev server.
const DEV_CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  `img-src 'self' data: blob: https:`,
  `connect-src 'self' ws://localhost:* http://localhost:* ${FIREBASE} https: http:`,
  `object-src 'none'`,
].join('; ')

/** Inyecta la CSP estricta en el index.html sólo al construir para producción. */
function productionCsp() {
  return {
    name: 'zenday-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`
      )
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), productionCsp()],
  server: {
    port: 5173,
    strictPort: false,
    open: false,
    headers: {
      'Content-Security-Policy': DEV_CSP,
    },
  },
  build: {
    outDir: 'dist',

    // FIX: estaba en `sourcemap: true, minify: false`. Eso publicaba el código
    // fuente completo y legible dentro del instalador — incluida la lógica de
    // licencias y de precios — y multiplicaba el peso del bundle.
    // 'hidden' genera los .map para poder depurar un stacktrace de un cliente,
    // pero no los referencia desde el JS ni los empaqueta (package.json ya
    // excluye "dist/**/*.map" del build de electron-builder).
    sourcemap: 'hidden',
    minify: 'esbuild',

    chunkSizeWarningLimit: 900,

    rollupOptions: {
      output: {
        // Separar las librerías pesadas del código de la app: al actualizar
        // ZenDay el usuario no vuelve a descargar Firebase/recharts/jspdf enteros.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database'],
          charts: ['recharts'],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database'],
  },
})
