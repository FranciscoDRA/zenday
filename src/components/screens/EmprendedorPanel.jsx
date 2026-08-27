import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const COLORES = ['var(--accent-green)', '#3b82f6', 'var(--accent-red)', 'var(--accent-amber)', '#8b5cf6', '#ec4899']

const ESTADOS = {
  PENDIENTE:  { label: '⏳ Pendiente',  color: 'var(--accent-amber)' },
  EN_PROCESO: { label: '🔨 En proceso', color: '#3b82f6' },
  COMPLETADO: { label: '✅ Completado', color: 'var(--accent-green)' },
  ENTREGADO:  { label: '📦 Entregado',  color: '#8b5cf6' },
}

const EMPTY_FORM = { 
  cliente: '', 
  articuloId: '', 
  articuloNombre: '', 
  inicio: '', 
  fin: '', 
  color: 'var(--accent-green)',
  costoEnvio: ''  // ← NUEVO: campo para costo de envío
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function generarIdPedido() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
}

function formatearFechaLocal(fechaStr) {
  if (!fechaStr) return null
  const [year, month, day] = fechaStr.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
}

function formatearFechaMostrar(fechaStr) {
  if (!fechaStr) return ''
  const fecha = formatearFechaLocal(fechaStr)
  if (!fecha) return ''
  return fecha.toLocaleDateString()
}

// ─── VALIDACIÓN DE NÚMEROS ────────────────────────────────────────────────────
function validarNumero(valor) {
  if (!valor) return { esValido: true, numero: 0 }
  // Eliminar puntos y espacios, aceptar solo números y punto decimal
  const limpio = valor.toString().replace(/\./g, '').replace(/\s/g, '')
  const numero = parseFloat(limpio)
  if (isNaN(numero)) {
    return { esValido: false, numero: 0, error: 'Debe ingresar un número válido' }
  }
  if (numero < 0) {
    return { esValido: false, numero: 0, error: 'El costo no puede ser negativo' }
  }
  if (numero > 99999999) {
    return { esValido: false, numero: 0, error: 'El costo es demasiado alto' }
  }
  return { esValido: true, numero, error: null }
}

