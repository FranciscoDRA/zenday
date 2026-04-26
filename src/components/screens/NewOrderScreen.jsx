// src/components/screens/NewOrderScreen.jsx

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { formatCurrency } from '../../utils/helpers'

// ============================================
// UTILIDADES
// ============================================

// CORREGIDO Bug 1: parseLocalDate para evitar problemas UTC
const parseLocalDate = (str) => {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null
  return new Date(y, m - 1, d, 0, 0, 0)
}

export function NewOrderScreen({ nav, addAppointment, patients, products, addPatient }) {
  const toast = useToast()
  const { confirm } = useConfirm()
  
  const [formData, setFormData] = useState({
    patientId: '',
    patientName: '',
    patientPhone: '',
    productId: '',
    productName: '',
    quantity: 1,
    price: 0,
    orderDate: '',
    dueDate: '',
    notes: '',
    address: '',
    shippingMethod: 'delivery' // delivery, pickup
  })
  
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [patientSearchTerm, setPatientSearchTerm] = useState('')
  const [isCreatingPatient, setIsCreatingPatient] = useState(false)

  // Pacientes filtrados (para búsqueda)
  const filteredPatients = useMemo(() => {
    if (!patients?.length) return []
    if (!patientSearchTerm) return patients
    const term = patientSearchTerm.toLowerCase()
    return patients.filter(p => 
      p.name?.toLowerCase().includes(term) || 
      p.phone?.includes(term)
    ).slice(0, 10)
  }, [patients, patientSearchTerm])

  // CORREGIDO Bug 3: precio total calculado, no guardado como estado
  const totalPrice = useMemo(() => {
    if (!selectedProduct) return 0
    return selectedProduct.price * (formData.quantity || 1)
  }, [selectedProduct, formData.quantity])

  // Limpiar selección cuando cambia el producto en el dropdown
  const handleProductChange = useCallback((productId) => {
    if (!productId) {
      setSelectedProduct(null)
      setFormData(prev => ({ 
        ...prev, 
        productId: '', 
        productName: '',
        price: 0
      }))
      return
    }
    
    // CORREGIDO Bug 2: comparación con String()
    const product = products.find(p => String(p.id) === String(productId))
    if (product) {
      setSelectedProduct(product)
      setFormData(prev => ({ 
        ...prev, 
        productId: String(product.id),
        productName: product.name,
        price: product.price
      }))
    }
  }, [products])

  // CORREGIDO Bug 2: selección de cliente con comparación de strings
  const handlePatientSelect = useCallback((patientId) => {
    const patient = patients.find(p => String(p.id) === String(patientId))
    if (patient) {
      setFormData(prev => ({ 
        ...prev, 
        patientId: String(patient.id), 
        patientName: patient.name,
        patientPhone: patient.phone || ''
      }))
      setPatientSearchTerm('')
    }
  }, [patients])

  const handleAddressFromPatient = useCallback(() => {
    if (!formData.patientId) return
    const patient = patients.find(p => String(p.id) === String(formData.patientId))
    if (patient?.address) {
      setFormData(prev => ({ ...prev, address: patient.address }))
      toast.addToast('📍 Dirección cargada desde el cliente', 'info')
    } else {
      toast.addToast('⚠️ El cliente no tiene dirección registrada', 'warning')
    }
  }, [formData.patientId, patients, toast])

  // CORREGIDO Bug 1 y 4: validación de fechas con parseLocalDate
  const validateDates = useCallback(() => {
    const orderDate = parseLocalDate(formData.orderDate)
    const dueDate = parseLocalDate(formData.dueDate)
    
    if (!orderDate) {
      toast.addToast('❌ Fecha de pedido inválida', 'error')
      return false
    }
    if (!dueDate) {
      toast.addToast('❌ Fecha de vencimiento inválida', 'error')
      return false
    }
    
    // Validar que dueDate no sea anterior a orderDate
    if (dueDate < orderDate) {
      toast.addToast('❌ La fecha de entrega no puede ser anterior a la fecha del pedido', 'error')
      return false
    }
    
    return { orderDate, dueDate }
  }, [formData.orderDate, formData.dueDate, toast])

  // Verificar stock del producto seleccionado
  const checkProductStock = useCallback(() => {
    if (!selectedProduct) return true
    
    if (selectedProduct.stock === 0) {
      toast.addToast(`⚠️ El producto "${selectedProduct.name}" está AGOTADO`, 'warning')
      return false
    }
    
    if (selectedProduct.stock < formData.quantity) {
      toast.addToast(`⚠️ Stock insuficiente: solo hay ${selectedProduct.stock} unidades de "${selectedProduct.name}"`, 'error')
      return false
    }
    
    if (selectedProduct.stock < 5) {
      toast.addToast(`ℹ️ El producto "${selectedProduct.name}" tiene STOCK BAJO (${selectedProduct.stock} unidades)`, 'info')
    }
    
    return true
  }, [selectedProduct, formData.quantity, toast])

  const handleSubmit = useCallback(async () => {
    if (!formData.patientName) {
      toast.addToast('❌ Selecciona un cliente', 'error')
      return
    }
    if (!formData.productId) {
      toast.addToast('❌ Selecciona un producto', 'error')
      return
    }
    if (!formData.orderDate) {
      toast.addToast('❌ Fecha de pedido requerida', 'error')
      return
    }
    if (!formData.dueDate) {
      toast.addToast('❌ Fecha de vencimiento requerida', 'error')
      return
    }
    
    // Validar stock
    if (!checkProductStock()) return
    
    // Validar fechas
    const dates = validateDates()
    if (!dates) return
    const { orderDate, dueDate } = dates

    // Confirmación antes de crear
    const confirmMessage = `📦 CONFIRMAR PEDIDO\n\n` +
      `Cliente: ${formData.patientName}\n` +
      `Producto: ${formData.productName}\n` +
      `Cantidad: ${formData.quantity}\n` +
      `Total: ${formatCurrency(totalPrice, 'UYU')}\n` +
      `Fecha pedido: ${orderDate.toLocaleDateString()}\n` +
      `Fecha entrega: ${dueDate.toLocaleDateString()}\n\n` +
      `¿Confirmar el pedido?`
    
    const confirmed = await confirm(confirmMessage, 'Crear pedido')
    if (!confirmed) return

    // CORREGIDO Bug 1: usar objetos Date ya parseados (no re-stringify)
    const startDateTime = new Date(dueDate)
    startDateTime.setHours(12, 0, 0) // Mediodía como hora por defecto
    
    const appointment = {
      patientId: formData.patientId,
      patientName: formData.patientName,
      patientPhone: formData.patientPhone,
      productId: formData.productId,
      productName: formData.productName,
      quantity: formData.quantity,
      price: totalPrice,  // CORREGIDO: precio total, no multiplicado otra vez
      startTime: startDateTime.toISOString(),
      endTime: new Date(startDateTime.getTime() + 30 * 60000).toISOString(),
      orderDate: orderDate.toISOString(),
      dueDate: dueDate.toISOString(),
      notes: formData.notes,
      address: formData.address,
      shippingMethod: formData.shippingMethod,
      requiresShipping: formData.shippingMethod === 'delivery',
      status: 'pending',
      paid: false,
      type: 'order',
      createdAt: new Date().toISOString()
    }

    addAppointment(appointment)
    toast.addToast('✅ Pedido creado exitosamente', 'success')
    nav.goBack()
  }, [formData, selectedProduct, totalPrice, validateDates, checkProductStock, addAppointment, toast, nav, confirm])

  // Limpiar selección de producto si cambian los productos externamente
  useEffect(() => {
    if (formData.productId) {
      const productExists = products.some(p => String(p.id) === String(formData.productId))
      if (!productExists) {
        setSelectedProduct(null)
        setFormData(prev => ({ ...prev, productId: '', productName: '', price: 0 }))
      }
    }
  }, [products, formData.productId])

  const hasPatients = patients && patients.length > 0
  const hasProducts = products && products.length > 0

  return (
    <div className="new-order-screen" style={{ 
      padding: '20px', 
      maxWidth: '600px', 
      margin: '0 auto',
      height: '100%',
      overflowY: 'auto',
      paddingBottom: '120px'
    }}>
      <div className="top-bar" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <BackButton onClick={() => nav.goBack()} />
        <h2 style={{ fontSize: '24px', fontWeight: 700 }}>📦 Nuevo pedido</h2>
      </div>

      <div className="order-form" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ========== CLIENTE ========== */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Cliente *</label>
          
          {!hasPatients ? (
            <div style={{ 
              padding: '16px', 
              borderRadius: '12px', 
              background: '#fef3c7',
              border: '1px solid #f59e0b'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>⚠️ No hay clientes registrados</div>
              <div style={{ fontSize: '14px' }}>
                Para crear un pedido, primero debes agregar un cliente en la sección <strong>"Clientes"</strong>.
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
            <>
              <input
                type="text"
                placeholder="Buscar cliente por nombre o teléfono..."
                value={patientSearchTerm}
                onChange={(e) => setPatientSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  background: 'var(--bg-secondary)',
                  fontSize: '16px',
                  marginBottom: '8px'
                }}
              />
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
                {filteredPatients.map(p => (
                  <option key={String(p.id)} value={String(p.id)}>
                    👤 {p.name} {p.phone ? `📞 ${p.phone}` : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          
          {formData.patientName && (
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>
              📞 {formData.patientPhone || 'Sin teléfono'}
            </div>
          )}
        </div>

        {/* ========== PRODUCTO ========== */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Producto *</label>
          
          {!hasProducts ? (
            <div style={{ 
              padding: '16px', 
              borderRadius: '12px', 
              background: '#fef3c7',
              border: '1px solid #f59e0b'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>⚠️ No hay productos registrados</div>
              <div style={{ fontSize: '14px' }}>
                Para crear un pedido, primero debes agregar productos en la sección <strong>"Productos"</strong>.
              </div>
              <button
                onClick={() => nav.navigate('products')}
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
                + Ir a Productos
              </button>
            </div>
          ) : (
            <select 
              value={formData.productId}
              onChange={(e) => handleProductChange(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '12px', 
                border: '1px solid #e2e8f0', 
                background: 'var(--bg-secondary)',
                fontSize: '16px'
              }}
            >
              <option value="">📦 Seleccionar producto...</option>
              {products.map(p => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name} - {formatCurrency(p.price, 'UYU')} {p.stock !== undefined && `(Stock: ${p.stock})`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ========== CANTIDAD Y PRECIO ========== */}
        {selectedProduct && (
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Cantidad *</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <input 
                type="number" 
                min="1" 
                max={selectedProduct.stock || 999}
                value={formData.quantity}
                onChange={(e) => {
                  const qty = Math.max(1, parseInt(e.target.value) || 1)
                  const maxStock = selectedProduct.stock || 999
                  const finalQty = Math.min(qty, maxStock)
                  setFormData(prev => ({ ...prev, quantity: finalQty }))
                }}
                style={{
                  width: '100px',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  background: 'var(--bg-secondary)',
                  fontSize: '16px',
                  textAlign: 'center'
                }}
              />
              <div style={{ 
                padding: '12px 20px', 
                borderRadius: '12px', 
                background: 'rgba(16, 185, 129, 0.1)',
                fontWeight: 600,
                fontSize: '18px'
              }}>
                Total: {formatCurrency(totalPrice, 'UYU')}
              </div>
            </div>
            {selectedProduct.stock !== undefined && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                📦 Stock disponible: {selectedProduct.stock} unidades
              </div>
            )}
          </div>
        )}

        {/* ========== FECHAS ========== */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📅 Fecha del pedido *</label>
          <input 
            type="date" 
            value={formData.orderDate}
            onChange={(e) => setFormData(prev => ({ ...prev, orderDate: e.target.value }))}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '12px', 
              border: '1px solid #e2e8f0', 
              background: 'var(--bg-secondary)',
              fontSize: '16px'
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>⚠️ Fecha de vencimiento (entrega) *</label>
          <input 
            type="date" 
            value={formData.dueDate}
            min={formData.orderDate}
            onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '12px', 
              border: '1px solid #e2e8f0', 
              background: 'var(--bg-secondary)',
              fontSize: '16px'
            }}
          />
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
            📅 El pedido se mostrará en esta fecha en el calendario
          </div>
        </div>

        {/* ========== MÉTODO DE ENVÍO ========== */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📦 Método de entrega</label>
          <div style={{ display: 'flex', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                value="delivery"
                checked={formData.shippingMethod === 'delivery'}
                onChange={(e) => setFormData(prev => ({ ...prev, shippingMethod: e.target.value }))}
              />
              🚚 Delivery (envío a domicilio)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                value="pickup"
                checked={formData.shippingMethod === 'pickup'}
                onChange={(e) => setFormData(prev => ({ ...prev, shippingMethod: e.target.value }))}
              />
              📍 Retiro en tienda
            </label>
          </div>
        </div>

        {/* ========== DIRECCIÓN ========== */}
        {formData.shippingMethod === 'delivery' && (
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📍 Dirección de envío</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text"
                placeholder="Calle, número, ciudad..."
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                style={{ 
                  flex: 1,
                  padding: '12px', 
                  borderRadius: '12px', 
                  border: '1px solid #e2e8f0', 
                  background: 'var(--bg-secondary)',
                  fontSize: '14px'
                }}
              />
              {formData.patientId && (
                <button
                  type="button"
                  onClick={handleAddressFromPatient}
                  style={{
                    padding: '0 16px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontSize: '20px'
                  }}
                  title="Cargar dirección del cliente"
                >
                  📋
                </button>
              )}
            </div>
          </div>
        )}

        {/* ========== NOTAS ========== */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📝 Notas</label>
          <textarea 
            placeholder="Notas del pedido (instrucciones especiales, etc.)..."
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '12px', 
              border: '1px solid #e2e8f0', 
              background: 'var(--bg-secondary)',
              resize: 'vertical',
              fontSize: '14px'
            }}
          />
        </div>

        {/* ========== RESUMEN ========== */}
        {selectedProduct && formData.patientName && (
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '12px' }}>📋 Resumen del pedido</div>
            <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div>👤 Cliente: <strong>{formData.patientName}</strong></div>
              <div>📦 Producto: <strong>{formData.productName}</strong></div>
              <div>🔢 Cantidad: <strong>{formData.quantity}</strong></div>
              <div>💰 Total: <strong style={{ color: '#10b981' }}>{formatCurrency(totalPrice, 'UYU')}</strong></div>
              <div>📅 Fecha pedido: <strong>{formData.orderDate}</strong></div>
              <div>⚠️ Fecha entrega: <strong>{formData.dueDate}</strong></div>
              {formData.shippingMethod === 'delivery' && formData.address && (
                <div>📍 Dirección: <strong>{formData.address}</strong></div>
              )}
            </div>
          </div>
        )}

        {/* ========== BOTONES ========== */}
        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          justifyContent: 'flex-end', 
          marginTop: '32px',
          marginBottom: '20px',
          padding: '20px 0',
          borderTop: '1px solid #e2e8f0'
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
              color: 'var(--text-secondary)'
            }}
          >
            Cancelar
          </button>
          <button 
            onClick={handleSubmit}
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
              fontSize: '15px'
            }}
          >
            ✓ Crear pedido
          </button>
        </div>
      </div>
    </div>
  )
}