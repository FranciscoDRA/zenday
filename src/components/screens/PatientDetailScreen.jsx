// src/components/screens/PatientDetailScreen.jsx

import React, { useState, useEffect } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import PDFViewer from '../common/PDFViewer'
import { PatientTimeline } from './PatientTimeline'
import { 
  saveClientDocument, 
  getClientDocuments, 
  deleteClientDocument, 
  downloadClientDocument 
} from '../../utils/exportImport'

export function PatientDetailScreen({ nav, patients, appointments, updatePatient, deletePatient, params }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [patient, setPatient] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [documents, setDocuments] = useState([])
  const [selectedPDF, setSelectedPDF] = useState(null)
  const [selectedPDFName, setSelectedPDFName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [newNote, setNewNote] = useState('')
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    birthDate: '',
    observations: ''
  })

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
    // 🔴 Eliminado el nav.goBack() para evitar redirecciones en renders intermedios
  }, [params.patientId, patients])

  const loadDocuments = (patientId) => {
    const docs = getClientDocuments(patientId)
    setDocuments(docs)
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

  const handleViewDocument = (doc) => {
    if (doc.mimeType === 'application/pdf') {
      setSelectedPDF(doc.data)
      setSelectedPDFName(doc.name)
    } else {
      window.open(doc.data, '_blank')
    }
  }

  const handleDeleteDocument = async (doc) => {
    if (await confirm(`¿Eliminar "${doc.name}"?`)) {
      deleteClientDocument(patient.id, doc.id)
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
      toast.addToast('✅ Documento eliminado', 'success')
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

  const handleAddNote = () => {
    if (!newNote.trim()) {
      toast.addToast('Escribe una nota antes de guardar', 'error')
      return
    }

    const note = {
      id: Date.now(),
      content: newNote,
      date: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString()
    }

    const updatedNotes = [...(patient.notes || []), note]
    updatePatient(patient.id, { notes: updatedNotes })
    setPatient({ ...patient, notes: updatedNotes })
    setNewNote('')
    toast.addToast('📝 Nota agregada', 'success')
  }

  const handleDeleteNote = async (noteId) => {
    if (await confirm('¿Eliminar esta nota?', 'Esta acción no se puede deshacer')) {
      const updatedNotes = (patient.notes || []).filter(n => n.id !== noteId)
      updatePatient(patient.id, { notes: updatedNotes })
      setPatient({ ...patient, notes: updatedNotes })
      toast.addToast('Nota eliminada', 'success')
    }
  }

  if (!patient) return null

  // 🔴 CORREGIDO: filtrar solo por patientId (evita mezclar clientes con el mismo nombre)
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
    { key: 'notes',     label: '📝 Notas' },
    { key: 'documents', label: '📎 Documentos' },
  ]

  return (
    <div className="patient-detail-screen">
      {/* ── Top bar ── */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">
          {isEditing ? '✏️ Editar cliente' : `👤 ${patient.name}`}
        </h2>
        {!isEditing && activeTab === 'info' && (
          <button className="edit-btn" onClick={() => setIsEditing(true)}>
            ✏️ Editar
          </button>
        )}
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
          />
        </div>
      )}

      {/* ── Tab: Notas ── */}
      {activeTab === 'notes' && !isEditing && (
        <div className="notes-section">
          <div className="notes-header">
            <h3>📝 Notas del cliente</h3>
          </div>
          
          <div className="notes-list">
            {(patient.notes || []).length === 0 ? (
              <div className="no-notes">
                <span>📭</span>
                <p>No hay notas</p>
                <small>Agrega notas importantes sobre el cliente</small>
              </div>
            ) : (
              (patient.notes || []).sort((a, b) => b.id - a.id).map(note => (
                <div key={note.id} className="note-item">
                  <div className="note-content">
                    <p>{note.content}</p>
                    <div className="note-meta">
                      <span>📅 {note.dateFormatted || new Date(note.date).toLocaleString()}</span>
                    </div>
                  </div>
                  <button 
                    className="delete-note"
                    onClick={() => handleDeleteNote(note.id)}
                    title="Eliminar nota"
                  >
                    🗑️
                  </button>
                </div>
              ))
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
                      onClick={() => downloadClientDocument(doc)}
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