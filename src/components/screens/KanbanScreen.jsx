import React, { useState } from 'react'
import { BackButton } from '../common/BackButton'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { DEFAULT_KANBAN_COLUMNS } from '../../utils/constants'

export function KanbanScreen({ nav, patients, updatePatient }) {
  const focusRef = useScreenFocus()
  const [columns] = useState(() => {
    const saved = localStorage.getItem('kanban-columns')
    return saved ? JSON.parse(saved) : DEFAULT_KANBAN_COLUMNS
  })
  
  // Estado para debug (mantenido pero sin alert)
  const [draggedPatient, setDraggedPatient] = useState(null)

  const handleDragStart = (e, patient) => {
    console.log('🎯 DragStart:', patient.name, 'ID:', patient.id)
    e.dataTransfer.setData('text/plain', String(patient.id))
    e.dataTransfer.effectAllowed = 'move'
    setDraggedPatient(patient)
    e.currentTarget.style.opacity = '0.5'
  }

  const handleDragEnd = (e) => {
    console.log('🏁 DragEnd')
    e.currentTarget.style.opacity = '1'
    setDraggedPatient(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, columnId) => {
    e.preventDefault()
    e.stopPropagation()
    
    const patientId = e.dataTransfer.getData('text/plain')
    console.log('📥 Drop en columna:', columnId, 'PatientID:', patientId)
    
    const patient = patients.find(p => String(p.id) === String(patientId))
    
    if (!patient) {
      console.error('❌ Paciente no encontrado con ID:', patientId)
      return
    }
    
    console.log('✅ Paciente encontrado:', patient.name, 'Status actual:', patient.kanbanStatus)
    
    if (patient.kanbanStatus !== columnId) {
      console.log('🔄 Actualizando a:', columnId)
      // FIX: si el cliente no se encuentra, la tarjeta volvía sola a su columna
      // sin explicación. updatePatient ahora avisa por toast.
      if (updatePatient(patient.id, { ...patient, kanbanStatus: columnId }) === false) return
    } else {
      console.log('⏭️ Ya está en esta columna')
    }
  }

  const getPatientsByColumn = (colId) => {
    return patients.filter(p => (p.kanbanStatus || 'prospect') === colId)
  }

  return (
    <div ref={focusRef} tabIndex={-1} className="kanban-screen">
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">Tablero Kanban</h2>
        {/* Botón de debug eliminado */}
      </div>

      <div className="kanban-board">
        {columns.map(col => {
          const columnPatients = getPatientsByColumn(col.id)
          return (
            <div 
              key={col.id} 
              className="kanban-column" 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div className="kanban-column-header" style={{ borderTopColor: col.color }}>
                <h3>{col.label}</h3>
                <span className="kanban-count">{columnPatients.length}</span>
              </div>
              <div className="kanban-cards">
                {columnPatients.map(patient => (
                  <div 
                    key={`patient-${patient.id}`}
                    className="kanban-card" 
                    draggable
                    onDragStart={(e) => handleDragStart(e, patient)}
                    onDragEnd={handleDragEnd}
                    onClick={() => nav.navigate('patientDetail', { patientId: patient.id })}
                    style={{ cursor: 'grab' }}
                  >
                    <div className="kanban-card-title">{patient.name}</div>
                    <div className="kanban-card-details">{patient.phone || 'Sin teléfono'}</div>
                    {/* ID visible eliminado */}
                    {patient.totalVisits > 0 && (
                      <div className="kanban-card-badge">{patient.totalVisits} visitas</div>
                    )}
                  </div>
                ))}
                {columnPatients.length === 0 && (
                  <div className="kanban-empty">Arrastra clientes aquí</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Indicador de arrastre (solo visible mientras se arrastra) */}
      {draggedPatient && (
        <div className="drag-indicator">
          Arrastrando: {draggedPatient.name}
        </div>
      )}
    </div>
  )
}