function formatearNumeroInput(valor) {
  if (!valor && valor !== 0) return ''
  return valor.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export default function EmprendedorPanel({
  products,
  setProducts,
  patients,
  addAppointment,
  setAppointments,
  nav,
}) {
  const toast = useToast()
  const { confirm } = useConfirm()
  const focusRef = useRef(null)

  // Estado principal
  const [pedidos, setPedidos] = useState(() => {
    try {
      const saved = localStorage.getItem('zenday-emprendedor-pedidos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed.filter(p => p?.id)
      }
    } catch (e) {
      console.error('[EmprendedorPanel] Error loading pedidos:', e)
    }
    return []
  })

  const [currentDate, setCurrentDate] = useState(new Date())
  const [filtroCliente, setFiltroCliente] = useState('')
  const [mostrarCrear, setMostrarCrear] = useState(false)
  const [pedidoSeleccionadoId, setPedidoSeleccionadoId] = useState(null)
  const [nuevoPedido, setNuevoPedido] = useState(EMPTY_FORM)
  const [errorEnvio, setErrorEnvio] = useState(null)
  
  // Estado para búsqueda de productos
  const [busquedaProducto, setBusquedaProducto] = useState('')
  const [mostrarDropdownProductos, setMostrarDropdownProductos] = useState(false)
  const inputProductoRef = useRef(null)
  const dropdownRef = useRef(null)

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          inputProductoRef.current && !inputProductoRef.current.contains(event.target)) {
        setMostrarDropdownProductos(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const pedidoSeleccionado = pedidos.find(p => p.id === pedidoSeleccionadoId) ?? null

  // ── Persistencia ──────────────────────────────────────────────────────────
  const savePedidos = useCallback((updater) => {
    setPedidos(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try {
        localStorage.setItem('zenday-emprendedor-pedidos', JSON.stringify(next))
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'zenday-emprendedor-pedidos',
          newValue: JSON.stringify(next)
        }))
      } catch (e) {
        console.error('[EmprendedorPanel] Error saving pedidos:', e)
      }
      return next
    })
  }, [])

  // ── Datos derivados ───────────────────────────────────────────────────────
  
  // Productos CON stock (para crear nuevos pedidos)
  const articulosConStock = useMemo(() =>
    products.filter(p => (p.stock || 0) > 0), [products])

  // Productos para búsqueda: SOLO los que tienen stock
  const productosFiltrados = useMemo(() => {
    if (!busquedaProducto.trim()) return articulosConStock.slice(0, 10)
    const query = busquedaProducto.toLowerCase()
    return articulosConStock.filter(p => 
      // Un codigo de articulo numerico salido de Excel tiraba abajo la busqueda
      // entera: escribias una letra y la pantalla se rompia.
      texto(p.name).toLowerCase().includes(query) ||
      texto(p.code).toLowerCase().includes(query)
    ).slice(0, 10)
  }, [articulosConStock, busquedaProducto])

  const clientesUnicos = useMemo(() =>
    [...new Set((patients || []).map(p => p.name))].sort(), [patients])

  const pedidosFiltrados = useMemo(() => {
    const activos = pedidos.filter(p =>
      p.estado !== 'ENTREGADO' &&
      (!filtroCliente || (p.cliente || '').toLowerCase().includes(filtroCliente.toLowerCase()))
    )
    return {
      PENDIENTE: activos.filter(p => p.estado === 'PENDIENTE'),
      EN_PROCESO: activos.filter(p => p.estado === 'EN_PROCESO'),
      COMPLETADO: activos.filter(p => p.estado === 'COMPLETADO'),
    }
  }, [pedidos, filtroCliente])

  const totalActivos = pedidosFiltrados.PENDIENTE.length +
    pedidosFiltrados.EN_PROCESO.length +
    pedidosFiltrados.COMPLETADO.length

  // ── Migración de IDs ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!products.length) return
    let migrado = false
    const nuevosPedidos = pedidos.map(pedido => {
      const articuloReal = products.find(prod =>
        String(prod.id) === String(pedido.articuloId) ||
        prod.name === pedido.articuloNombre
      )
      if (articuloReal && String(articuloReal.id) !== String(pedido.articuloId)) {
        migrado = true
        return { ...pedido, articuloId: String(articuloReal.id), articuloNombre: articuloReal.name }
      }
      return pedido
    })
    if (migrado) savePedidos(nuevosPedidos)
  }, [products, pedidos, savePedidos])

  // ── Cambiar estado ────────────────────────────────────────────────────────
  const cambiarEstado = useCallback((id, nuevoEstado) => {
    savePedidos(prev => prev.map(p => p.id === id ? { ...p, estado: nuevoEstado } : p))
    toast.addToast(`→ ${ESTADOS[nuevoEstado].label}`, 'success')
  }, [savePedidos, toast])

  // ── Entregar pedido ───────────────────────────────────────────────────────
  const entregarPedido = useCallback(async (pedido) => {
    const articulo = products.find(p =>
      String(p.id) === String(pedido.articuloId) ||
      p.name === pedido.articuloNombre
    )

    if (!articulo) {
      toast.addToast(`❌ Artículo "${pedido.articuloNombre}" no encontrado`, 'error')
      return
    }

    if ((articulo.stock ?? 0) <= 0) {
      toast.addToast(`❌ Sin stock de "${articulo.name}"`, 'error')
      return
    }

    const costoEnvio = pedido.costoEnvio || 0
    const precioTotal = (articulo.price || 0) + costoEnvio

    const ok = await confirm(
      `¿Entregar "${articulo.name}" a ${pedido.cliente}?\n\n` +
      `💰 Precio artículo: $${(articulo.price || 0).toLocaleString()} UYU\n` +
      `${costoEnvio > 0 ? `🚚 Costo envío: $${costoEnvio.toLocaleString()} UYU\n` : ''}` +
      `💸 Total a cobrar: $${precioTotal.toLocaleString()} UYU\n\n` +
      `Stock actual: ${articulo.stock} → ${articulo.stock - 1}`,
      'Confirmar entrega'
    )
    if (!ok) return

    setProducts(prevProducts =>
      prevProducts.map(p =>
        String(p.id) === String(articulo.id)
          ? { ...p, stock: (p.stock || 0) - 1 }
          : p
      )
    )

    const pacienteEncontrado = (patients || []).find(p => p.name === pedido.cliente)
    
    const nuevaAppointment = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      patientName: pedido.cliente,
      patientId: pacienteEncontrado?.id || null,
      productId: String(articulo.id),
      productName: articulo.name,
      price: precioTotal, // ← Precio TOTAL incluyendo envío
      shippingCost: costoEnvio, // ← Guardar costo de envío por separado
      startTime: new Date().toISOString(),
      status: 'delivered',
      paid: false,
      fromEmprendedor: true,
      createdAt: new Date().toISOString(),
    }

    if (typeof setAppointments === 'function') {
      setAppointments(prev => [...prev, nuevaAppointment])
    } else if (addAppointment) {
      // FIX: addAppointment devuelve false si el horario choca. Sin esto, el
      // pedido de producción se marcaba como creado y nunca llegaba a la agenda.
      if (addAppointment(nuevaAppointment) === false) {
        toast.addToast('❌ Ya hay otro pedido en ese horario de entrega', 'error')
        return
      }
    }

    savePedidos(prev => prev.filter(p => p.id !== pedido.id))
    
    const mensaje = costoEnvio > 0 
      ? `✅ "${articulo.name}" entregado a ${pedido.cliente} (${formatCurrency(precioTotal)} con envío)`
      : `✅ "${articulo.name}" entregado a ${pedido.cliente}`
    
    toast.addToast(mensaje, 'success')
    setPedidoSeleccionadoId(null)
  }, [products, setProducts, patients, addAppointment, setAppointments, savePedidos, confirm, toast])

  // ── ELIMINAR PEDIDO CON VALIDACIÓN (BAJA LÓGICA) ──────────────────────────
  const eliminarPedido = useCallback(async (id) => {
    const pedidoAEliminar = pedidos.find(p => p.id === id)
    
    if (!pedidoAEliminar) {
      toast.addToast('❌ Pedido no encontrado', 'error')
      return
    }
    
    if (pedidoAEliminar.estado === 'ENTREGADO') {
      toast.addToast('❌ No se puede eliminar un pedido ya entregado', 'error')
      return
    }
    
    if (pedidoAEliminar.estado === 'COMPLETADO') {
      toast.addToast('❌ No se puede eliminar un pedido completado. Primero debe ser entregado o rechazado.', 'error')
      return
    }
    
    const confirmado = await confirm(
      `¿Eliminar el pedido de "${pedidoAEliminar.cliente}" para "${pedidoAEliminar.articuloNombre}"?\nEsta acción no se puede deshacer.`,
      'Confirmar eliminación'
    )
    
    if (!confirmado) return
    
    savePedidos(prev => prev.filter(p => p.id !== id))
    toast.addToast('🗑️ Pedido eliminado correctamente', 'info')
    setPedidoSeleccionadoId(null)
  }, [pedidos, confirm, savePedidos, toast])

  // ── LIMPIAR TODOS LOS PEDIDOS CON VALIDACIÓN ──────────────────────────────
  const limpiarTodos = useCallback(async () => {
    const pedidosNoEntregados = pedidos.filter(p => p.estado !== 'ENTREGADO')
    
    if (pedidosNoEntregados.length === 0) {
      toast.addToast('No hay pedidos activos para limpiar', 'info')
      return
    }
    
    const confirmado = await confirm(
      `¿Limpiar TODOS los ${pedidosNoEntregados.length} pedidos activos?\n⚠️ Esta acción es irreversible.`,
      'Confirmar limpieza total'
    )
    
    if (!confirmado) return
    
    const pedidosEntregados = pedidos.filter(p => p.estado === 'ENTREGADO')
    savePedidos(pedidosEntregados)
    toast.addToast(`🧹 ${pedidosNoEntregados.length} pedidos eliminados`, 'info')
    setPedidoSeleccionadoId(null)
  }, [pedidos, confirm, savePedidos, toast])

  // ── Crear pedido (CON COSTO DE ENVÍO) ─────────────────────────────────────
  const crearPedido = useCallback(() => {
    const { cliente, articuloId, inicio, fin, costoEnvio } = nuevoPedido
    
    if (!cliente || !articuloId || !inicio || !fin) {
      toast.addToast('Completá todos los campos', 'error')
      return
    }
    
    // Validar costo de envío
    if (costoEnvio) {
      const validacion = validarNumero(costoEnvio)
      if (!validacion.esValido) {
        toast.addToast(`❌ ${validacion.error}`, 'error')
        return
      }
    }
    
    const fechaInicio = formatearFechaLocal(inicio)
    const fechaFin = formatearFechaLocal(fin)
    
    if (fechaFin && fechaInicio && fechaFin < fechaInicio) {
      toast.addToast('La fecha de fin debe ser posterior al inicio', 'error')
      return
    }

    const articulo = products.find(p => String(p.id) === String(articuloId))
    
    if (!articulo) {
      toast.addToast('❌ Artículo no encontrado', 'error')
      return
    }
    
    if ((articulo.stock || 0) <= 0) {
      toast.addToast(`❌ No hay stock disponible de "${articulo.name}". Agrega stock en "Artículos" primero.`, 'error')
      return
    }

    const costoEnvioNumero = validarNumero(costoEnvio).numero
    const precioTotal = (articulo.price || 0) + costoEnvioNumero

    const nuevo = {
      id: generarIdPedido(),
      cliente,
      articuloId: String(articuloId),
      articuloNombre: articulo.name,
      inicio,
      fin,
      color: nuevoPedido.color,
      estado: 'PENDIENTE',
      fechaCreacion: new Date().toISOString(),
      costoEnvio: costoEnvioNumero, // ← GUARDAR COSTO DE ENVÍO
      precioArticulo: articulo.price,
      precioTotal: precioTotal,
    }

    savePedidos(prev => [...prev, nuevo])
    setNuevoPedido(EMPTY_FORM)
    setBusquedaProducto('')
    setMostrarCrear(false)
    setErrorEnvio(null)
    
    const mensaje = costoEnvioNumero > 0
      ? `✅ Pedido creado (${formatCurrency(precioTotal)} con envío)`
      : '✅ Pedido creado'
    toast.addToast(mensaje, 'success')
  }, [nuevoPedido, products, savePedidos, toast])

  // ── Manejar cambio en costo de envío ───────────────────────────────────────
  const handleCostoEnvioChange = useCallback((e) => {
    const valor = e.target.value
    setNuevoPedido(prev => ({ ...prev, costoEnvio: valor }))
    
    if (valor) {
      const validacion = validarNumero(valor)
      if (!validacion.esValido) {
        setErrorEnvio(validacion.error)
      } else {
        setErrorEnvio(null)
      }
    } else {
      setErrorEnvio(null)
    }
  }, [])

  // ── Seleccionar producto desde el dropdown ────────────────────────────────
  const seleccionarProducto = useCallback((producto) => {
    console.log('📦 Seleccionando producto:', producto.name, 'ID:', producto.id, 'Stock:', producto.stock)
    
    setNuevoPedido(prev => ({ 
      ...prev, 
      articuloId: String(producto.id),
      articuloNombre: producto.name
    }))
    
    setBusquedaProducto(producto.name)
    setMostrarDropdownProductos(false)
  }, [])

  // ── Limpiar selección de producto ─────────────────────────────────────────
  const limpiarSeleccionProducto = useCallback(() => {
    setNuevoPedido(prev => ({ ...prev, articuloId: '', articuloNombre: '' }))
    setBusquedaProducto('')
    setMostrarDropdownProductos(true)
    if (inputProductoRef.current) {
      inputProductoRef.current.focus()
    }
  }, [])

  // ── Manejar cambio en el input de búsqueda ────────────────────────────────
  const handleBusquedaChange = useCallback((e) => {
    const valor = e.target.value
    setBusquedaProducto(valor)
    setMostrarDropdownProductos(true)
    
    if (valor === '') {
      setNuevoPedido(prev => ({ ...prev, articuloId: '', articuloNombre: '' }))
    }
  }, [])

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e, pedido) => {
    e.dataTransfer.setData('pedidoId', String(pedido.id))
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e) => { 
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((e, nuevoEstado) => {
    e.preventDefault()
    const pedidoId = e.dataTransfer.getData('pedidoId')
    setPedidos(prev => {
      const pedido = prev.find(p => String(p.id) === pedidoId)
      if (!pedido || pedido.estado === nuevoEstado) return prev
      if (nuevoEstado === 'ENTREGADO') {
        entregarPedido(pedido)
        return prev
      }
      const next = prev.map(p => String(p.id) === pedidoId ? { ...p, estado: nuevoEstado } : p)
      localStorage.setItem('zenday-emprendedor-pedidos', JSON.stringify(next))
      toast.addToast(`→ ${ESTADOS[nuevoEstado].label}`, 'success')
      return next
    })
  }, [entregarPedido, toast])

  // ── Calendario ────────────────────────────────────────────────────────────
  const eventosCalendario = useMemo(() => {
    const eventos = {}
    pedidos.filter(p => p.estado !== 'ENTREGADO').forEach(pedido => {
      const current = formatearFechaLocal(pedido.inicio)
      const fin = formatearFechaLocal(pedido.fin)
      if (!current || !fin) return
      
      const currentCopy = new Date(current)
      const finCopy = new Date(fin)
      
      while (currentCopy <= finCopy) {
        const year = currentCopy.getFullYear()
        const month = String(currentCopy.getMonth() + 1).padStart(2, '0')
        const day = String(currentCopy.getDate()).padStart(2, '0')
        const fecha = `${year}-${month}-${day}`
        
        if (!eventos[fecha]) eventos[fecha] = []
        eventos[fecha].push(pedido)
        currentCopy.setDate(currentCopy.getDate() + 1)
      }
    })
    return eventos
  }, [pedidos])

  const diasCalendario = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const primerDia = new Date(year, month, 1)
    const startOffset = primerDia.getDay() === 0 ? 6 : primerDia.getDay() - 1
    const diasEnMes = new Date(year, month + 1, 0).getDate()
    const today = new Date().toDateString()

    const dias = Array.from({ length: startOffset }, () => null)
    for (let d = 1; d <= diasEnMes; d++) {
      const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const fechaActual = new Date(year, month, d)
      dias.push({
        dia: d,
        fecha,
        eventos: eventosCalendario[fecha] || [],
        esHoy: fechaActual.toDateString() === today,
      })
    }
    return dias
  }, [currentDate, eventosCalendario])

  // Producto seleccionado (busca por ID y nombre)
  const productoSeleccionado = useMemo(() => {
    if (!nuevoPedido.articuloId && !nuevoPedido.articuloNombre) return null
    
    const porIdYNombre = products.find(p => 
      String(p.id) === String(nuevoPedido.articuloId) && 
      p.name === nuevoPedido.articuloNombre
    )
    if (porIdYNombre) return porIdYNombre
    
    const porNombre = products.find(p => p.name === nuevoPedido.articuloNombre)
    if (porNombre) return porNombre
    
    const porId = products.find(p => String(p.id) === String(nuevoPedido.articuloId))
    if (porId) return porId
    
    return null
  }, [products, nuevoPedido.articuloId, nuevoPedido.articuloNombre])

  const productoSeleccionadoSinStock = productoSeleccionado && (productoSeleccionado.stock || 0) === 0
  
  // Calcular precio total con envío para preview
  const precioArticulo = productoSeleccionado?.price || 0
  const costoEnvioNumero = validarNumero(nuevoPedido.costoEnvio).numero
  const precioConEnvio = precioArticulo + costoEnvioNumero

  function formatCurrency(value) {
    return new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(value)
  }

  // ── Sincronizar con evento storage ─────────────────────────────────────────
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'zenday-emprendedor-pedidos' && e.newValue) {
        try {
          const newData = JSON.parse(e.newValue)
          if (Array.isArray(newData)) {
            setPedidos(newData.filter(p => p?.id))
          }
        } catch (err) {
          console.error('[EmprendedorPanel] Error parsing storage event:', err)
        }
      }
    }
    
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="panel-emprendedor">

      {/* Header */}
      <div className="header-simple">
        <h2>📦 Panel de Producción</h2>
        <div className="header-stats">
          <span className="badge pendiente">{totalActivos} activos</span>
          <button 
            className="btn-crear" 
            onClick={() => {
              setNuevoPedido(EMPTY_FORM)
              setBusquedaProducto('')
              setErrorEnvio(null)
              setMostrarCrear(true)
            }}
          >
            {mostrarCrear ? '✕ Cerrar' : '+ Nuevo pedido'}
          </button>
          <button className="btn-limpiar" onClick={limpiarTodos}>
            🧹 Limpiar
          </button>
        </div>
      </div>

      {/* Aviso si no hay clientes */}
      {clientesUnicos.length === 0 && (
        <div style={{
          padding: '12px 16px', background: 'rgba(99,102,241,0.08)',
          borderRadius: 10, fontSize: 13, color: 'var(--accent-blue)', marginBottom: 12,
        }}>
          ℹ️ No tenés clientes.{' '}
          <button
            onClick={() => nav?.navigate('patients')}
            style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Ir a Clientes para agregar
          </button>
        </div>
      )}

      {/* Formulario de creación */}
      {mostrarCrear && (
        <div className="crear-panel" style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '16px', marginBottom: '20px' }}>
          
          {/* Selector de cliente */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>👤 Cliente *</label>
            <select
              value={nuevoPedido.cliente || ''}
              onChange={e => setNuevoPedido(prev => ({ ...prev, cliente: e.target.value }))}
              className="select-cliente"
              style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}
            >
              <option value="">Seleccionar cliente…</option>
              {clientesUnicos.map(nombre => (
                <option key={nombre} value={nombre}>{nombre}</option>
              ))}
            </select>
          </div>

          {/* Selector de artículo CON BÚSQUEDA */}
          <div style={{ marginBottom: '16px', position: 'relative' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📦 Artículo / Producto *</label>
            
            <input
              ref={inputProductoRef}
              type="text"
              placeholder="🔍 Buscar producto por nombre o código..."
              value={busquedaProducto}
              onChange={handleBusquedaChange}
              onFocus={() => setMostrarDropdownProductos(true)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                fontSize: '14px'
              }}
            />
            
            {nuevoPedido.articuloId && (
              <button
                onClick={limpiarSeleccionProducto}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: 'var(--text-tertiary)'
                }}
              >
                ✕
              </button>
            )}
            
            {/* Dropdown de resultados */}
            {mostrarDropdownProductos && productosFiltrados.length > 0 && (
              <div
                ref={dropdownRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  maxHeight: '250px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
              >
                {productosFiltrados.map(p => {
                  const isSelected = String(p.id) === String(nuevoPedido.articuloId)
                  return (
                    <div
                      key={String(p.id)}
                      onClick={() => seleccionarProducto(p)}
                      style={{
                        padding: '12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.2s',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: isSelected ? 700 : 600 }}>{p.name}</div>
                        {p.code && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Código: {p.code}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${p.price}</div>
                        <div style={{ fontSize: 11, color: 'var(--accent-green)' }}>
                          Stock: {p.stock} uds
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            
            {mostrarDropdownProductos && busquedaProducto && productosFiltrados.length === 0 && articulosConStock.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  padding: '16px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)'
                }}
              >
                ⚠️ No hay productos con stock disponible
              </div>
            )}
            
            {mostrarDropdownProductos && busquedaProducto && productosFiltrados.length === 0 && articulosConStock.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  padding: '16px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)'
                }}
              >
                🔍 No se encontraron productos para "{busquedaProducto}"
              </div>
            )}
            
            {/* Producto seleccionado */}
            {productoSeleccionado && (
              <div style={{ 
                marginTop: '8px', 
                padding: '10px 12px', 
                background: productoSeleccionadoSinStock 
                  ? 'rgba(239,68,68,0.15)' 
                  : 'rgba(16,185,129,0.15)', 
                borderRadius: '8px',
                fontSize: '13px',
                color: productoSeleccionadoSinStock ? 'var(--accent-red)' : 'var(--accent-green)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>
                  {productoSeleccionadoSinStock ? '⚠️' : '✅'} <strong>Seleccionado:</strong> {productoSeleccionado.name}
                  {productoSeleccionado.code && ` (${productoSeleccionado.code})`}
                </span>
                <span style={{ fontSize: '12px' }}>
                  Stock: {productoSeleccionado.stock} uds | ${productoSeleccionado.price}
                </span>
              </div>
            )}
            
            {productoSeleccionadoSinStock && (
              <div style={{ 
                marginTop: '8px', 
                padding: '8px 12px', 
                background: 'rgba(239,68,68,0.1)', 
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--accent-red)'
              }}>
                ⚠️ Este producto no tiene stock disponible. Agrega stock en "Artículos" para poder crear el pedido.
              </div>
            )}
          </div>

          {/* Fechas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📅 Fecha inicio *</label>
              <input
                type="date"
                value={nuevoPedido.inicio}
                onChange={e => setNuevoPedido(prev => ({ ...prev, inicio: e.target.value }))}
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>📅 Fecha fin *</label>
              <input
                type="date"
                value={nuevoPedido.fin}
                min={nuevoPedido.inicio}
                onChange={e => setNuevoPedido(prev => ({ ...prev, fin: e.target.value }))}
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}
              />
            </div>
          </div>

          {/* ─── COSTO DE ENVÍO (NUEVO) ─── */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>🚚 Costo de envío (opcional)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ 
                position: 'absolute', 
                left: '12px', 
                top: '50%', 
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
                fontWeight: 600
              }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ej: 150"
                value={nuevoPedido.costoEnvio}
                onChange={handleCostoEnvioChange}
                style={{
                  width: '100%',
                  padding: '12px 12px 12px 28px',
                  borderRadius: '12px',
                  border: errorEnvio ? '1px solid #ef4444' : '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  fontSize: '14px'
                }}
              />
            </div>
            {errorEnvio && (
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--accent-red)' }}>
                ❌ {errorEnvio}
              </div>
            )}
            {!errorEnvio && nuevoPedido.costoEnvio && validarNumero(nuevoPedido.costoEnvio).numero > 0 && (
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                💡 Sumará ${validarNumero(nuevoPedido.costoEnvio).numero} al precio final
              </div>
            )}
          </div>

          {/* Preview de precio total */}
          {productoSeleccionado && !productoSeleccionadoSinStock && (
            <div style={{ 
              marginBottom: '16px', 
              padding: '12px', 
              background: 'rgba(99,102,241,0.08)', 
              borderRadius: '12px',
              border: '1px solid rgba(99,102,241,0.15)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                <span>💰 Precio artículo:</span>
                <strong>{formatCurrency(precioArticulo)}</strong>
              </div>
              {costoEnvioNumero > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                  <span>🚚 Costo envío:</span>
                  <strong>{formatCurrency(costoEnvioNumero)}</strong>
                </div>
              )}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                fontSize: '14px', 
                paddingTop: '8px', 
                borderTop: '1px dashed rgba(99,102,241,0.2)',
                fontWeight: 700
              }}>
                <span>💸 Total a cobrar:</span>
                <span style={{ color: 'var(--accent-green)' }}>{formatCurrency(precioConEnvio)}</span>
              </div>
            </div>
          )}

          {/* Selector de color */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>🎨 Color</label>
            <div className="color-selector" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {COLORES.map(c => (
                <button
                  key={c}
                  className={`color-option ${nuevoPedido.color === c ? 'active' : ''}`}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: c,
                    border: nuevoPedido.color === c ? '3px solid #fff' : 'none',
                    boxShadow: nuevoPedido.color === c ? '0 0 0 2px #6366f1' : 'none',
                    cursor: 'pointer'
                  }}
                  onClick={() => setNuevoPedido(prev => ({ ...prev, color: c }))}
                />
              ))}
            </div>
          </div>

          {/* Botón crear */}
          <button 
            onClick={crearPedido}
            disabled={!nuevoPedido.articuloId || !nuevoPedido.cliente || !nuevoPedido.inicio || !nuevoPedido.fin || productoSeleccionadoSinStock || errorEnvio}
            style={{
              width: '100%',
              padding: '14px',
              background: (!nuevoPedido.articuloId || !nuevoPedido.cliente || !nuevoPedido.inicio || !nuevoPedido.fin || productoSeleccionadoSinStock || errorEnvio)
                ? 'var(--bg-tertiary)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              borderRadius: '12px',
              color: (!nuevoPedido.articuloId || !nuevoPedido.cliente || !nuevoPedido.inicio || !nuevoPedido.fin || productoSeleccionadoSinStock || errorEnvio)
                ? 'var(--text-tertiary)'
                : 'white',
              fontWeight: 700,
              fontSize: '16px',
              cursor: (!nuevoPedido.articuloId || !nuevoPedido.cliente || !nuevoPedido.inicio || !nuevoPedido.fin || productoSeleccionadoSinStock || errorEnvio)
                ? 'not-allowed'
                : 'pointer'
            }}
          >
            {productoSeleccionadoSinStock ? '⚠️ Sin stock disponible' : '+ Crear pedido'}
          </button>
        </div>
      )}

      {/* Buscador de clientes */}
      <input
        type="text"
        placeholder="🔍 Filtrar pedidos por cliente…"
        value={filtroCliente}
        onChange={e => setFiltroCliente(e.target.value)}
        className="buscador"
        style={{ width: '100%', padding: '12px', borderRadius: '12px', marginBottom: '16px', border: '1px solid var(--border)' }}
      />

      {/* Columnas Kanban */}
      <div className="columnas-dragdrop" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {Object.entries(ESTADOS).map(([key, info]) => {
          if (key === 'ENTREGADO') return null
          const lista = pedidosFiltrados[key] || []

          return (
            <div
              key={key}
              className="columna-drop"
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, key)}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: '16px',
                padding: '12px',
                minHeight: '400px'
              }}
            >
              <div className="columna-header" style={{ 
                borderBottom: `2px solid ${info.color}`,
                paddingBottom: '8px',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontWeight: 600 }}>{info.label}</span>
                <span className="columna-count" style={{ 
                  background: info.color,
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  fontSize: '12px'
                }}>{lista.length}</span>
              </div>

              <div className="columna-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {lista.map(p => {
                  const nombreActual = products.find(pr => String(pr.id) === String(p.articuloId))?.name || p.articuloNombre
                  const tieneEnvio = (p.costoEnvio || 0) > 0
                  const precioTotal = (p.precioArticulo || 0) + (p.costoEnvio || 0)
                  
                  return (
                    <div
                      key={p.id}
                      className={`pedido-card ${pedidoSeleccionado?.id === p.id ? 'seleccionado' : ''}`}
                      style={{
                        borderLeft: `4px solid ${p.color}`,
                        background: 'var(--bg-primary)',
                        borderRadius: '12px',
                        padding: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      draggable
                      onDragStart={e => handleDragStart(e, p)}
                      onClick={() => setPedidoSeleccionadoId(id => id === p.id ? null : p.id)}
                    >
                      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span className="card-cliente" style={{ fontWeight: 600 }}>{p.cliente}</span>
                        <button
                          className="btn-eliminar"
                          onClick={e => { e.stopPropagation(); eliminarPedido(p.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}
                          title="Eliminar pedido"
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="card-articulo" style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        {nombreActual}
                        {tieneEnvio && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--accent-green)' }}>🚚 +${p.costoEnvio}</span>}
                      </div>
                      <div className="card-fechas" style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                        📅 {formatearFechaMostrar(p.inicio)} → {formatearFechaMostrar(p.fin)}
                      </div>
                      <div className="card-precio" style={{ fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>
                        Total: {formatCurrency(precioTotal)}
                      </div>

                      {pedidoSeleccionado?.id === p.id && (
                        <div className="card-acciones" style={{ marginTop: '12px', display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                          {p.estado === 'PENDIENTE' && (
                            <button onClick={() => { cambiarEstado(p.id, 'EN_PROCESO'); setPedidoSeleccionadoId(null) }}
                              style={{ padding: '6px 12px', background: '#3b82f6', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer' }}>
                              🔨 En proceso
                            </button>
                          )}
                          {p.estado === 'EN_PROCESO' && (
                            <button onClick={() => { cambiarEstado(p.id, 'COMPLETADO'); setPedidoSeleccionadoId(null) }}
                              style={{ padding: '6px 12px', background: 'var(--accent-green)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer' }}>
                              ✅ Completar
                            </button>
                          )}
                          {p.estado === 'COMPLETADO' && (
                            <button onClick={() => entregarPedido(p)}
                              style={{ padding: '6px 12px', background: '#8b5cf6', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer' }}>
                              📦 Entregar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {lista.length === 0 && (
                  <div className="columna-vacia" style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '12px'
                  }}>
                    <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>📭</span>
                    <p>Soltá pedidos aquí</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Calendario */}
      <div className="calendario-simple" style={{ marginTop: '24px' }}>
        <div className="calendario-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1))}>◀</button>
          <h3>{currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}</h3>
          <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1))}>▶</button>
        </div>

        <div className="calendario-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div key={i} className="dia-semana" style={{ textAlign: 'center', padding: '8px', fontWeight: 600 }}>{d}</div>
          ))}

          {diasCalendario.map((dia, i) => (
            <div
              key={dia ? dia.fecha : `empty-${i}`}
              className={`dia-celda ${!dia ? 'vacio' : ''} ${dia?.esHoy ? 'hoy' : ''}`}
              style={{
                minHeight: '80px',
                background: dia?.esHoy ? 'rgba(99,102,241,0.1)' : 'var(--bg-secondary)',
                borderRadius: '8px',
                padding: '4px'
              }}
            >
              {dia && (
                <>
                  <span className="dia-numero" style={{ fontSize: '12px', fontWeight: 600 }}>{dia.dia}</span>
                  <div className="dia-pedidos" style={{ marginTop: '4px' }}>
                    {dia.eventos.slice(0, 3).map((p, j) => {
                      const nombreActual = products.find(pr => String(pr.id) === String(p.articuloId))?.name || p.articuloNombre
                      return (
                        <div
                          key={`${p.id}-${j}`}
                          className="pedido-barra"
                          style={{
                            background: p.color,
                            borderRadius: '4px',
                            padding: '2px 4px',
                            fontSize: '10px',
                            marginBottom: '2px',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'white'
                          }}
                          title={`${p.cliente} — ${nombreActual}${p.costoEnvio ? ' (con envío)' : ''}`}
                          onClick={() => setPedidoSeleccionadoId(p.id)}
                        >
                          {(nombreActual || '').substring(0, 10)}
                        </div>
                      )
                    })}
                    {dia.eventos.length > 3 && (
                      <div className="mas-eventos" style={{ fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                        +{dia.eventos.length - 3}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="calendario-leyenda" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          <span>💡 Click en el calendario para seleccionar</span>
          <span>🖱️ Arrastrá tarjetas para cambiar estado</span>
          <span>🚚 Los pedidos con envío tienen un badge</span>
        </div>
      </div>
    </div>
  )
}