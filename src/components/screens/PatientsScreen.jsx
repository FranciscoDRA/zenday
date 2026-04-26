import React, { useState, useMemo, useRef, useCallback } from 'react'
import PatientTimeline from './PatientTimeline'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { 
  importPatientsFromExcel, 
  downloadPatientTemplate,
  exportPatientsToPDF,
  exportPatientsToExcel
} from '../../utils/exportImport'

export function PatientsScreen({ nav, patients, addPatient, updatePatient, deletePatient, appointments }) {
  const focusRef = useScreenFocus()
  const toast = useToast()
  const { confirm } = useConfirm() // CORREGIDO Bug 1: useConfirm descomentado
  
  const fileInputRef = useRef(null)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [editingPatient, setEditingPatient] = useState(null)
  const [formData, setFormData] = useState({ 
    name: '', phone: '', email: '', birthDate: '', address: '', observations: '', attachments: [] 
  })

  // CORREGIDO Bug 2: filtered con manejo de null/undefined
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return patients.filter(p => 
      (p.name || '').toLowerCase().includes(q) || 
      (p.phone || '').includes(q) || 
      (p.email || '').toLowerCase().includes(q)
    )
  }, [patients, searchQuery])

  // CORREGIDO Bug 3: contador de pedidos usando patientId
  const getPatientOrderCount = useCallback((patientId, patientName) => {
    return appointments.filter(a => 
      a.patientId === patientId || (a.patientName && a.patientName === patientName)
    ).length
  }, [appointments])

  // ========== FUNCIONES DE GESTIÓN DE CLIENTES ==========
  
  const generatePatientId = () => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  const isDuplicatePatient = (patientData, excludeId = null) => {
    return patients.some(p => {
      if (excludeId && p.id === excludeId) return false
      const sameName = (p.name || '').toLowerCase().trim() === (patientData.name || '').toLowerCase().trim()
      const samePhone = (patientData.phone && p.phone && p.phone.trim() === patientData.phone.trim())
      const sameEmail = (patientData.email && p.email && p.email.toLowerCase().trim() === patientData.email.toLowerCase().trim())
      return sameName || samePhone || sameEmail
    })
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.addToast('El nombre es obligatorio', 'error')
      return
    }

    if (editingPatient) {
      // Verificar duplicados excluyendo el cliente actual
      if (isDuplicatePatient(formData, editingPatient.id)) {
        toast.addToast('⚠️ Ya existe un cliente con ese nombre, teléfono o email', 'warning')
        return
      }
      updatePatient(editingPatient.id, {
        ...formData,
        updatedAt: new Date().toISOString()
      })
      toast.addToast('✅ Cliente actualizado', 'success')
    } else {
      // Verificar duplicados
      if (isDuplicatePatient(formData)) {
        toast.addToast('⚠️ Ya existe un cliente con ese nombre, teléfono o email', 'warning')
        return
      }
      
      const newPatient = {
        ...formData,
        id: generatePatientId(),
        totalVisits: 0,
        kanbanStatus: 'prospect',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      addPatient(newPatient)
      toast.addToast('✅ Cliente creado', 'success')
    }

    setFormData({ name: '', phone: '', email: '', birthDate: '', address: '', observations: '', attachments: [] })
    setShowForm(false)
    setEditingPatient(null)
  }

  const handleEdit = (patient) => {
    setEditingPatient(patient)
    setFormData({
      name: patient.name || '',
      phone: patient.phone || '',
      email: patient.email || '',
      birthDate: patient.birthDate || '',
      address: patient.address || '',
      observations: patient.observations || '',
      attachments: patient.attachments || []
    })
    setShowForm(true)
  }

  // CORREGIDO Bug 1: usar useConfirm en lugar de window.confirm
  const handleDelete = async (patient) => {
    // Verificar citas pendientes
    const futureAppointments = appointments.filter(apt => 
      (apt.patientId === patient.id || apt.patientName === patient.name) && 
      ['scheduled', 'confirmed', 'in-progress', 'pending'].includes(apt.status) &&
      new Date(apt.startTime) >= new Date()
    )
    
    if (futureAppointments.length > 0) {
      toast.addToast(`❌ No se puede eliminar: el cliente tiene ${futureAppointments.length} pedido(s) pendiente(s)`, 'error')
      return
    }
    
    // Verificar citas pasadas
    const pastAppointments = appointments.filter(apt => 
      (apt.patientId === patient.id || apt.patientName === patient.name)
    )
    
    const confirmMessage = pastAppointments.length > 0
      ? `⚠️ ELIMINAR CLIENTE\n\n` +
        `Cliente: ${patient.name}\n` +
        `Teléfono: ${patient.phone || 'No registrado'}\n` +
        `Email: ${patient.email || 'No registrado'}\n\n` +
        `📊 Este cliente tiene ${pastAppointments.length} cita(s) en el historial.\n` +
        `💰 ${pastAppointments.filter(a => a.paid).length} cita(s) pagadas.\n\n` +
        `❗ Estas citas quedarán huérfanas en el sistema.\n\n` +
        `¿Estás ABSOLUTAMENTE seguro de eliminar a este cliente?`
      : `⚠️ ELIMINAR CLIENTE\n\n` +
        `Cliente: ${patient.name}\n` +
        `Teléfono: ${patient.phone || 'No registrado'}\n` +
        `Email: ${patient.email || 'No registrado'}\n\n` +
        `¿Estás seguro de eliminar a este cliente?`
    
    const confirmed = await confirm(confirmMessage, 'Eliminar cliente')
    if (confirmed) {
      deletePatient(patient.id)
      toast.addToast('🗑️ Cliente eliminado', 'info')
    }
  }

  // CORREGIDO Bug 4: handleOpenAttachment con electronAPI
  const handleOpenAttachment = (file) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(file.data)
    } else if (window.electronAPI?.openFile) {
      window.electronAPI.openFile(file.data, file.name)
    } else {
      window.open(file.data, '_blank', 'noopener,noreferrer')
    }
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    if (!allowedTypes.includes(file.type)) {
      toast.addToast('Solo se permiten archivos PDF, JPG o PNG', 'error')
      return
    }
    
    if (file.size > 5 * 1024 * 1024) {
      toast.addToast('El archivo no puede superar los 5MB', 'error')
      return
    }
    
    const reader = new FileReader()
    reader.onload = (event) => {
      setFormData(prev => ({ 
        ...prev, 
        attachments: [...(prev.attachments || []), { 
          name: file.name, 
          type: file.type,
          data: event.target.result, 
          date: new Date().toISOString() 
        }] 
      }))
    }
    reader.readAsDataURL(file)
    e.target.value = '' // Limpiar input
  }

  const removeAttachment = (index) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index)
    }))
  }

  // ========== FUNCIONES DE IMPORTACIÓN/EXPORTACIÓN ==========

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    try {
      const result = await importPatientsFromExcel(file)
      let imported = 0
      let skipped = 0

      result.patients.forEach(p => {
        const exists = patients.some(existing =>
          (existing.name || '').toLowerCase().trim() === (p.name || '').toLowerCase().trim() ||
          (p.phone && existing.phone && existing.phone.trim() === p.phone.trim())
        )

        if (exists) {
          skipped++
        } else {
          addPatient({ 
            ...p, 
            id: generatePatientId(),
            attachments: [], 
            totalVisits: 0, 
            kanbanStatus: 'prospect',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          imported++
        }
      })

      if (imported > 0 && skipped === 0) {
        toast.addToast(`✅ ${imported} clientes importados correctamente`, 'success')
      } else if (imported > 0 && skipped > 0) {
        toast.addToast(`✅ ${imported} importados, ${skipped} ignorados por duplicado`, 'success')
      } else {
        toast.addToast(`⚠️ Todos los clientes ya existen (${skipped} duplicados)`, 'warning')
      }
    } catch (error) {
      toast.addToast(error.message || 'Error al importar el archivo', 'error')
    }
    
    e.target.value = ''
  }

  const handleExportExcel = () => {
    if (patients.length === 0) {
      toast.addToast('No hay clientes para exportar', 'error')
      return
    }
    exportPatientsToExcel(patients, appointments)
    toast.addToast('📊 Excel generado correctamente', 'success')
  }

  const handleExportPDF = () => {
    if (patients.length === 0) {
      toast.addToast('No hay clientes para exportar', 'error')
      return
    }
    exportPatientsToPDF(patients, appointments)
    toast.addToast('📄 PDF generado correctamente', 'success')
  }

  const hasPatients = patients.length > 0

  return (
    <div ref={focusRef} tabIndex={-1} className="patients-screen">
      {/* Header */}
      <div className="screen-header">
        <div className="header-left">
          <BackButton onClick={() => nav.goBack()} />
          <h1 className="screen-title">
            Clientes
            {hasPatients && <span className="item-count">{filtered.length} de {patients.length}</span>}
          </h1>
        </div>
        
        <div className="header-actions">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input 
              placeholder="Buscar cliente..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>

          <button className="btn-secondary" onClick={handleImportClick}>
            📤 Importar Excel
          </button>

          <button 
            className="btn-primary"
            onClick={() => {
              setEditingPatient(null)
              setFormData({ name: '', phone: '', email: '', birthDate: '', address: '', observations: '', attachments: [] })
              setShowForm(true)
            }}
          >
            <span>+</span> Nuevo cliente
          </button>

          {hasPatients && (
            <div className="more-menu-container">
              <button className="btn-icon" onClick={() => setShowMoreMenu(!showMoreMenu)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="6" r="2" fill="currentColor" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                  <circle cx="12" cy="18" r="2" fill="currentColor" />
                </svg>
              </button>
              
              {showMoreMenu && (
                <>
                  <div className="menu-backdrop" onClick={() => setShowMoreMenu(false)} />
                  <div className="more-menu">
                    <button onClick={() => { downloadPatientTemplate(); setShowMoreMenu(false) }}>
                      <span>📋</span> Descargar plantilla
                    </button>
                    <div className="menu-divider" />
                    <button onClick={() => { handleExportExcel(); setShowMoreMenu(false) }}>
                      <span>📊</span> Exportar a Excel
                    </button>
                    <button onClick={() => { handleExportPDF(); setShowMoreMenu(false) }}>
                      <span>📄</span> Exportar a PDF
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input oculto para importar */}
      <input 
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".xlsx,.xls"
        onChange={handleFileSelected}
      />

      {/* Empty State */}
      {!hasPatients ? (
        <div className="empty-state-premium">
          <div className="empty-illustration">
            <svg viewBox="0 0 120 120" fill="none">
              <circle cx="60" cy="45" r="20" fill="rgba(99,102,241,0.1)" />
              <circle cx="60" cy="40" r="16" fill="rgba(99,102,241,0.15)" />
              <path d="M30 80 Q60 60 90 80" stroke="rgba(99,102,241,0.2)" strokeWidth="3" fill="none" />
              <circle cx="45" cy="35" r="4" fill="#6366f1" />
              <circle cx="75" cy="35" r="4" fill="#6366f1" />
            </svg>
          </div>
          <h2>Comienza a gestionar tus clientes</h2>
          <p>Importa tus contactos desde Excel o crea tu primer cliente manualmente</p>
          
          <div className="empty-actions-premium">
            <button className="btn-primary-large" onClick={() => setShowForm(true)}>
              <span>+</span> Crear primer cliente
            </button>
            
            <div className="import-options">
              <button className="btn-secondary-large" onClick={downloadPatientTemplate}>
                <span>📋</span> Descargar plantilla Excel
              </button>
              <button className="btn-secondary-large" onClick={handleImportClick}>
                <span>📤</span> Tengo un Excel con mis clientes
              </button>
            </div>
          </div>
          
          <p className="empty-hint">
            La plantilla incluye: Nombre, Apellido, Celular, Correo y Fecha de nacimiento
          </p>
        </div>
      ) : (
        <>
          {/* Guía rápida */}
          <div className="quick-guide">
            <details>
              <summary>📥 ¿Cómo importar clientes desde Excel?</summary>
              <div className="guide-content">
                <div className="guide-steps">
                  <div className="guide-step"><span>1.</span> Descarga la plantilla</div>
                  <div className="guide-step"><span>2.</span> Llena el Excel con tus datos</div>
                  <div className="guide-step"><span>3.</span> Haz clic en "Importar desde Excel"</div>
                </div>
                <button className="btn-link" onClick={downloadPatientTemplate}>
                  Descargar plantilla →
                </button>
              </div>
            </details>
          </div>

          {/* Lista de clientes */}
          <div className="patients-list-premium">
            {filtered.length === 0 ? (
              <div className="no-results">
                <span>🔍</span>
                <p>No hay clientes que coincidan con "{searchQuery}"</p>
                <button className="btn-link" onClick={() => setSearchQuery('')}>Limpiar búsqueda</button>
              </div>
            ) : (
              filtered.map(p => {
                const orderCount = getPatientOrderCount(p.id, p.name)
                return (
                  <div 
                    key={p.id} 
                    className="patient-card-premium" 
                    onClick={() => nav.navigate('patientDetail', { patientId: p.id })}
                  >
                    <div className="patient-avatar-premium">
                      {(p.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="patient-info-premium">
                      <h4>{p.name}</h4>
                      <div className="patient-meta">
                        {p.phone && <span>📞 {p.phone}</span>}
                        {p.email && <span>✉️ {p.email}</span>}
                      </div>
                    </div>
                    <div className="patient-badge">
                      {orderCount} {orderCount === 1 ? 'pedido' : 'pedidos'}
                    </div>
                    <div className="patient-actions-premium" onClick={e => e.stopPropagation()}>
                      <button className="btn-icon-sm" onClick={() => handleEdit(p)}>✏️</button>
                      <button className="btn-icon-sm danger" onClick={() => handleDelete(p)}>🗑️</button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}

      {/* Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingPatient ? '✏️ Editar cliente' : '➕ Nuevo cliente'}</h3>
              <button className="btn-icon" onClick={() => setShowForm(false)}>✕</button>
            </div>
            
            <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: '60vh' }}>
              <div className="form-group">
                <label className="form-label required">Nombre completo</label>
                <input 
                  className="form-input" 
                  placeholder="Ej: Juan Pérez" 
                  value={formData.name} 
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} 
                  autoFocus
                />
              </div>
              
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label">📞 Teléfono</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej: 099123456" 
                    value={formData.phone} 
                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} 
                  />
                </div>
                
                <div className="form-group">
                  <label className="form-label">✉️ Email</label>
                  <input 
                    className="form-input" 
                    type="email"
                    placeholder="Ej: juan@email.com" 
                    value={formData.email} 
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} 
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label className="form-label">🎂 Fecha de nacimiento</label>
                <input 
                  className="form-input" 
                  type="date" 
                  value={formData.birthDate} 
                  onChange={e => setFormData(p => ({ ...p, birthDate: e.target.value }))} 
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">📍 Dirección</label>
                <textarea 
                  className="form-textarea" 
                  placeholder="Dirección completa..." 
                  value={formData.address} 
                  onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} 
                  rows={2} 
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">📝 Observaciones</label>
                <textarea 
                  className="form-textarea" 
                  placeholder="Notas adicionales..." 
                  value={formData.observations} 
                  onChange={e => setFormData(p => ({ ...p, observations: e.target.value }))} 
                  rows={3} 
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">📎 Adjuntar archivos</label>
                <div className="file-upload-area">
                  <input 
                    type="file" 
                    accept=".pdf,.jpg,.jpeg,.png" 
                    onChange={handleFileUpload} 
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="file-upload-label">
                    📁 Seleccionar archivo (PDF, JPG, PNG - máx 5MB)
                  </label>
                </div>
                
                {formData.attachments?.length > 0 && (
                  <div className="attachments-list">
                    {formData.attachments.map((file, idx) => (
                      <div key={idx} className="attachment-item">
                        <span 
                          style={{ cursor: 'pointer', textDecoration: 'underline' }} 
                          onClick={() => handleOpenAttachment(file)}
                        >
                          {file.type?.includes('pdf') ? '📄' : '🖼️'} {file.name}
                        </span>
                        <button className="icon-btn-sm" onClick={() => removeAttachment(idx)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn-primary" onClick={handleSave}>
                {editingPatient ? '💾 Guardar cambios' : '✅ Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}