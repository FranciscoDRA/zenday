import React, { useState, useEffect } from 'react'
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore'
import { firestore } from '../../firebase'
import { joinBusiness } from '../../hooks/useBusinessId'

export function BusinessSetupScreen({ user, businessId, onComplete }) {
  const [mode, setMode] = useState(null)
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [forceCreating, setForceCreating] = useState(false)

  // 🔧 FORZAR CREACIÓN DEL DOCUMENTO DEL USUARIO (SOLUCIÓN DEFINITIVA)
  useEffect(() => {
    const ensureUserDocument = async () => {
      if (!user) return
      
      try {
        const userRef = doc(firestore, 'users', user.uid)
        const userSnap = await getDoc(userRef)
        
        if (!userSnap.exists()) {
          console.log('[BusinessSetup] Creando documento de usuario faltante...')
          await setDoc(userRef, {
            email: user.email,
            businessId: businessId,
            isOwner: mode === 'create',
            createdAt: new Date().toISOString()
          }, { merge: true })
          console.log('[BusinessSetup] Documento de usuario creado')
        } else {
          console.log('[BusinessSetup] Documento de usuario ya existe')
        }
      } catch (err) {
        console.error('[BusinessSetup] Error asegurando documento:', err)
      }
    }
    
    ensureUserDocument()
  }, [user, businessId, mode])

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(businessId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Error copiando con clipboard:', err)
      // Fallback: crear elemento textarea para copiar
      const textarea = document.createElement('textarea')
      textarea.value = businessId
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleJoin = async () => {
    const clean = joinCode.trim().toUpperCase()
    if (!clean) { 
      setError('Ingresá el código de negocio')
      return
    }
    if (clean === businessId) { 
      setError('Ese es tu propio código')
      return
    }
    
    setLoading(true)
    setError('')

    try {
      console.log('[Join] Intentando unirse al negocio:', clean)
      console.log('[Join] Usuario:', user?.uid)
      
      // Verificar que el documento del usuario existe ANTES de unirse
      const userRef = doc(firestore, 'users', user.uid)
      const userSnap = await getDoc(userRef)
      
      if (!userSnap.exists()) {
        console.log('[Join] Usuario sin documento, creando...')
        await setDoc(userRef, {
          email: user.email,
          businessId: null,
          createdAt: new Date().toISOString()
        }, { merge: true })
      }
      
      // Intentar unirse
      const newId = await joinBusiness(user, clean)
      console.log('[Join] Éxito! Nuevo businessId:', newId)
      
      // Actualizar el documento del usuario nuevamente para asegurar
      await setDoc(userRef, {
        businessId: newId,
        updatedAt: new Date().toISOString()
      }, { merge: true })
      
      onComplete(newId)
    } catch (err) {
      console.error('[Join] Error detallado:', err)
      console.error('[Join] Error message:', err.message)
      
      if (err.message === 'INVALID_CODE') {
        setError('El código no existe. Verificá que esté bien escrito y que la dueña haya creado el negocio')
      } else if (err.message?.includes('permission') || err.message?.includes('permission-denied')) {
        setError('Error de permisos. Asegurate de tener conexión a internet')
      } else if (err.message?.includes('network')) {
        setError('Sin conexión. Verificá tu internet e intentá de nuevo')
      } else {
        setError(`Error: ${err.message || 'Intentá de nuevo'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  // Función de emergencia para forzar la unión manualmente
  const forceJoinManually = async () => {
    const clean = joinCode.trim().toUpperCase()
    if (!clean) {
      setError('Ingresá un código de negocio')
      return
    }
    
    setForceCreating(true)
    setError('')
    
    try {
      console.log('[ForceJoin] Forzando unión manual a:', clean)
      
      // 1. Verificar que el negocio existe
      const businessRef = doc(firestore, 'businesses', clean)
      const businessSnap = await getDoc(businessRef)
      
      if (!businessSnap.exists()) {
        setError('❌ El código de negocio no existe. Verificá que la dueña lo haya creado.')
        return
      }
      
      // 2. Agregarse como miembro al negocio
      const members = businessSnap.data().members || []
      if (!members.includes(user.uid)) {
        await updateDoc(businessRef, { members: [...members, user.uid] })
        console.log('[ForceJoin] Agregado como miembro')
      }
      
      // 3. Actualizar su documento de usuario
      const userRef = doc(firestore, 'users', user.uid)
      await setDoc(userRef, {
        email: user.email,
        businessId: clean,
        isOwner: false,
        updatedAt: new Date().toISOString()
      }, { merge: true })
      
      console.log('[ForceJoin] Unión exitosa!')
      setError('✅ Unión exitosa! La app se va a recargar...')
      
      setTimeout(() => {
        onComplete(clean)
      }, 1500)
      
    } catch (err) {
      console.error('[ForceJoin] Error:', err)
      setError(`Error forzado: ${err.message}`)
    } finally {
      setForceCreating(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '12px 16px',
    borderRadius: '12px', border: '1.5px solid var(--border)',
    fontSize: '15px', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'monospace', letterSpacing: '0.05em',
    textTransform: 'uppercase',
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
    }}>
      <div style={{
        background: 'white', borderRadius: '24px',
        padding: '48px 40px', width: '100%', maxWidth: '440px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        position: 'relative'
      }}>
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
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b', margin: 0 }}>
            Configurar negocio
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            {user?.email}
          </p>
        </div>

        {/* Opciones principales */}
        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button onClick={() => setMode('create')} style={{
              padding: '16px', borderRadius: '16px',
              border: '2px solid #6366f1', background: 'rgba(99,102,241,0.05)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🏪</div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '15px' }}>
                Soy la dueña / primera usuaria
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                Creo el negocio y comparto el código con mi socia
              </div>
            </button>

            <button onClick={() => setMode('join')} style={{
              padding: '16px', borderRadius: '16px',
              border: '2px solid #10b981', background: 'rgba(16,185,129,0.05)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🤝</div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '15px' }}>
                Unirme a un negocio existente
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                Tengo el código que me compartió mi socia
              </div>
            </button>
          </div>
        )}

        {/* Crear negocio */}
        {mode === 'create' && (
          <div>
            <button onClick={() => setMode(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '13px', marginBottom: '16px', padding: 0
            }}>← Volver</button>

            <div style={{
              background: '#f8fafc', borderRadius: '16px',
              padding: '20px', marginBottom: '16px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px', fontWeight: 600 }}>
                📋 Tu código de negocio
              </div>
              <div style={{
                fontSize: '22px', fontWeight: 800, color: '#1e293b',
                letterSpacing: '0.1em', marginBottom: '12px',
                fontFamily: 'monospace'
              }}>
                {businessId}
              </div>
              <button onClick={handleCopyCode} style={{
                width: '100%', padding: '10px',
                background: copied ? 'var(--accent-green)' : 'var(--accent-blue)',
                border: 'none', borderRadius: '10px',
                color: 'white', fontWeight: 600, cursor: 'pointer',
                fontSize: '14px', transition: 'background 0.2s'
              }}>
                {copied ? '✅ Copiado!' : '📋 Copiar código'}
              </button>
            </div>

            <div style={{
              background: 'rgba(99,102,241,0.05)', borderRadius: '12px',
              padding: '12px 16px', marginBottom: '20px',
              border: '1px solid rgba(99,102,241,0.15)'
            }}>
              <p style={{ fontSize: '13px', color: 'var(--accent-blue)', margin: 0, fontWeight: 500 }}>
                💡 Compartí este código con tu socia por WhatsApp. Ella lo va a necesitar para unirse y ver los mismos datos.
              </p>
            </div>

            <button onClick={() => onComplete(businessId)} style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none', borderRadius: '12px',
              color: 'white', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}>
              Continuar →
            </button>
          </div>
        )}

        {/* Unirse */}
        {mode === 'join' && (
          <div>
            <button onClick={() => setMode(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '13px', marginBottom: '16px', padding: 0
            }}>← Volver</button>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600,
                color: '#374151', marginBottom: '6px' }}>
                Código de negocio
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                autoFocus
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent-blue)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
                El código tiene el formato XXXX-XXXX-XXXX
              </p>
            </div>

            {error && (
              <div style={{
                background: error.includes('✅') ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${error.includes('✅') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                borderRadius: '10px', padding: '10px 14px',
                color: error.includes('✅') ? 'var(--accent-green)' : 'var(--accent-red)',
                fontSize: '13px', marginBottom: '16px',
              }}>
                {error.includes('✅') ? '🎉 ' : '⚠️ '}{error}
              </div>
            )}

            <button onClick={handleJoin} disabled={loading} style={{
              width: '100%', padding: '14px',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none', borderRadius: '12px',
              color: 'white', fontSize: '16px', fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
            }}>
              {loading ? '⏳ Uniéndome...' : '🤝 Unirme al negocio'}
            </button>

            {/* Botón de emergencia - unión manual */}
            <button
              onClick={forceJoinManually}
              disabled={forceCreating || !joinCode.trim()}
              style={{
                width: '100%', marginTop: '12px', padding: '10px',
                background: 'transparent', border: '1px solid #f59e0b',
                borderRadius: '10px', color: 'var(--accent-amber)', fontSize: '12px',
                cursor: (forceCreating || !joinCode.trim()) ? 'not-allowed' : 'pointer',
                fontWeight: 500, opacity: (forceCreating || !joinCode.trim()) ? 0.5 : 1
              }}
            >
              {forceCreating ? '⏳ Uniendo...' : '🔧 Unión manual (solución de emergencia)'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}