import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useReminders } from '../../contexts/ReminderContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'

export function NewAppointmentScreen({ 
  nav, 
  patients, 
  products, 
  addAppointment, 
  addMultipleAppointments,
  editingAppointment = null,
  updateAppointment,
  userMode,
  selectedDate,
  params = {},
  createCustomReminder,
  consultationConfig,
  setConsultationConfig
}) {
  const focusRef = useScreenFocus()
  const toast = useToast()
  const { addReminder } = useReminders()
  const { confirm } = useConfirm()
  
  // CORREGIDO Bug 4: Obtener editingAppointment de params si no viene como prop
  const effectiveEditingAppointment = editingAppointment || params?.editingAppointment || null
  
  const getInitialDate = () => {
    if (selectedDate) {
      const d = new Date(selectedDate)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    if (params?.defaultDate) {
      const d = new Date(params.defaultDate)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  }
  
  const getInitialTime = () => {
    if (params?.defaultHour != null) {
      return `${String(params.defaultHour).padStart(2, '0')}:00`
    }
    return '10:00'
  }
  
  const [formData, setFormData] = useState({
    patientId: '',
    patientName: '',
    patientPhone: '',
    patientEmail: '',
    productId: '',
    productName: '',
    price: '',
    date: getInitialDate(),
    time: getInitialTime(),
    duration: consultationConfig?.defaultDuration || 60,
    status: 'scheduled',
    notes: '',
    location: '',
    meetingLink: '',
    isRecurring: false,
    recurringPattern: 'weekly',
    recurringCount: 4,
    reminderEnabled: false,
    reminderAdvance: 1,
    sendWhatsApp: false
  })

  const calculatePrice = useCallback((durationMinutes, productPrice, config) => {
    if (productPrice && productPrice > 0) {
      return productPrice
    }
    if (config?.pricePerHour && config?.hourlyRate) {
      const hours = durationMinutes / 60
      return Math.round(config.hourlyRate * hours)
    }
    return config?.defaultPrice || 0
  }, [])

  // CORREGIDO Bug 1: useEffect de precio con variables locales claras
  useEffect(() => {
    const { productId, duration } = formData
    let newPrice = 0
    
    if (productId) {
      const product = products.find(p => String(p.id) === String(productId))
      if (product && product.price > 0) {
        newPrice = product.price
      } else {
        newPrice = calculatePrice(duration, 0, consultationConfig)
      }
    } else {
      newPrice = calculatePrice(duration, 0, consultationConfig)
    }
    
    setFormData(prev => ({ ...prev, price: newPrice }))
  }, [formData.productId, formData.duration, consultationConfig, products, calculatePrice])

  // CORREGIDO Bug 2: useEffect de edición sin dependencias problemáticas
  useEffect(() => {
    if (effectiveEditingAppointment) {
      const startDate = new Date(effectiveEditingAppointment.startTime)
      setFormData({
        patientId: effectiveEditingAppointment.patientId || '',
        patientName: effectiveEditingAppointment.patientName || '',
        patientPhone: effectiveEditingAppointment.patientPhone || '',
        patientEmail: effectiveEditingAppointment.patientEmail || '',
        productId: effectiveEditingAppointment.productId || '',
        productName: effectiveEditingAppointment.productName || '',
        price: effectiveEditingAppointment.price ?? '',
        date: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
        time: `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
        duration: effectiveEditingAppointment.duration || consultationConfig?.defaultDuration || 60,
        status: effectiveEditingAppointment.status || 'scheduled',
        notes: effectiveEditingAppointment.notes || '',
        location: effectiveEditingAppointment.location || '',
        meetingLink: effectiveEditingAppointment.meetingLink || '',
        isRecurring: false,
        recurringPattern: 'weekly',
        recurringCount: 4,
        reminderEnabled: effectiveEditingAppointment.reminderEnabled || false,
        reminderAdvance: effectiveEditingAppointment.reminderAdvance || 1,
        sendWhatsApp: effectiveEditingAppointment.sendWhatsApp || false
      })
    }
  }, [effectiveEditingAppointment]) // ← solo depende del editing appointment, no de consultationConfig

  const handlePatientSelect = (patientId) => {
    const patient = patients.find(p => String(p.id) === String(patientId))
    if (patient) {
      setFormData(prev => ({
        ...prev,
        patientId: String(patient.id),
        patientName: patient.name,
        patientPhone: patient.phone || '',
        patientEmail: patient.email || ''
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        patientId: '',
        patientName: '',
        patientPhone: '',
        patientEmail: ''
      }))
    }
  }

  const handleProductSelect = (productId) => {
    const product = products.find(p => String(p.id) === String(productId))
    if (product) {
      setFormData(prev => ({
        ...prev,
        productId: String(product.id),
        productName: product.name,
        price: product.price ?? 0
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        productId: '',
        productName: '',
        price: ''
      }))
    }
  }

  const formatLocalDate = (dateString) => {
    if (!dateString) return ''
    const [year, month, day] = dateString.split('-')
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
    
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    const weekday = weekdays[date.getDay()]
    const monthName = months[parseInt(month) - 1]
    const dayNum = parseInt(day)
    
    return `${weekday}, ${dayNum} de ${monthName} de ${year}`
  }

  const formatTime12h = (time24h) => {
    if (!time24h) return ''
    const [hour, minute] = time24h.split(':')
    const h = parseInt(hour)
    const period = h >= 12 ? 'PM' : 'AM'
    const hour12 = h % 12 || 12
    return `${hour12}:${minute} ${period}`
  }

  // CORREGIDO Bug 3: createAppointmentReminder con resta de milisegundos
  const createAppointmentReminder = (appointment, appointmentDateTime) => {
    if (!formData.reminderEnabled) return null
    
    const reminderTimestamp = appointmentDateTime.getTime() - (formData.reminderAdvance * 60 * 60 * 1000)
    const reminderDate = new Date(reminderTimestamp)
    
    let advanceText = ''
    if (formData.reminderAdvance === 0) advanceText = 'en el momento'
    else if (formData.reminderAdvance === 1) advanceText = '1 hora antes'
    else if (formData.reminderAdvance === 2) advanceText = '2 horas antes'
    else if (formData.reminderAdvance === 24) advanceText = '1 día antes'
    else if (formData.reminderAdvance === 48) advanceText = '2 días antes'
    
    const [year, month, day] = formData.date.split('-')
    const [hour, minute] = formData.time.split(':')
    const appointmentDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute))
    const formattedDateMsg = appointmentDate.toLocaleDateString('es-ES', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    const formattedTimeMsg = formatTime12h(formData.time)
    
    let message = `📅 *RECORDATORIO DE CITA* 📅\n\n`
    message += `Hola *${appointment.patientName}*,\n\n`
    message += `Te confirmo tu cita para:\n\n`
    message += `📆 *Fecha:* ${formattedDateMsg}\n`
    message += `⏰ *Hora:* ${formattedTimeMsg}\n`
    message += `⏱️ *Duración:* ${formData.duration} minutos\n\n`
    
    if (formData.productName) {
      message += `📦 *Servicio:* ${formData.productName}\n`
    }
    
    if (formData.location) {
      message += `📍 *Ubicación:* ${formData.location}\n`
    }
    
    if (formData.meetingLink) {
      message += `\n🔗 *Link de reunión:*\n${formData.meetingLink}\n\n`
      message += `💡 *Consejo:* Haz clic en el link 5 minutos antes para verificar que todo funcione correctamente.\n\n`
    }
    
    if (formData.notes) {
      message += `📝 *Notas:* ${formData.notes}\n\n`
    }
    
    message += `---\n`
    message += `🔔 Te enviaré este recordatorio ${advanceText} de la cita.\n\n`
    message += `*ZenDay* - Tu gestión inteligente`
    
    const reminderData = {
      title: `📅 ${appointment.patientName}`,
      message: message,
      type: 'meeting',
      reminderTime: reminderDate.toISOString(),
      relatedId: appointment.id,
      relatedType: 'appointment',
      priority: formData.reminderAdvance <= 1 ? 'high' : 'normal',
      repeat: 'none',
      sendWhatsApp: formData.sendWhatsApp && formData.patientPhone,
      clientPhone: formData.sendWhatsApp ? formData.patientPhone : null,
      clientName: formData.patientName,
      reminderLabel: advanceText,
      meetingLink: formData.meetingLink,
      location: formData.location
    }
    
    addReminder(reminderData)
    return reminderData
  }

  // CORREGIDO: getRecurringDate con máximos dinámicos según patrón
  const getRecurringDate = (baseDate, pattern, index) => {
    const d = new Date(baseDate)
    if (pattern === 'daily') {
      d.setDate(d.getDate() + index)
    } else if (pattern === 'weekly') {
      d.setDate(d.getDate() + index * 7)
    } else if (pattern === 'monthly') {
      const targetMonth = d.getMonth() + index
      const targetYear = d.getFullYear() + Math.floor(targetMonth / 12)
      const normalizedMonth = ((targetMonth % 12) + 12) % 12
      const maxDay = new Date(targetYear, normalizedMonth + 1, 0).getDate()
      d.setFullYear(targetYear, normalizedMonth, Math.min(d.getDate(), maxDay))
    }
    return d
  }

  // CORREGIDO: Manejo de stock al crear cita (modo emprendedor)
  const checkProductStock = useCallback(() => {
    if (userMode !== 'entrepreneur') return true
    if (!formData.productId) return true
    
    const product = products.find(p => String(p.id) === String(formData.productId))
    if (!product) return true
    
    if (product.stock === 0) {
      toast.addToast(`⚠️ El producto "${product.name}" está AGOTADO`, 'warning')
      return false
    }
    
    if (product.stock < 5) {
      toast.addToast(`ℹ️ El producto "${product.name}" tiene STOCK BAJO (${product.stock} unidades)`, 'info')
    }
    
    return true
  }, [formData.productId, products, userMode, toast])

  const handleSave = async () => {
    if (!formData.patientName) {
      toast.addToast('❌ Selecciona un cliente', 'error')
      return
    }
    if (userMode !== 'professional' && !formData.productId) {
      toast.addToast('❌ Selecciona un artículo', 'error')
      return
    }
    if (!formData.date) {
      toast.addToast('❌ Selecciona una fecha', 'error')
      return
    }

    // Verificar stock antes de crear
    if (!checkProductStock()) return

    const [year, month, day] = formData.date.split('-')
    const [hour, minute] = formData.time.split(':')
    const dateTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute))
    const endTime = new Date(dateTime.getTime() + (formData.duration * 60 * 1000))
    
    if (isNaN(dateTime.getTime())) {
      toast.addToast('❌ Fecha u hora inválida', 'error')
      return
    }

    // CORREGIDO Bug 2.5: Validación de fecha en pasado
    const now = new Date()
    now.setSeconds(0, 0)
    if (dateTime < now && !effectiveEditingAppointment) {
      const ok = await confirm(
        '⚠️ La fecha seleccionada es en el pasado.\n\n' +
        `Fecha: ${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}\n\n` +
        '¿Continuar de todas formas?',
        'Fecha en el pasado'
      )
      if (!ok) return
    }

    const baseAppointment = {
      patientId: formData.patientId,
      patientName: formData.patientName,
      patientPhone: formData.patientPhone,
      patientEmail: formData.patientEmail,
      productId: formData.productId,
      productName: formData.productName,
      price: parseFloat(formData.price) || 0,
      duration: formData.duration,
      status: formData.status,
      notes: formData.notes,
      location: formData.location,
      meetingLink: formData.meetingLink,
      createdAt: new Date().toISOString(),
      reminderEnabled: formData.reminderEnabled,
      reminderAdvance: formData.reminderAdvance,
      sendWhatsApp: formData.sendWhatsApp
    }

    // CORREGIDO: recurringCount máximo dinámico
    const getMaxRecurringCount = (pattern) => {
      if (pattern === 'daily') return 30
      if (pattern === 'weekly') return 52
      return 12 // monthly
    }
    const maxCount = getMaxRecurringCount(formData.recurringPattern)
    const count = Math.min(Math.max(1, parseInt(formData.recurringCount) || 1), maxCount)

    if (formData.isRecurring && !effectiveEditingAppointment) {
      const appointments = []
      const recurringGroupId = Date.now()

      for (let i = 0; i < count; i++) {
        const recurDate = getRecurringDate(dateTime, formData.recurringPattern, i)
        const recurEndTime = new Date(recurDate.getTime() + (formData.duration * 60 * 1000))
        const appointmentId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
        
        const newAppointment = {
          ...baseAppointment,
          id: appointmentId,
          startTime: recurDate.toISOString(),
          endTime: recurEndTime.toISOString(),
          recurringGroup: recurringGroupId,
          recurringIndex: i,
          recurringPattern: formData.recurringPattern
        }
        
        appointments.push(newAppointment)
        
        if (formData.reminderEnabled) {
          createAppointmentReminder(newAppointment, recurDate)
        }
      }

      if (addMultipleAppointments) {
        addMultipleAppointments(appointments)
      } else {
        appointments.forEach(apt => addAppointment(apt))
      }
      toast.addToast(`✅ ${appointments.length} citas recurrentes creadas${formData.reminderEnabled ? ' con recordatorio' : ''}`, 'success')

    } else if (effectiveEditingAppointment) {
      const updatedAppointment = { 
        ...baseAppointment, 
        id: effectiveEditingAppointment.id,
        startTime: dateTime.toISOString(),
        endTime: endTime.toISOString()
      }
      updateAppointment(effectiveEditingAppointment.id, updatedAppointment)
      
      if (formData.reminderEnabled) {
        createAppointmentReminder(updatedAppointment, dateTime)
      }
      
      toast.addToast('✅ Cita actualizada', 'success')

    } else {
      const newAppointment = { 
        ...baseAppointment, 
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        startTime: dateTime.toISOString(),
        endTime: endTime.toISOString()
      }
      
      addAppointment(newAppointment)
      
      if (formData.reminderEnabled) {
        createAppointmentReminder(newAppointment, dateTime)
        const advanceText = formData.reminderAdvance === 0 ? 'en el momento' : 
                           formData.reminderAdvance === 1 ? '1 hora antes' :
                           formData.reminderAdvance === 2 ? '2 horas antes' :
                           formData.reminderAdvance === 24 ? '1 día antes' :
                           `${formData.reminderAdvance} horas antes`
        toast.addToast(`✅ Cita creada con recordatorio ${advanceText}${formData.sendWhatsApp ? ' y WhatsApp' : ''}`, 'success')
      } else {
        toast.addToast('✅ Cita creada', 'success')
      }
    }
    
    nav.goBack()
  }

  const isEditing = !!effectiveEditingAppointment
  
  // CORREGIDO Bug 5: displayPrice con manejo correcto de precio 0
  const displayPrice = useMemo(() => {
    if (formData.price !== '' && formData.price !== null) {
      return Number(formData.price)
    }
    return calculatePrice(formData.duration, 0, consultationConfig)
  }, [formData.price, formData.duration, consultationConfig, calculatePrice])
  
  const formattedDate = formatLocalDate(formData.date)
  const formattedTime = formatTime12h(formData.time)

  const advanceOptions = [
    { value: 0, label: '⏰ En el momento', description: 'Te avisará justo a la hora' },
    { value: 1, label: '🕐 1 hora antes', description: 'Te avisará con 1 hora de anticipación' },
    { value: 2, label: '🕑 2 horas antes', description: 'Te avisará con 2 horas de anticipación' },
    { value: 24, label: '📅 1 día antes', description: 'Te avisará el día anterior' },
    { value: 48, label: '📆 2 días antes', description: 'Te avisará 2 días antes' }
  ]

  const hasPatients = patients && patients.length > 0

  // Preview del mensaje WhatsApp (mejora para modo profesional)
  const whatsappPreview = useMemo(() => {
    if (!formData.reminderEnabled || !formData.sendWhatsApp) return null
    
    let advanceText = ''
    if (formData.reminderAdvance === 0) advanceText = 'en el momento'
    else if (formData.reminderAdvance === 1) advanceText = '1 hora antes'
    else if (formData.reminderAdvance === 2) advanceText = '2 horas antes'
    else if (formData.reminderAdvance === 24) advanceText = '1 día antes'
    else if (formData.reminderAdvance === 48) advanceText = '2 días antes'
    
    const appointmentDate = new Date(parseInt(formData.date.split('-')[0]), 
      parseInt(formData.date.split('-')[1]) - 1, 
      parseInt(formData.date.split('-')[2]),
      parseInt(formData.time.split(':')[0]),
      parseInt(formData.time.split(':')[1] || 0))
    
    const formattedDateMsg = appointmentDate.toLocaleDateString('es-ES', { 
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
    })
    const formattedTimeMsg = formatTime12h(formData.time)
    
    let preview = `📅 *RECORDATORIO DE CITA* 📅\n\n`
    preview += `Hola *${formData.patientName || 'CLIENTE'}*,\n\n`
    preview += `Te confirmo tu cita para:\n\n`
    preview += `📆 *Fecha:* ${formattedDateMsg}\n`
    preview += `⏰ *Hora:* ${formattedTimeMsg}\n`
    preview += `⏱️ *Duración:* ${formData.duration} minutos\n\n`
    if (formData.productName) preview += `📦 *Servicio:* ${formData.productName}\n`
    if (formData.location) preview += `📍 *Ubicación:* ${formData.location}\n`
    preview += `---\n🔔 Te enviaré este recordatorio ${advanceText} de la cita.`
    
    return preview
  }, [formData])

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '600px', 
      margin: '0 auto', 
      height: '100%', 
      overflowY: 'auto',
      paddingBottom: '120px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <BackButton onClick={() => nav.goBack()} />
        <h2 style={{ fontSize: '24px', fontWeight: 700 }}>
          {isEditing ? '✏️ Editar cita' : '➕ Nueva cita'}
        </h2>
      </div>

      {/* ========== CLIENTE ========== */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
          Cliente *
        </label>
        
        {!hasPatients ? (
          <div style={{ 
            padding: '16px', 
            borderRadius: '12px', 
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            color: '#92400e'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>
              ⚠️ No hay clientes registrados
            </div>
            <div style={{ fontSize: '14px' }}>
              Para crear una cita, primero debes agregar un cliente en la sección <strong>"Clientes"</strong>.
            </div>
            <button
              onClick={() => nav.navigate('patients')}
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                background: '#f59e0b',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              + Ir a Clientes
            </button>
          </div>
        ) : (
          <select 
            value={formData.patientId}
            onChange={(e) => handlePatientSelect(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '12px', 
              border: '1px solid #e2e8f0', 
              background: 'var(--bg-secondary)',
              fontSize: '16px'
            }}
          >
            <option value="">📋 Seleccionar cliente...</option>
            {patients.map(p => (
              <option key={String(p.id)} value={String(p.id)}>
                👤 {p.name} {p.phone ? `📞 ${p.phone}` : ''}
              </option>
            ))}
          </select>
        )}
        
        {formData.patientName && (
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>
            📞 {formData.patientPhone || 'Sin teléfono'} | ✉️ {formData.patientEmail || 'Sin email'}
          </div>
        )}
      </div>

      {/* Artículo */}
      {userMode !== 'professional' && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Artículo / Servicio</label>
          <select 
            value={formData.productId}
            onChange={(e) => handleProductSelect(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
          >
            <option value="">Seleccionar artículo...</option>
            {products.map(p => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name} - ${p.price != null ? p.price : '0'} {p.stock !== undefined && `(Stock: ${p.stock})`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Duración */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>⏱️ Duración</label>
        <select
          value={formData.duration}
          onChange={(e) => setFormData(prev => ({ ...prev, duration: parseInt(e.target.value) }))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        >
          <option value="15">15 minutos</option>
          <option value="30">30 minutos</option>
          <option value="45">45 minutos</option>
          <option value="60">1 hora</option>
          <option value="90">1.5 horas</option>
          <option value="120">2 horas</option>
          <option value="150">2.5 horas</option>
          <option value="180">3 horas</option>
          <option value="240">4 horas</option>
        </select>
      </div>

      {/* Fecha */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📅 Fecha *</label>
        <input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        />
        {formData.date && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
            {formattedDate}
          </div>
        )}
      </div>

      {/* Hora */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>⏰ Hora *</label>
        <input 
          type="time"
          value={formData.time}
          onChange={(e) => setFormData(prev => ({...prev, time: e.target.value}))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        />
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
          {formData.time && `Hora seleccionada: ${formattedTime}`}
        </div>
      </div>

      {/* Precio */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>💰 Precio</label>
        <div style={{ 
          padding: '12px', 
          borderRadius: '12px', 
          background: 'rgba(16, 185, 129, 0.1)',
          color: '#10b981',
          fontWeight: 600,
          fontSize: '18px'
        }}>
          ${displayPrice.toLocaleString()} UYU
        </div>
        {consultationConfig?.pricePerHour && consultationConfig?.hourlyRate > 0 && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
            💰 Tarifa: ${consultationConfig.hourlyRate}/hora × {(formData.duration / 60).toFixed(1)}h = ${Math.round((formData.duration / 60) * consultationConfig.hourlyRate).toLocaleString()} UYU
          </div>
        )}
      </div>

      {/* Ubicación */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📍 Ubicación</label>
        <input 
          type="text"
          placeholder="Ej: Consultorio 123, Av. Italia 456"
          value={formData.location}
          onChange={(e) => setFormData(prev => ({...prev, location: e.target.value}))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        />
      </div>

      {/* Link de reunión */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>🔗 Link de reunión</label>
        <input 
          type="url"
          placeholder="https://meet.google.com/... o https://zoom.us/j/..."
          value={formData.meetingLink}
          onChange={(e) => setFormData(prev => ({...prev, meetingLink: e.target.value}))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        />
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
          🔗 Se incluirá en el recordatorio y mensaje de WhatsApp
        </div>
      </div>

      {/* Recordatorio */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '12px' }}>
          <input 
            type="checkbox"
            checked={formData.reminderEnabled}
            onChange={(e) => setFormData(prev => ({...prev, reminderEnabled: e.target.checked}))}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 500 }}>🔔 Recordarme esta cita</span>
        </label>

        {formData.reminderEnabled && (
          <div style={{ 
            marginTop: '12px', 
            padding: '16px', 
            background: 'var(--bg-tertiary)', 
            borderRadius: '16px',
            border: '0.5px solid var(--border)'
          }}>
            <label style={{ display: 'block', marginBottom: '12px', fontWeight: 500, fontSize: '13px' }}>
              ⏰ ¿Cuándo quieres que te avise?
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
              {advanceOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData(prev => ({...prev, reminderAdvance: option.value}))}
                  style={{
                    padding: '8px 16px',
                    background: formData.reminderAdvance === option.value ? '#6366f1' : 'var(--bg-secondary)',
                    border: '0.5px solid var(--border)',
                    borderRadius: '30px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: formData.reminderAdvance === option.value ? 'white' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '12px', paddingTop: '12px', borderTop: '0.5px solid var(--border)' }}>
              <input 
                type="checkbox"
                checked={formData.sendWhatsApp}
                onChange={(e) => setFormData(prev => ({...prev, sendWhatsApp: e.target.checked}))}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                disabled={!formData.patientPhone}
              />
              <span style={{ fontWeight: 500 }}>📱 Enviar recordatorio por WhatsApp al cliente</span>
            </label>
            {formData.sendWhatsApp && !formData.patientPhone && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444' }}>
                ⚠️ El cliente no tiene número de teléfono registrado
              </div>
            )}
            {formData.sendWhatsApp && formData.patientPhone && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#10b981' }}>
                ✅ Se enviará WhatsApp a {formData.patientPhone}
              </div>
            )}
            
            {/* Preview de WhatsApp - mejora para modo profesional */}
            {formData.sendWhatsApp && formData.patientPhone && (
              <details style={{ marginTop: '12px' }}>
                <summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>
                  📋 Ver preview del mensaje WhatsApp
                </summary>
                <div style={{ 
                  marginTop: '8px', 
                  padding: '12px', 
                  background: 'rgba(37, 211, 102, 0.1)',
                  borderRadius: '12px',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace'
                }}>
                  {whatsappPreview}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Cita recurrente */}
      {!isEditing && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input 
              type="checkbox"
              checked={formData.isRecurring}
              onChange={(e) => setFormData(prev => ({...prev, isRecurring: e.target.checked}))}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 500 }}>🔄 Repetir esta cita</span>
          </label>

          {formData.isRecurring && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select 
                value={formData.recurringPattern}
                onChange={(e) => setFormData(prev => ({...prev, recurringPattern: e.target.value}))}
                style={{ padding: '10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
              >
                <option value="daily">📅 Cada día (máx 30)</option>
                <option value="weekly">📆 Cada semana (máx 52)</option>
                <option value="monthly">🗓️ Cada mes (máx 12)</option>
              </select>
              <input 
                type="number"
                min="1"
                max={formData.recurringPattern === 'daily' ? 30 : formData.recurringPattern === 'weekly' ? 52 : 12}
                value={formData.recurringCount}
                onChange={(e) => {
                  const val = parseInt(e.target.value)
                  const max = formData.recurringPattern === 'daily' ? 30 : formData.recurringPattern === 'weekly' ? 52 : 12
                  setFormData(prev => ({...prev, recurringCount: isNaN(val) ? 1 : Math.max(1, Math.min(max, val))}))
                }}
                style={{ width: '80px', padding: '10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
              />
              <span style={{ color: '#64748b' }}>veces</span>
            </div>
          )}
        </div>
      )}

      {/* Notas */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📝 Notas</label>
        <textarea 
          rows="3"
          placeholder="Observaciones adicionales..."
          value={formData.notes}
          onChange={(e) => setFormData(prev => ({...prev, notes: e.target.value}))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)', resize: 'vertical' }}
        />
      </div>

      {/* Estado */}
      <div style={{ marginBottom: '32px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📌 Estado</label>
        <select 
          value={formData.status}
          onChange={(e) => setFormData(prev => ({...prev, status: e.target.value}))}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'var(--bg-secondary)' }}
        >
          {userMode === 'entrepreneur' ? (
            <>
              <option value="pending">⏳ Pendiente</option>
              <option value="delivered">📦 Entregado</option>
              <option value="picked">🛒 Retirado</option>
              <option value="cancelled">❌ Cancelado</option>
            </>
          ) : (
            <>
              <option value="scheduled">📅 Agendada</option>
              <option value="confirmed">✅ Confirmada</option>
              <option value="in-progress">⏳ En curso</option>
              <option value="completed">✔️ Completada</option>
              <option value="cancelled">❌ Cancelada</option>
              <option value="no-show">🚫 No asistió</option>
            </>
          )}
        </select>
      </div>

      {/* Botones */}
      <div style={{ 
        display: 'flex', 
        gap: '16px', 
        justifyContent: 'flex-end', 
        marginTop: '32px',
        marginBottom: '20px',
        padding: '20px 0',
        borderTop: '1px solid #e2e8f0',
        background: 'var(--bg-primary)'
      }}>
        <button 
          onClick={() => nav.goBack()}
          style={{ 
            padding: '14px 28px', 
            background: 'var(--bg-tertiary)', 
            border: '1px solid var(--border)', 
            borderRadius: '40px', 
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            transition: 'all 0.2s'
          }}
        >
          Cancelar
        </button>
        <button 
          onClick={handleSave}
          style={{ 
            padding: '14px 32px', 
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: 'none', 
            borderRadius: '40px', 
            color: 'white', 
            fontWeight: 600, 
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '15px',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 6px 18px rgba(99, 102, 241, 0.4)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.3)'
          }}
        >
          {isEditing ? '✓ Guardar cambios' : '✓ Crear cita'}
        </button>
      </div>
    </div>
  )
}