// src/components/screens/LicenseScreen.jsx
// Pantalla de activación que se muestra antes de entrar a la app

import React, { useState } from 'react'

export function LicenseScreen({ licenseStatus, onActivate }) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isExpired = licenseStatus?.status === 'expired'
  const isTrial = licenseStatus?.status === 'trial'
  const daysLeft = licenseStatus?.daysLeft || 0

  async function handleActivate() {
    if (!key.trim()) {
      setError('Ingresá tu clave de licencia.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const result = await window.electronAPI.activateLicense(key.trim())
      if (result.success) {
        setSuccess(result.message)
setTimeout(() => onActivate(key.trim()), 1200)      } else {
        setError(result.message)
      }
    } catch (err) {
      setError('Error al activar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  // FIX: writeText sin await, así que el try/catch no lo cubría. Si el copiado
  // fallaba, igual decía "ID copiado al portapapeles" y el error quedaba como
  // una promesa sin capturar en la consola. Es la pantalla de licencia: acá el
  // usuario NECESITA ese ID para que le emitas la clave.
  async function handleCopyDeviceId() {
    let id
    try {
      id = await window.electronAPI.getDeviceId()
    } catch {
      setError('No se pudo obtener el ID del dispositivo.')
      return
    }
    if (!id) { setError('No se pudo obtener el ID del dispositivo.'); return }

    let copiado = false
    try {
      await navigator.clipboard.writeText(id)
      copiado = true
    } catch {
      // Respaldo para cuando el permiso está denegado o la ventana sin foco
      try {
        const ta = document.createElement('textarea')
        ta.value = id
        Object.assign(ta.style, { position: 'fixed', left: '-999999px' })
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        copiado = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { copiado = false }
    }

    if (copiado) {
      setSuccess('ID copiado al portapapeles.')
      setTimeout(() => setSuccess(''), 2000)
    } else {
      // Se muestra el ID para que lo pueda copiar a mano.
      setError(`No se pudo copiar. Tu ID es: ${id}`)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleActivate()
  }

  // Formatear input automáticamente como ZENDAY-XXXX-XXXX-XXXX-XXXX
  function handleKeyInput(e) {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')

    // Auto-agregar prefijo
    if (val && !val.startsWith('ZENDAY-') && !val.startsWith('Z')) {
      val = 'ZENDAY-' + val
    }

    setKey(val)
    setError('')
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--bg-primary)',
      fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '0.5px solid var(--border-strong)',
        borderRadius: '24px',
        padding: '40px',
        width: '480px',
        boxShadow: 'var(--shadow-xl)',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <svg viewBox="0 0 64 64" fill="none" style={{ width: '56px', height: '56px', margin: '0 auto 12px' }}>
            <rect width="64" height="64" rx="16" fill="url(#lg)" />
            <circle cx="32" cy="30" r="14" stroke="white" strokeWidth="2.5" />
            <path d="M24 30L30 36L42 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="64" y2="64">
                <stop offset="0%" stopColor="var(--accent-blue)" />
                <stop offset="100%" stopColor="var(--accent-green)" />
              </linearGradient>
            </defs>
          </svg>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>ZenDay</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>Encuentra tu flow</p>
        </div>

        {/* Estado */}
        {isTrial && (
          <div style={{
            background: daysLeft <= 2 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            border: `0.5px solid ${daysLeft <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: daysLeft <= 2 ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
              {daysLeft <= 2 ? '⚠️' : '⏳'} Período de prueba
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {daysLeft === 1 ? 'Te queda 1 día' : `Te quedan ${daysLeft} días`} de prueba gratuita
            </div>
          </div>
        )}

        {isExpired && (
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '0.5px solid rgba(239,68,68,0.3)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-red)' }}>
              🔒 Período de prueba terminado
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Activá tu licencia para seguir usando ZenDay
            </div>
          </div>
        )}

        {/* Formulario */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '8px' }}>
            Clave de licencia
          </label>
          <input
            type="text"
            value={key}
            onChange={handleKeyInput}
            onKeyDown={handleKeyDown}
            placeholder="ZENDAY-XXXX-XXXX-XXXX-XXXX"
            autoFocus
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: '14px',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
              border: `1.5px solid ${error ? 'var(--accent-red)' : success ? 'var(--accent-green)' : 'var(--border-strong)'}`,
              borderRadius: '10px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
          />
        </div>

        {/* Feedback */}
        {error && (
          <div style={{
            fontSize: '13px',
            color: 'var(--accent-red)',
            background: 'rgba(239,68,68,0.08)',
            border: '0.5px solid rgba(239,68,68,0.2)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
          }}>
            ❌ {error}
          </div>
        )}

        {success && (
          <div style={{
            fontSize: '13px',
            color: 'var(--accent-green)',
            background: 'rgba(16,185,129,0.08)',
            border: '0.5px solid rgba(16,185,129,0.2)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
          }}>
            ✅ {success}
          </div>
        )}

        {/* Botón activar */}
        <button
          onClick={handleActivate}
          disabled={loading || !!success}
          style={{
            width: '100%',
            padding: '13px',
            fontSize: '14px',
            fontWeight: 600,
            background: success ? 'var(--accent-green)' : 'var(--accent-blue)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            cursor: loading || success ? 'default' : 'pointer',
            opacity: loading ? 0.7 : 1,
            transition: 'all 0.15s',
            fontFamily: 'inherit',
            marginBottom: '16px',
          }}
        >
          {loading ? 'Verificando...' : success ? '✓ Activada' : 'Activar licencia'}
        </button>

        {/* Continuar en trial (solo si no expiró) */}
        {isTrial && (
          <button
            onClick={() => onActivate(null)}
            style={{
              width: '100%',
              padding: '11px',
              fontSize: '13px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border-strong)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: '16px',
              transition: 'all 0.15s',
            }}
          >
            Continuar con prueba gratuita ({daysLeft} días restantes)
          </button>
        )}

        {/* ID del dispositivo */}
        <div style={{
          borderTop: '0.5px solid var(--border)',
          paddingTop: '16px',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
            ¿No tenés licencia? Envianos tu ID de dispositivo para obtener una.
          </p>
          <button
            onClick={handleCopyDeviceId}
            style={{
              fontSize: '12px',
              color: 'var(--accent-blue)',
              background: 'transparent',
              border: '0.5px solid var(--border-strong)',
              borderRadius: '8px',
              padding: '6px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            📋 Copiar ID del dispositivo
          </button>
        </div>

      </div>
    </div>
  )
}

export default LicenseScreen
