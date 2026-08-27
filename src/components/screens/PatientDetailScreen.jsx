// src/components/screens/PatientDetailScreen.jsx

import React, { useState, useEffect } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import PDFViewer from '../common/PDFViewer'
import { PatientTimeline } from './PatientTimeline'
import { newId, normalizarNotas, fechaDeNota, motivosParaNoBorrarCliente } from '../../utils/helpers'
import { ACTIVE_STATUSES } from '../../utils/constants'
import { 
  saveClientDocument, 
  getClientDocuments, 
  deleteClientDocument, 
  deleteAllClientDocuments,
  readClientDocument,
  downloadClientDocument 
} from '../../utils/exportImport'

export function PatientDetailScreen({ nav, patients, appointments, updatePatient, deletePatient, params }) {
  const toast = useToast()
  const { confirm } = useConfirm()
  const [patient, setPatient] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [documents, setDocuments] = useState([])
  const [selectedPDF, setSelectedPDF] = useState(null)
  const [selectedPDFName, setSelectedPDFName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  // Selección múltiple de notas. Los ids se guardan como string: las notas
  // viejas pueden tener id numérico y las nuevas string, y un Set no los
  // considera iguales.
  // SIEMPRE un array, venga como venga.
  //
  // Los clientes creados por un pedido web tenían `notes` como STRING. Como
  // el resto del código asume array, la pantalla desarmaba el texto en
  // caracteres: 45 filas vacías con "Invalid Date", y todas con id undefined
  // — por eso "Todas" seleccionaba una sola.
  const notas = normalizarNotas(patient?.notes)

  const [modoSeleccion, setModoSeleccion] = useState(false)
  const [notasElegidas, setNotasElegidas] = useState(() => new Set())
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    birthDate: '',
    observations: ''
  })

  // Cargar paciente cuando cambia el ID
  useEffect(() => {
    const found = patients.find(p => p.id === params.patientId)
    if (found) {
      setPatient(found)
      setFormData({
        name: found.name || '',
        phone: found.phone || '',
        email: found.email || '',
        address: found.address || '',
        birthDate: found.birthDate || '',
        observations: found.observations || ''
      })
      loadDocuments(found.id)
    }
  }, [params.patientId, patients])

  // Los adjuntos pasaron a vivir en el disco (electron/documentStore.cjs), así
  // que listarlos es asíncrono. La primera llamada por cliente migra sola lo
  // que hubiera quedado en localStorage.
  const loadDocuments = async (patientId) => {
    try {
      setDocuments(await getClientDocuments(patientId))
    } catch (err) {
      console.error('[PatientDetail] Error cargando documentos:', err)
      setDocuments([])
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    if (!allowedTypes.includes(file.type)) {
      toast.addToast('❌ Solo se permiten archivos PDF, JPG o PNG', 'error')
      return
    }
    
    if (file.size > 10 * 1024 * 1024) {
      toast.addToast('❌ El archivo es demasiado grande. Máximo 10MB', 'error')
      return
    }
    
    setUploading(true)
    try {
      const doc = await saveClientDocument(patient.id, file, 'document')
      setDocuments(prev => [...prev, doc])
      toast.addToast(`✅ Documento "${file.name}" subido correctamente`, 'success')
    } catch (error) {
      toast.addToast('❌ Error al subir el documento', 'error')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Los metadatos ya no traen los bytes: se leen del disco recién al abrir.
  // Eso es justamente lo que evita cargar todos los adjuntos en memoria.
  const handleViewDocument = async (doc) => {
    try {
      const dataUrl = doc.data || await readClientDocument(patient.id, doc.id)
      if (!dataUrl) {
        toast.addToast('❌ No se pudo abrir el archivo', 'error')
        return
      }
      if (doc.mimeType === 'application/pdf') {
        setSelectedPDF(dataUrl)
        setSelectedPDFName(doc.name)
      } else if (window.electronAPI?.openFile) {
        const res = await window.electronAPI.openFile(dataUrl, doc.name)
        if (!res?.success) toast.addToast(res?.error || '❌ No se pudo abrir el archivo', 'error')
      } else {
        window.open(dataUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      console.error('[PatientDetail] Error abriendo documento:', err)
      toast.addToast('❌ No se pudo abrir el archivo', 'error')
    }
  }

  const handleDeleteDocument = async (doc) => {
    if (await confirm(`¿Eliminar "${doc.name}"?`)) {
      try {
        await deleteClientDocument(patient.id, doc.id)
        setDocuments(prev => prev.filter(d => String(d.id) !== String(doc.id)))
        toast.addToast('✅ Documento eliminado', 'success')
      } catch (err) {
        console.error('[PatientDetail] Error borrando documento:', err)
        toast.addToast('❌ No se pudo eliminar el documento', 'error')
      }
    }
  }

  const getFileIcon = (mimeType) => {
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.startsWith('image/')) return '🖼️'
    return '📎'
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.addToast('El nombre es obligatorio', 'error')
      return
    }
    updatePatient(patient.id, formData)
    setPatient({ ...patient, ...formData })
    setIsEditing(false)
    toast.addToast('Cliente actualizado', 'success')
  }

  // ========== NOTAS: VERSIÓN CORREGIDA ==========
  const handleAddNote = async () => {
    if (!newNote.trim()) {
      toast.addToast('Escribe una nota antes de guardar', 'error')
      return
    }

    const note = {
      id: newId(),
      content: newNote,
      date: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString()
    }

    const currentNotes = notas
    const updatedNotes = [...currentNotes, note]
    
    // Actualizar en el estado local
    updatePatient(patient.id, { notes: updatedNotes })
    setPatient(prev => ({ ...prev, notes: updatedNotes }))
    setNewNote('')
    toast.addToast('📝 Nota agregada', 'success')
  }

  // La nota que se agrega desde el Historial es la MISMA que la de la pestaña
  // Notas: mismo formato, mismo updatePatient, misma persistencia. Antes el
  // botón del Historial escribía en un useState de PatientTimeline y se perdía.
  const guardarNotaDesdeHistorial = (texto) => {
    if (!texto?.trim() || !patient) return
    const note = {
      id: newId(),
      content: texto.trim(),
      date: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString(),
    }
    const updatedNotes = [...notas, note]
    updatePatient(patient.id, { notes: updatedNotes })
    setPatient(prev => ({ ...prev, notes: updatedNotes }))
    toast.addToast('📝 Nota agregada', 'success')
  }

  // ========== ELIMINAR NOTA ==========
  const handleDeleteNote = async (noteId) => {
    const confirmed = await confirm(
      '¿Eliminar esta nota?', 
      'Esta acción no se puede deshacer'
    )
    if (!confirmed) return

    const currentNotes = notas
    // String() en las dos puntas: las notas creadas por versiones anteriores
    // pueden tener id numérico, y `!==` estricto no las encontraría.
    const updatedNotes = currentNotes.filter(n => String(n.id) !== String(noteId))

    if (updatedNotes.length === currentNotes.length) {
      toast.addToast('No se encontró esa nota', 'error')
      return
    }

    updatePatient(patient.id, { notes: updatedNotes })
    setPatient(prev => ({ ...prev, notes: updatedNotes }))
    toast.addToast('Nota eliminada', 'success')
  }

  // ========== NOTAS: SELECCIÓN MÚLTIPLE ==========
  const alternarNota = (noteId) => {
    setNotasElegidas(prev => {
      const next = new Set(prev)
      const k = String(noteId)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  const salirDeSeleccion = () => {
    setModoSeleccion(false)
    setNotasElegidas(new Set())
  }

  const alternarTodas = () => {
    const todas = notas.map(n => String(n.id))
    setNotasElegidas(prev => (prev.size === todas.length ? new Set() : new Set(todas)))
  }

  const borrarNotasElegidas = async () => {
    const cuantas = notasElegidas.size
    if (cuantas === 0) return

    const ok = await confirm(
      cuantas === 1
        ? '¿Eliminar la nota seleccionada?'
        : `¿Eliminar ${cuantas} notas?`,
      'Esto no se puede deshacer'
    )
    if (!ok) return

    const currentNotes = notas
    const updatedNotes = currentNotes.filter(n => !notasElegidas.has(String(n.id)))

    updatePatient(patient.id, { notes: updatedNotes })
    setPatient(prev => ({ ...prev, notes: updatedNotes }))
    salirDeSeleccion()
    toast.addToast(
      cuantas === 1 ? 'Nota eliminada' : `${cuantas} notas eliminadas`, 'success')
  }

  // ========== VERIFICAR SI EL CLIENTE TIENE PEDIDOS ACTIVOS ==========
  const hasActiveOrders = () => {
    if (!patient) return false
    
    // 1. Verificar en appointments (agenda profesional)
    const activeAppointments = appointments.filter(apt => {
      const isMatch = apt.patientId === patient.id
      const isActive = apt.status !== 'completed' && apt.status !== 'cancelled' && apt.status !== 'delivered'
      return isMatch && isActive
    })
    
    if (activeAppointments.length > 0) return true
    
    // 2. Verificar en localStorage del panel emprendedor
    try {
      const emprendedorPedidos = localStorage.getItem('zenday-emprendedor-pedidos')
      if (emprendedorPedidos) {
        const pedidos = JSON.parse(emprendedorPedidos)
        const activePedidos = pedidos.filter(p => 
          p.cliente === patient.name && p.estado !== 'ENTREGADO'
        )
        if (activePedidos.length > 0) return true
      }
    } catch (err) {
      console.error('[PatientDetail] Error checking emprendedor orders:', err)
    }
    
    return false
  }

  // ========== ELIMINAR CLIENTE CON VALIDACIÓN ==========
  const handleDeletePatient = async () => {
    if (isDeleting) return
    
    // No se borra un cliente que todavía tiene cosas colgando: pedidos sin
    // cerrar, notas o documentos. Los tres son resolubles por el usuario, así
    // que el cartel dice exactamente qué falta en vez de dar una orden
    // imposible como la de antes ("completá los pedidos" cuando ya estaban
    // completos).
    const pedidosActivos = (appointments || []).filter(a =>
      ACTIVE_STATUSES.has(a.status) && String(a.patientId) === String(patient.id)
    ).length

    const motivos = motivosParaNoBorrarCliente({
      pedidosActivos: pedidosActivos + (hasActiveOrders() && !pedidosActivos ? 1 : 0),
      notas:    notas.length,
      adjuntos: documents.length,
    })

    if (motivos.length > 0) {
      await confirm(
        `No se puede eliminar a ${patient.name} todavía.\n\n` +
        `Tiene ${motivos.join(', ')}.\n\n` +
        'Eliminá eso primero desde las pestañas de arriba y volvé a intentar.',
        'Falta vaciar el cliente',
        { showCancel: false, confirmText: 'Entendido' }
      )
      return
    }
    
    // Confirmación final
    const confirmed = await confirm(
      `⚠️ ¿ELIMINAR CLIENTE?\n\n` +
      `Cliente: ${patient.name}\n` +
      `Citas: ${appointments.filter(a => a.patientId === patient.id).length}\n\n` +
      `Esta acción NO se puede deshacer.\n\n` +
      `¿Estás ABSOLUTAMENTE seguro?`,
      'Eliminar cliente',
      true
    )
    
    if (!confirmed) return
    
    setIsDeleting(true)
    
    try {
      // Eliminar documentos asociados (borra la carpeta entera de una)
      // El orden importa: deletePatient puede devolver false (el cliente tiene
      // pedidos activos, o el usuario cancela el segundo cartel). Si los
      // documentos se borran primero, el cliente se queda en la lista pero sus
      // PDF, estudios e informes ya no existen. Se borra el cliente PRIMERO y
      // recien despues sus archivos.
      
      // FIX: deletePatient devuelve false si el cliente tiene pedidos activos
      // o si el usuario cancela la confirmación. Antes se ignoraba y salía
      // "🗑️ Cliente eliminado" + volver atrás, con el cliente todavía en la lista.
      const eliminado = await deletePatient(patient.id)
      if (eliminado === false) return   // deletePatient ya explicó el motivo

      await deleteAllClientDocuments(patient.id)
      toast.addToast(`🗑️ Cliente "${patient.name}" eliminado`, 'success')
      nav.goBack()
    } catch (error) {
      console.error('[PatientDetail] Error deleting patient:', error)
      toast.addToast('❌ Error al eliminar el cliente', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  if (!patient) return null

  // Filtrar appointments por patientId
  const patientAppointments = appointments.filter(apt => apt.patientId === patient.id)
  const totalAppointments = patientAppointments.length
  const totalBilled = patientAppointments.reduce((sum, apt) => sum + (apt.price || 0), 0)
  const pendingAmount = patientAppointments
    .filter(apt => !apt.paid && (apt.status === 'completed' || apt.status === 'delivered'))
    .reduce((sum, apt) => sum + (apt.price || 0), 0)

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(value)
  }

  const TABS = [
    { key: 'info',      label: '👤 Información' },
    { key: 'history',   label: '📋 Historial' },
    { key: 'notes',     label: `📝 Notas (${notas.length})` },
    { key: 'documents', label: `📎 Documentos (${documents.length})` },
  ]

  return (
    <div className="patient-detail-screen">
      {/* ── Top bar ── */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">
          {isEditing ? '✏️ Editar cliente' : `👤 ${patient.name}`}
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!isEditing && activeTab === 'info' && (
            <button className="edit-btn" onClick={() => setIsEditing(true)}>
              ✏️ Editar
            </button>
          )}
          {!isEditing && activeTab === 'info' && (
            <button 
              className="danger-btn" 
              onClick={handleDeletePatient}
              disabled={isDeleting}
              style={{ 
                padding: '9px 20px',
                background: 'transparent',
                border: '1px solid var(--accent-red)',
                borderRadius: '40px',
                color: 'var(--accent-red)',
                cursor: isDeleting ? 'wait' : 'pointer',
                opacity: isDeleting ? 0.6 : 1
              }}
            >
              {isDeleting ? '⏳ Eliminando...' : '🗑️ Eliminar'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      {!isEditing && (
        <div className="patient-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`patient-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab: Información ── */}
      {(activeTab === 'info' || isEditing) && (
        isEditing ? (
          <div className="patient-form">
            <div className="form-group">
              <label>Nombre completo *</label>
              <input 
                type="text" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Teléfono / WhatsApp</label>
                <input 
                  type="tel" 
                  value={formData.phone} 
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  placeholder="099 123 456"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input 
                  type="email" 
                  value={formData.email} 
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  placeholder="cliente@email.com"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Dirección</label>
              <input 
                type="text" 
                value={formData.address} 
                onChange={e => setFormData({...formData, address: e.target.value})}
                placeholder="Dirección del cliente"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Fecha de nacimiento</label>
                <input 
                  type="date" 
                  value={formData.birthDate} 
                  onChange={e => setFormData({...formData, birthDate: e.target.value})}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Observaciones</label>
              <textarea 
                value={formData.observations} 
                onChange={e => setFormData({...formData, observations: e.target.value})}
                rows={3}
                placeholder="Notas adicionales..."
              />
            </div>
            <div className="form-actions">
              <button className="btn-secondary" onClick={() => setIsEditing(false)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleSave}>
                Guardar cambios
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="patient-info">
              <div className="info-row">
                <span className="info-label">📞 Teléfono:</span>
                <span className="info-value">{patient.phone || 'No registrado'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">📧 Email:</span>
                <span className="info-value">{patient.email || 'No registrado'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">📍 Dirección:</span>
                <span className="info-value">{patient.address || 'No registrada'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">🎂 Fecha nacimiento:</span>
                <span className="info-value">{patient.birthDate || 'No registrada'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">📝 Observaciones:</span>
                <span className="info-value">{patient.observations || 'Sin observaciones'}</span>
              </div>
            </div>

            {/* Tarjetas de estadísticas */}
            <div className="patient-stats-cards">
              <div className="stat-card-mini">
                <div className="stat-icon">📅</div>
                <div className="stat-info">
                  <span className="stat-value">{totalAppointments}</span>
                  <span className="stat-label">Citas totales</span>
                </div>
              </div>
              <div className="stat-card-mini">
                <div className="stat-icon">💰</div>
                <div className="stat-info">
                  <span className="stat-value">{formatCurrency(totalBilled)}</span>
                  <span className="stat-label">Facturado</span>
                </div>
              </div>
              <div className="stat-card-mini pending">
                <div className="stat-icon">⏳</div>
                <div className="stat-info">
                  <span className="stat-value">{formatCurrency(pendingAmount)}</span>
                  <span className="stat-label">Pendiente</span>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* ── Tab: Historial ── */}
      {activeTab === 'history' && !isEditing && (
        <div className="patient-history-tab">
          <PatientTimeline
            patient={patient}
            appointments={patientAppointments}
            onNavigate={nav.navigate}
            onAddNote={guardarNotaDesdeHistorial}
          />
        </div>
      )}

      {/* ── Tab: Notas (CORREGIDO) ── */}
      {activeTab === 'notes' && !isEditing && (
        <div className="notes-section">
          <div className="notes-header">
            <h3>📝 Notas del cliente</h3>

            {/* El botón aparece con 2 notas, no con 8: si tenés 7 y querés
                borrar 5, el umbral alto te deja igual clic por clic. */}
            {notas.length >= 2 && !modoSeleccion && (
              <button className="btn-secondary" onClick={() => setModoSeleccion(true)}>
                Seleccionar
              </button>
            )}

            {modoSeleccion && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn-secondary" onClick={alternarTodas}>
                  {notasElegidas.size === notas.length
                    ? 'Ninguna' : 'Todas'}
                </button>
                <button
                  className="btn-primary"
                  onClick={borrarNotasElegidas}
                  disabled={notasElegidas.size === 0}
                  style={{
                    background: notasElegidas.size ? 'var(--accent-red, #ef4444)' : undefined,
                    opacity: notasElegidas.size ? 1 : 0.5,
                    cursor: notasElegidas.size ? 'pointer' : 'not-allowed',
                  }}
                >
                  🗑️ Eliminar{notasElegidas.size ? ` (${notasElegidas.size})` : ''}
                </button>
                <button className="btn-secondary" onClick={salirDeSeleccion}>
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="notes-list">
            {notas.length === 0 ? (
              <div className="no-notes">
                <span>📭</span>
                <p>No hay notas</p>
                <small>Agrega notas importantes sobre el cliente</small>
              </div>
            ) : (
              /* Se ordena por FECHA, no por id.
                 Antes era `b.id - a.id`, pero los ids son strings desde que se
                 usa newId(): la resta daba NaN y el orden quedaba al azar. */
              [...notas]
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                .map((note, i) => {
                  const elegida = notasElegidas.has(String(note.id))
                  return (
                    <div
                      key={note.id ?? `sin-id-${i}`}
                      className="note-item"
                      onClick={modoSeleccion ? () => alternarNota(note.id) : undefined}
                      style={modoSeleccion ? {
                        cursor: 'pointer',
                        background: elegida ? 'rgba(244, 63, 94, 0.08)' : undefined,
                      } : undefined}
                    >
                      {modoSeleccion && (
                        <input
                          type="checkbox"
                          checked={elegida}
                          onChange={() => alternarNota(note.id)}
                          onClick={e => e.stopPropagation()}
                          aria-label="Seleccionar nota"
                          style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
                        />
                      )}
                      <div className="note-content">
                        {/* Una nota sin texto se veía como una fila en blanco.
                            Ahora se dice qué pasó en vez de no mostrar nada. */}
                        {note.content
                          ? <p>{note.content}</p>
                          : <p className="note-vacia">Nota sin texto</p>}
                        <div className="note-meta">
                          <span>📅 {fechaDeNota(note)}</span>
                          {note.heredada && (
                            <span className="note-heredada" title="Venía guardada como texto suelto, de una versión anterior">
                              heredada
                            </span>
                          )}
                        </div>
                      </div>
                      {!modoSeleccion && (
                        <button
                          className="delete-note"
                          onClick={() => handleDeleteNote(note.id)}
                          title="Eliminar nota"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  )
                })
            )}
          </div>

          <div className="add-note">
            <textarea
              placeholder="Escribe una nota..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={3}
            />
            <button onClick={handleAddNote} className="btn-primary">
              + Agregar nota
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Documentos ── */}
      {activeTab === 'documents' && !isEditing && (
        <div className="documents-section">
          <div className="documents-header">
            <h3>📎 Documentos adjuntos</h3>
            <label className={`upload-btn ${uploading ? 'uploading' : ''}`}>
              {uploading ? '⏳ Subiendo...' : '📤 Subir documento'}
              <input 
                type="file" 
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
                disabled={uploading}
                hidden
              />
            </label>
          </div>
          
          <div className="documents-list">
            {documents.length === 0 ? (
              <div className="no-documents">
                <span>📁</span>
                <p>No hay documentos adjuntos</p>
                <small>Sube documentos, facturas o archivos relacionados</small>
              </div>
            ) : (
              documents.map(doc => (
                <div key={doc.id} className="document-item">
                  <div className="document-icon">{getFileIcon(doc.mimeType)}</div>
                  <div className="document-info">
                    <div className="document-name">{doc.name}</div>
                    <div className="document-meta">
                      {formatFileSize(doc.size)} • {new Date(doc.uploadDate).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="document-actions">
                    <button 
                      className="view-btn"
                      onClick={() => handleViewDocument(doc)}
                      title="Ver documento"
                    >
                      👁️
                    </button>
                    <button 
                      className="download-btn"
                      onClick={() => downloadClientDocument(doc, patient.id)}
                      title="Descargar"
                    >
                      📥
                    </button>
                    <button 
                      className="delete-btn"
                      onClick={() => handleDeleteDocument(doc)}
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Modal PDF ── */}
      {selectedPDF && (
        <PDFViewer 
          file={selectedPDF} 
          onClose={() => setSelectedPDF(null)}
          fileName={selectedPDFName}
        />
      )}
    </div>
  )
}