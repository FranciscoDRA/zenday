import React from 'react'
import * as Sentry from '@sentry/electron/renderer'

/**
 * ErrorBoundary — red de contención para errores de render.
 *
 * Hoy el proyecto no tiene ninguno (0 en 26.451 líneas). En React 19, un error
 * lanzado durante el render sin boundary desmonta TODO el árbol: la ventana de
 * Electron queda en blanco, sin mensaje, y el usuario sólo puede cerrar la app.
 * Con los datos guardados en localStorage, un solo registro con una forma
 * inesperada (un `patient` sin `name`, una fecha inválida) alcanza para eso.
 *
 * Cómo usarlo — dos niveles:
 *
 * 1) Raíz, en main.jsx, para que nunca haya pantalla en blanco:
 *
 *      <ErrorBoundary>
 *        <App />
 *      </ErrorBoundary>
 *
 * 2) Por pantalla, para que un error en Reportes no te tire la Agenda.
 *    En App.jsx, envolviendo el switch de pantallas:
 *
 *      <ErrorBoundary key={activeTab} scope={activeTab} onReset={() => nav.goToRoot('dashboard')}>
 *        {renderScreen()}
 *      </ErrorBoundary>
 *
 *    El `key={activeTab}` es importante: hace que el boundary se resetee solo
 *    al cambiar de pantalla, en vez de quedar pegado en el estado de error.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error(`[ErrorBoundary${this.props.scope ? ` · ${this.props.scope}` : ''}]`, error, info?.componentStack)

    // Deja constancia en <userData>/zenday-errors.log. No se envía a ningún lado:
    // queda en la máquina del cliente para que él te lo pueda mandar. Es la
    // diferencia entre "se me cerró" y saber exactamente qué falló.
    try {
      window.electronAPI?.logError?.({
        scope: this.props.scope,
        message: error?.message || String(error),
        stack: error?.stack,
        componentStack: info?.componentStack,
      })
    } catch { /* el log nunca puede ser la causa de otra falla */ }

    // Este SÍ sale de la máquina — es el punto de todo esto. Sin nombres de
    // paciente ni datos del formulario: el objeto Error y el component stack
    // de React, nada más.
    try {
      Sentry.captureException(error, {
        tags: { scope: this.props.scope || 'desconocido' },
        contexts: { react: { componentStack: info?.componentStack } },
      })
    } catch { /* Sentry no puede ser la causa de otra falla */ }

    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error, info) } catch { /* no romper dentro del handler */ }
    }
  }

  handleReset = () => {
    this.setState({ error: null, info: null })
    if (typeof this.props.onReset === 'function') this.props.onReset()
  }

  handleReload = () => {
    if (window.electronAPI?.reload) window.electronAPI.reload()
    else window.location.reload()
  }

  handleExport = () => {
    // Salida de emergencia: si la app no arranca, que al menos los datos salgan.
    try {
      const dump = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('zenday-')) dump[k] = localStorage.getItem(k)
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zenday-respaldo-emergencia-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[ErrorBoundary] No se pudo exportar el respaldo:', err)
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const isDev = import.meta.env?.DEV

    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.icon}>⚠️</div>

          <h2 style={styles.title}>Algo se rompió en esta pantalla</h2>

          <p style={styles.text}>
            Tus datos siguen guardados en el equipo. Podés volver al inicio o reiniciar la
            aplicación. Si el problema se repite, exportá un respaldo y avisanos.
          </p>

          <div style={styles.actions}>
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={this.handleReset}>
              Volver al inicio
            </button>
            <button style={styles.btn} onClick={this.handleReload}>
              Reiniciar app
            </button>
            <button style={styles.btn} onClick={this.handleExport}>
              Exportar respaldo
            </button>
          </div>

          {isDev && (
            <pre style={styles.pre}>
              {this.state.error?.stack || String(this.state.error)}
              {this.state.info?.componentStack}
            </pre>
          )}
        </div>
      </div>
    )
  }
}

// Estilos en línea a propósito: si el fallo fuese al cargar App.css, esta
// pantalla tiene que verse igual.
const styles = {
  wrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', padding: 24, background: 'var(--bg-primary)',
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
  },
  card: {
    maxWidth: 520, width: '100%', background: 'var(--card-bg)', borderRadius: 16,
    padding: '32px 28px', boxShadow: 'var(--shadow-lg)', textAlign: 'center',
  },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { margin: '0 0 10px', fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' },
  text: { margin: '0 0 24px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-tertiary)' },
  actions: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  btn: {
    padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border-strong)',
    background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
  },
  btnPrimary: { background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', color: 'var(--card-bg)' },
  pre: {
    marginTop: 24, padding: 14, background: 'var(--bg-tertiary)', borderRadius: 10,
    fontSize: 11, lineHeight: 1.5, color: 'var(--accent-red)', textAlign: 'left',
    overflow: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap',
  },
}

export default ErrorBoundary
