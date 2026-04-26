import React, { useState } from 'react'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'

export function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('login') // 'login' o 'register'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Completá todos los campos')
      return
    }

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden')
        return
      }
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres')
        return
      }
    }

    setLoading(true)
    setError('')

    try {
      let result
      if (mode === 'login') {
        result = await signInWithEmailAndPassword(auth, email, password)
      } else {
        result = await createUserWithEmailAndPassword(auth, email, password)
      }
      onLogin(result.user)
    } catch (err) {
      switch (err.code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setError('Email o contraseña incorrectos')
          break
        case 'auth/email-already-in-use':
          setError('Ese email ya tiene una cuenta registrada')
          break
        case 'auth/weak-password':
          setError('La contraseña es muy débil')
          break
        case 'auth/invalid-email':
          setError('El email no es válido')
          break
        case 'auth/too-many-requests':
          setError('Demasiados intentos. Esperá unos minutos')
          break
        case 'auth/network-request-failed':
          setError('Sin conexión a internet')
          break
        default:
          setError('Error al procesar. Intentá de nuevo')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
    }}>
      <div style={{
        background: 'white', borderRadius: '24px',
        padding: '48px 40px', width: '100%', maxWidth: '400px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '20px',
            background: 'linear-gradient(135deg, #6366f1, #10b981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg viewBox="0 0 80 80" fill="none" width="48" height="48">
              <circle cx="40" cy="38" r="18" stroke="white" strokeWidth="3.5" />
              <path d="M30 38L37 45L52 30" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1e293b', margin: 0 }}>ZenDay</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            {mode === 'login' ? 'Iniciá sesión para continuar' : 'Creá tu cuenta'}
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', background: '#f1f5f9', borderRadius: '12px',
          padding: '4px', marginBottom: '24px',
        }}>
          {[
            { key: 'login', label: '🔐 Iniciar sesión' },
            { key: 'register', label: '✨ Crear cuenta' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setMode(tab.key); setError('') }}
              style={{
                flex: 1, padding: '8px',
                background: mode === tab.key ? 'white' : 'transparent',
                border: 'none', borderRadius: '10px',
                fontSize: '13px', fontWeight: 600,
                color: mode === tab.key ? '#6366f1' : '#64748b',
                cursor: 'pointer',
                boxShadow: mode === tab.key ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              autoFocus
              style={{
                width: '100%', padding: '12px 16px',
                borderRadius: '12px', border: '1.5px solid #e2e8f0',
                fontSize: '15px', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#6366f1'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>

          <div style={{ marginBottom: mode === 'register' ? '16px' : '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '12px 16px',
                borderRadius: '12px', border: '1.5px solid #e2e8f0',
                fontSize: '15px', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#6366f1'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>

          {mode === 'register' && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Confirmar contraseña
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '12px 16px',
                  borderRadius: '12px', border: '1.5px solid #e2e8f0',
                  fontSize: '15px', outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#6366f1'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '10px', padding: '10px 14px',
              color: '#ef4444', fontSize: '13px', marginBottom: '16px',
            }}>
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none', borderRadius: '12px',
              color: 'white', fontSize: '16px', fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {loading
              ? '⏳ Procesando...'
              : mode === 'login' ? '🔐 Iniciar sesión' : '✨ Crear cuenta'
            }
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#94a3b8', marginTop: '24px' }}>
          ZenDay — Gestión inteligente para emprendedores
        </p>
      </div>
    </div>
  )
}