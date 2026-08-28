// src/components/screens/ReportsScreen.jsx

import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency, getRevenueDate } from '../../utils/helpers'
import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { generateSalesReport, generateCustomersReport, generateInventoryReport, generateInactiveCustomersReport } from '../../utils/pdfReportGenerator'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const MAX_DATE_RANGE_DAYS      = 365
const LOW_STOCK_THRESHOLD      = 5
const INACTIVE_THRESHOLD_DAYS  = 60
const PAID_STATUSES            = new Set(['completed', 'delivered', 'picked'])

// Perfiles disponibles
const USER_MODES = {
  PROFESSIONAL: 'professional',
  ENTREPRENEUR: 'entrepreneur'
}

// ── Orden elegible por tipo de reporte ──────────────────────────────────────
// Los value tienen que coincidir con las claves que reconoce cada
// generateXReport() en pdfReportGenerator.js (ver la función `ordenar`).
const SORT_OPTIONS = {
  sales: [
    { value: 'fecha',    label: 'Fecha' },
    { value: 'cliente',  label: 'Cliente' },
    { value: 'producto', label: 'Producto' },
    { value: 'monto',    label: 'Monto' },
    { value: 'estado',   label: 'Estado' },
  ],
  customers: [
    { value: 'facturado', label: 'Facturado' },
    { value: 'nombre',    label: 'Nombre' },
    { value: 'pedidos',   label: 'Pedidos' },
    { value: 'cobrado',   label: 'Cobrado' },
    { value: 'ultimo',    label: 'Último pedido' },
  ],
  stock: [
    { value: 'nombre', label: 'Nombre' },
    { value: 'stock',  label: 'Stock' },
    { value: 'precio', label: 'Precio' },
    { value: 'valor',  label: 'Valor' },
  ],
  inactive: [
    { value: 'dias',   label: 'Días inactivo' },
    { value: 'nombre', label: 'Nombre' },
    { value: 'gasto',  label: 'Gastado' },
  ],
}

// Mismo criterio que la función `ordenar` de pdfReportGenerator.js — acá
// aparte porque ReportsScreen no la importa (evita acoplar la pantalla al
// módulo de PDF sólo por esto).
function ordenarLocal(lista, extractores, sortBy, sortDir) {
  const extraer = extractores[sortBy]
  if (!extraer) return lista
  const signo = sortDir === 'asc' ? 1 : -1
  return [...lista].sort((a, b) => {
    const va = extraer(a), vb = extraer(b)
    if (typeof va === 'string') return signo * va.localeCompare(vb)
    return signo * ((va ?? 0) - (vb ?? 0))
  })
}

// ─── HELPERS DE FECHA ─────────────────────────────────────────────────────────

// getRevenueDate vive en utils/helpers: las tres pantallas de plata tenian
// su propia copia y NO coincidian. Ver el comentario alla.

function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function getLocalDateKey(isoString) {
  if (!isoString) return null
  try {
    return format(parseISO(isoString), 'yyyy-MM-dd')
  } catch {
    return null
  }
}

function formatLocalDate(str) {
  if (!str) return ''
  try {
    return format(parseISO(str), 'dd/MM/yyyy')
  } catch {
    return str
  }
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function ReportsScreen({ nav, appointments, products, patients, userMode = 'professional' }) {
  const focusRef = useScreenFocus()
  const toast    = useToast()

  const [dateRange,      setDateRange]     = useState('month')
  const [startDate,      setStartDate]     = useState(() => {
    const t = new Date()
    return format(new Date(t.getFullYear(), t.getMonth(), 1), 'yyyy-MM-dd')
  })
  const [endDate,        setEndDate]       = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [reportType,     setReportType]    = useState('sales')
  // El orden venía fijo en cada reporte (fecha, o "top" por monto) sin forma
  // de cambiarlo. Cada tipo de reporte tiene sus propios campos ordenables
  // (ver SORT_OPTIONS), así que el campo elegido se resetea al cambiar de tipo.
  const [sortBy,         setSortBy]        = useState(SORT_OPTIONS.sales[0].value)
  const [sortDir,        setSortDir]       = useState('desc')
  const [loading,        setLoading]       = useState(false)
  const [categoryFilter, setCategoryFilter]= useState('all')
  const [selectedProfile, setSelectedProfile] = useState(userMode === 'entrepreneur' ? 'entrepreneur' : 'professional')

  // ── Validación ────────────────────────────────────────────────────────────
  const validateDateRange = useCallback(() => {
    const start = parseDateLocal(startDate)
    const end   = parseDateLocal(endDate)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      toast.addToast('❌ Fechas inválidas', 'error'); return false
    }
    if (start > end) {
      toast.addToast('❌ La fecha de inicio no puede ser mayor a la fecha de fin', 'error'); return false
    }
    const days = Math.ceil((end - start) / 86_400_000)
    if (days > MAX_DATE_RANGE_DAYS) {
      toast.addToast(`⚠️ El rango máximo es de ${MAX_DATE_RANGE_DAYS} días`, 'error'); return false
    }
    return true
  }, [startDate, endDate, toast])

  // ── Filtrar appointments por perfil ────────────────────────────────────────
  const getAppointmentsByProfile = useCallback((profile) => {
    if (profile === 'entrepreneur') {
      // Modo Emprendedor: solo pedidos creados desde EmprendedorPanel
      return appointments.filter(apt => apt.fromEmprendedor === true)
    } else {
      // Modo Profesional: pedidos de agenda normal (excluir los de emprendedor)
      return appointments.filter(apt => apt.fromEmprendedor !== true)
    }
  }, [appointments])

  // ── Filtrado por rango y perfil ────────────────────────────────────────────
  const filteredAppointments = useMemo(() => {
    const start = parseDateLocal(startDate)
    const end   = new Date(parseDateLocal(endDate))
    end.setHours(23, 59, 59, 999)

    const appointmentsByProfile = getAppointmentsByProfile(selectedProfile)

    return appointmentsByProfile.filter(apt => {
      const d = new Date(getRevenueDate(apt))
      return d >= start && d <= end
    })
  }, [startDate, endDate, selectedProfile, getAppointmentsByProfile])

  // ── Estadísticas de ventas ────────────────────────────────────────────────
  const salesStats = useMemo(() => {
    const completed = filteredAppointments.filter(a => PAID_STATUSES.has(a.status))
    const paid      = completed.filter(a => a.paid)
    const pending   = completed.filter(a => !a.paid)

    const totalSales   = paid.reduce((s, a) => s + (a.price || 0), 0)
    const totalPending = pending.reduce((s, a) => s + (a.price || 0), 0)

    const salesByDay = {}
    completed.forEach(apt => {
      const day = getLocalDateKey(getRevenueDate(apt))
      if (!day) return
      if (!salesByDay[day]) salesByDay[day] = { paid: 0, pending: 0, total: 0 }
      if (apt.paid) salesByDay[day].paid    += apt.price || 0
      else          salesByDay[day].pending += apt.price || 0
      salesByDay[day].total += apt.price || 0
    })

    // CORREGIDO: productSales solo con cobrados (paid)
    const productSales = {}
    paid.forEach(apt => {   // ← solo cobrados
      const name = apt.productName || 'Producto sin nombre'
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0, paid: 0 }
      productSales[name].quantity++
      productSales[name].revenue += apt.price || 0
      productSales[name].paid    += apt.price || 0
    })

    const topProducts = Object.entries(productSales)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    return {
      totalSales,
      totalPending,
      totalOrders:  completed.length,
      salesByDay,
      topProducts,
      paidCount:    paid.length,
      pendingCount: pending.length,
    }
  }, [filteredAppointments])

  // ── Datos para gráfico ────────────────────────────────────────────────────
  const salesByDayData = useMemo(() =>
    Object.entries(salesStats.salesByDay)
      .map(([date, data]) => ({
        date:      formatLocalDate(date),
        fecha:     date,
        ventas:    data.total,
        cobrado:   data.paid,
        pendiente: data.pending,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
  [salesStats.salesByDay])

  // ── Estadísticas de clientes ──────────────────────────────────────────────
  // CORREGIDO: customerStats solo con cobrados
  const customerStats = useMemo(() => {
    const byCustomer = {}
    // Solo appointments completados Y cobrados
    filteredAppointments
      .filter(a => PAID_STATUSES.has(a.status) && a.paid)
      .forEach(apt => {
        const name = apt.patientName || 'Sin nombre'
        if (!byCustomer[name]) byCustomer[name] = { orders: 0, spent: 0, paid: 0, lastOrder: null }
        byCustomer[name].orders++
        byCustomer[name].spent += apt.price || 0
        byCustomer[name].paid += apt.price || 0
        if (!byCustomer[name].lastOrder || new Date(apt.startTime) > new Date(byCustomer[name].lastOrder)) {
          byCustomer[name].lastOrder = apt.startTime
        }
      })

    const topCustomers = Object.entries(byCustomer)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10)

    const completedCount = filteredAppointments.filter(a => PAID_STATUSES.has(a.status)).length
    const paidCount = filteredAppointments.filter(a => PAID_STATUSES.has(a.status) && a.paid).length

    return {
      totalCustomers: Object.keys(byCustomer).length,
      topCustomers,
      totalOrders:   completedCount,
      paidOrders:    paidCount,
      averageOrder:  paidCount > 0 ? salesStats.totalSales / paidCount : 0,
    }
  }, [filteredAppointments, salesStats.totalSales])

  // ── Estadísticas de stock ─────────────────────────────────────────────────
  const stockStats = useMemo(() => {
    const filtered = categoryFilter === 'all'
      ? products
      : products.filter(p => p.category === categoryFilter)

    const lowStock   = filtered.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < LOW_STOCK_THRESHOLD)
    const outOfStock = filtered.filter(p => (p.stock || 0) === 0)
    const totalValue = filtered.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0)

    return {
      totalProducts:     filtered.length,
      lowStockCount:     lowStock.length,
      outOfStockCount:   outOfStock.length,
      totalValue,
      lowStockProducts:  lowStock,
      outOfStockProducts:outOfStock,
    }
  }, [products, categoryFilter])

  // ── Clientes inactivos ─────────────────────────────────────────────────────
  // A propósito, NO usa filteredAppointments (acotado al rango de fechas
  // elegido): "última compra" necesita ver TODO el historial del perfil, no
  // solo lo que cae en el período que se esté mirando en pantalla.
  const inactiveStats = useMemo(() => {
    const hoy = new Date()
    const porCliente = new Map()

    getAppointmentsByProfile(selectedProfile).forEach(a => {
      if (!a.patientName) return
      const key = a.patientId || a.patientName
      const actual = porCliente.get(key) || {
        name: a.patientName, phone: a.patientPhone || '', lastOrder: null, totalSpent: 0,
      }
      if (a.paid) actual.totalSpent += a.price || 0
      const cuando = new Date(a.startTime)
      if (!Number.isNaN(cuando.getTime()) && (!actual.lastOrder || cuando > actual.lastOrder)) {
        actual.lastOrder = cuando
      }
      porCliente.set(key, actual)
    })

    const conPedidos = new Set(
      getAppointmentsByProfile(selectedProfile).map(a => a.patientId || a.patientName).filter(Boolean)
    )

    // Clientes registrados que nunca compraron — el caso más urgente de
    // todos, invisible antes porque esto se armaba entero desde appointments.
    // `patients` viene de userMode (ver App.jsx), así que sólo es fiable
    // cuando selectedProfile coincide: en 'master' viendo el otro perfil no
    // hay forma de saber a qué modo pertenece cada cliente, y mostrar la
    // lista equivocada sería peor que no mostrar nada.
    const sinPedidos = selectedProfile === userMode
      ? (patients || [])
          .filter(p => p.id && !conPedidos.has(p.id) && !conPedidos.has(p.name))
          .map(p => {
            const desde = p.createdAt ? new Date(p.createdAt) : null
            const diasInactivo = desde && !Number.isNaN(desde.getTime())
              ? Math.floor((hoy - desde) / 86_400_000)
              : null
            return { name: p.name, phone: p.phone || '', totalSpent: 0, diasInactivo }
          })
          .filter(c => c.diasInactivo === null || c.diasInactivo >= INACTIVE_THRESHOLD_DAYS)
      : []

    const inactivos = [...porCliente.values()]
      .filter(c => c.lastOrder)
      .map(c => ({ ...c, diasInactivo: Math.floor((hoy - c.lastOrder) / 86_400_000) }))
      .filter(c => c.diasInactivo >= INACTIVE_THRESHOLD_DAYS)
      .concat(sinPedidos)
      .sort((a, b) => (b.diasInactivo ?? 0) - (a.diasInactivo ?? 0))

    return {
      inactivos,
      valorEnRiesgo: inactivos.reduce((s, c) => s + c.totalSpent, 0),
    }
  }, [selectedProfile, userMode, patients, getAppointmentsByProfile])

  // ── Orden elegido, aplicado a lo que se ve en pantalla y sale por Excel ────
  // (el PDF ordena por su cuenta, con el mismo sortBy/sortDir, adentro de
  // generateCustomersReport/generateInactiveCustomersReport). "Ventas" e
  // "Inventario" no tienen acá una lista equivalente a la del PDF completo
  // (la pantalla muestra top-10 / alertas, no el detalle entero), así que el
  // orden elegido para esos dos sólo afecta al PDF.
  const topCustomersOrdenados = useMemo(() => (
    reportType === 'customers'
      ? ordenarLocal(customerStats.topCustomers, {
          nombre: c => c.name, pedidos: c => c.orders, facturado: c => c.spent,
          cobrado: c => c.paid, ultimo: c => c.lastOrder ? new Date(c.lastOrder).getTime() : 0,
        }, sortBy, sortDir)
      : customerStats.topCustomers
  ), [customerStats.topCustomers, reportType, sortBy, sortDir])

  const inactivosOrdenados = useMemo(() => (
    reportType === 'inactive'
      ? ordenarLocal(inactiveStats.inactivos, {
          nombre: c => c.name, dias: c => c.diasInactivo, gasto: c => c.totalSpent,
        }, sortBy, sortDir)
      : inactiveStats.inactivos
  ), [inactiveStats.inactivos, reportType, sortBy, sortDir])

  // ── Comparativa período anterior ──────────────────────────────────────────
  const previousPeriodStats = useMemo(() => {
    const start = parseDateLocal(startDate)
    const end   = parseDateLocal(endDate)
    const days  = Math.max(1, Math.ceil((end - start) / 86_400_000))

    const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days)

    const appointmentsByProfile = getAppointmentsByProfile(selectedProfile)

    const prevTotal = appointmentsByProfile
      .filter(a => {
        const d = new Date(getRevenueDate(a))
        return d >= prevStart && d <= prevEnd && PAID_STATUSES.has(a.status) && a.paid
      })
      .reduce((s, a) => s + (a.price || 0), 0)

    const change = prevTotal === 0
      ? (salesStats.totalSales > 0 ? 100 : 0)
      : ((salesStats.totalSales - prevTotal) / prevTotal) * 100

    return { prevTotalSales: prevTotal, change }
  }, [startDate, endDate, salesStats.totalSales, selectedProfile, getAppointmentsByProfile])

  // ── Cambio de período rápido ──────────────────────────────────────────────
  const handleDateRangeChange = useCallback((range) => {
    setDateRange(range)
    const today = new Date()
    let start   = new Date(today)

    switch (range) {
      case 'today':   start = new Date(today); break
      case 'week':    start.setDate(today.getDate() - 7); break
      case 'month':   start = new Date(today.getFullYear(), today.getMonth(), 1); break
      case 'quarter': start = new Date(today.getFullYear(), today.getMonth() - 3, 1); break
      case 'year':    start = new Date(today.getFullYear(), 0, 1); break
      default: return
    }

    setStartDate(format(start, 'yyyy-MM-dd'))
    setEndDate(format(today,  'yyyy-MM-dd'))
  }, [])

  // ── Exportar PDF ──────────────────────────────────────────────────────────
  //
  // Antes esta función armaba el PDF a mano, en paralelo al generador de
  // src/utils/pdfReportGenerator.js — que ya tenía header con marca, tarjetas
  // de KPI, footer con número de página, top productos con formato y (en
  // Ventas) el desglose por medio de pago. Dos implementaciones del mismo PDF
  // que no se parecían: el "Reportes" del menú principal se veía pelado
  // mientras "Cobros pendientes" (la única pantalla que sí llamaba al
  // generador bueno) tenía todo eso. Ahora las tres reusan el mismo generador.
  const exportToPDF = useCallback(async () => {
    if (!validateDateRange()) return
    setLoading(true)
    try {
      const appointmentsDelPerfil = getAppointmentsByProfile(selectedProfile)

      if (reportType === 'sales') {
        generateSalesReport({
          appointments: appointmentsDelPerfil, startDate, endDate,
          comparisonChange: previousPeriodStats.change,
          sortBy, sortDir,
        })
      } else if (reportType === 'customers') {
        generateCustomersReport({ appointments: appointmentsDelPerfil, patients, startDate, endDate, sortBy, sortDir })
      } else if (reportType === 'inactive') {
        generateInactiveCustomersReport({
          appointments: appointmentsDelPerfil, patients, thresholdDays: INACTIVE_THRESHOLD_DAYS, sortBy, sortDir,
        })
      } else {
        const productosDelFiltro = categoryFilter === 'all'
          ? products
          : products.filter(p => p.category === categoryFilter)
        generateInventoryReport({ products: productosDelFiltro, sortBy, sortDir })
      }

      toast.addToast('📄 Reporte PDF generado', 'success')
    } catch (err) {
      console.error('[Reports] PDF error:', err)
      toast.addToast('❌ Error al generar el PDF', 'error')
    } finally {
      setLoading(false)
    }
  }, [reportType, startDate, endDate, selectedProfile, categoryFilter, products, patients, previousPeriodStats, sortBy, sortDir, getAppointmentsByProfile, validateDateRange, toast])

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportToExcel = useCallback(() => {
    if (!validateDateRange()) return

    let data = []
    const perfilTexto = selectedProfile === 'entrepreneur' ? 'Emprendedor' : 'Profesional'

    if (reportType === 'sales') {
      data = [
        [`Reporte de Ventas - ${perfilTexto}`],
        [`Período: ${formatLocalDate(startDate)} al ${formatLocalDate(endDate)}`],
        [],
        ['Resumen de Ventas'],
        ['Concepto','Valor'],
        ['Total ventas (cobrado)',    formatCurrency(salesStats.totalSales,'UYU')],
        ['Pendiente de cobro',        formatCurrency(salesStats.totalPending,'UYU')],
        ['Total pedidos',             salesStats.totalOrders],
        ['Pedidos pagados',           salesStats.paidCount],
        ['Pedidos pendientes',        salesStats.pendingCount],
        ['Variación vs anterior',     `${previousPeriodStats.change > 0 ? '+' : ''}${previousPeriodStats.change.toFixed(1)}%`],
        [],
        ['Top Productos (solo cobrados)'],
        ['Producto','Cantidad','Ingresos'],
        ...salesStats.topProducts.map(p => [p.name, p.quantity, formatCurrency(p.revenue,'UYU')]),
      ]
    } else if (reportType === 'customers') {
      data = [
        [`Reporte de Clientes - ${perfilTexto}`],
        [`Período: ${formatLocalDate(startDate)} al ${formatLocalDate(endDate)}`],
        [],
        ['Resumen de Clientes'],
        ['Concepto','Valor'],
        ['Total clientes activos',    customerStats.totalCustomers],
        ['Ticket promedio (cobrado)', formatCurrency(customerStats.averageOrder,'UYU')],
        [],
        ['Top Clientes (por gasto cobrado)'],
        ['Cliente','Pedidos','Gastado'],
        ...topCustomersOrdenados.map(c => [c.name, c.orders, formatCurrency(c.spent,'UYU')]),
      ]
    } else if (reportType === 'inactive') {
      data = [
        [`Clientes inactivos (${INACTIVE_THRESHOLD_DAYS}+ días) - ${perfilTexto}`],
        [],
        ['Resumen'],
        ['Concepto','Valor'],
        ['Clientes inactivos', inactiveStats.inactivos.length],
        ['Valor histórico',    formatCurrency(inactiveStats.valorEnRiesgo,'UYU')],
        [],
        ['Cliente','Días inactivo','Gastado históricamente'],
        ...inactivosOrdenados.map(c => [c.name, c.diasInactivo === null ? 'Nunca compró' : c.diasInactivo, formatCurrency(c.totalSpent,'UYU')]),
      ]
    } else {
      data = [
        [`Reporte de Inventario - ${perfilTexto}`],
        [],
        ['Resumen de Inventario'],
        ['Concepto','Valor'],
        ['Total productos',          stockStats.totalProducts],
        ['Valor del inventario',     formatCurrency(stockStats.totalValue,'UYU')],
        ['Productos con stock bajo', stockStats.lowStockCount],
        ['Productos agotados',       stockStats.outOfStockCount],
        [],
        ['Productos con stock bajo'],
        ['Producto','Stock','Precio'],
        ...stockStats.lowStockProducts.map(p => [p.name, p.stock, formatCurrency(p.price,'UYU')]),
        [],
        ['Productos agotados'],
        ['Producto','Precio'],
        ...stockStats.outOfStockProducts.map(p => [p.name, formatCurrency(p.price,'UYU')]),
      ]
    }

    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Reporte_${reportType}_${selectedProfile}`)
    XLSX.writeFile(wb, `reporte_${reportType}_${selectedProfile}_${startDate}_al_${endDate}.xlsx`)
    toast.addToast('📊 Reporte Excel generado', 'success')
  }, [reportType, startDate, endDate, salesStats, customerStats, stockStats, inactiveStats, topCustomersOrdenados, inactivosOrdenados, previousPeriodStats, selectedProfile, validateDateRange, toast])

  const trendClass = previousPeriodStats.change > 0 ? 'positive' : previousPeriodStats.change < 0 ? 'negative' : 'neutral'
  const trendIcon  = previousPeriodStats.change > 0 ? '↑' : previousPeriodStats.change < 0 ? '↓' : '→'

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="reports-screen">
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">📊 Reportes</h2>
      </div>

      {/* Selector de perfil */}
      {userMode === 'master' && (
        <div className="profile-selector" style={{
          display: 'flex', gap: '12px', padding: '16px 24px',
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)'
        }}>
          <span style={{ fontWeight: 500, marginRight: '8px' }}>👥 Ver reportes de:</span>
          <button
            className={`profile-btn ${selectedProfile === 'professional' ? 'active' : ''}`}
            onClick={() => setSelectedProfile('professional')}
            style={{
              padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--border)',
              background: selectedProfile === 'professional' ? 'var(--accent-blue)' : 'transparent',
              color: selectedProfile === 'professional' ? 'white' : 'var(--text-primary)',
              cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            💼 Profesional
          </button>
          <button
            className={`profile-btn ${selectedProfile === 'entrepreneur' ? 'active' : ''}`}
            onClick={() => setSelectedProfile('entrepreneur')}
            style={{
              padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--border)',
              background: selectedProfile === 'entrepreneur' ? 'var(--accent-green)' : 'transparent',
              color: selectedProfile === 'entrepreneur' ? 'white' : 'var(--text-primary)',
              cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            📦 Emprendedor
          </button>
        </div>
      )}

      {/* Badge del perfil actual si no es master */}
      {userMode !== 'master' && (
        <div className="current-profile-badge" style={{
          padding: '12px 24px', background: userMode === 'entrepreneur' ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
          borderBottom: `1px solid ${userMode === 'entrepreneur' ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)'}`
        }}>
          <span style={{ fontSize: '13px', fontWeight: 500 }}>
            {userMode === 'entrepreneur' ? '📦 Modo Emprendedor' : '💼 Modo Profesional'}
          </span>
        </div>
      )}

      {/* Tipo de reporte */}
      <div className="report-type-selector">
        {[
          { key:'sales',     label:'💰 Ventas' },
          { key:'customers', label:'👥 Clientes' },
          { key:'stock',     label:'📦 Inventario' },
          { key:'inactive',  label:'😴 Inactivos' },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`report-type-btn ${reportType === key ? 'active' : ''}`}
            onClick={() => { setReportType(key); setSortBy(SORT_OPTIONS[key][0].value); setSortDir(key === 'stock' ? 'asc' : 'desc') }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Orden de la lista principal — mismo campo para el PDF, el Excel y
          (donde aplica) la vista previa. */}
      <div className="report-filters" style={{ marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Ordenar por</span>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: '10px', border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px',
          }}
        >
          {SORT_OPTIONS[reportType].map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'}
          style={{
            padding: '6px 12px', borderRadius: '10px', border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer',
          }}
        >
          {sortDir === 'asc' ? '↑ Ascendente' : '↓ Descendente'}
        </button>
      </div>

      {/* Filtros de fecha */}
      <div className="report-filters">
        <div className="date-range-buttons">
          {[
            { key:'today',   label:'Hoy' },
            { key:'week',    label:'7 días' },
            { key:'month',   label:'Mes' },
            { key:'quarter', label:'3 meses' },
            { key:'year',    label:'Año' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={dateRange === key ? 'active' : ''}
              onClick={() => handleDateRangeChange(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="custom-date-range">
          <label>
            <span>Desde</span>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>
      </div>

      {/* ── VENTAS ──────────────────────────────────────────────────────────── */}
      {reportType === 'sales' && (
        <div className="report-content">
          <div className="kpi-grid">
            <div className="kpi-card primary">
              <div className="kpi-icon">💰</div>
              <div className="kpi-info">
                <span className="kpi-value">{formatCurrency(salesStats.totalSales, 'UYU')}</span>
                <span className="kpi-label">Ventas totales (cobrado)</span>
                <span className={`trend ${trendClass}`}>
                  {trendIcon} {Math.abs(previousPeriodStats.change).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="kpi-card warning">
              <div className="kpi-icon">⏳</div>
              <div className="kpi-info">
                <span className="kpi-value">{formatCurrency(salesStats.totalPending, 'UYU')}</span>
                <span className="kpi-label">Pendiente de cobro</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon">📦</div>
              <div className="kpi-info">
                <span className="kpi-value">{salesStats.totalOrders}</span>
                <span className="kpi-label">Pedidos</span>
              </div>
            </div>
            <div className="kpi-card success">
              <div className="kpi-icon">✓</div>
              <div className="kpi-info">
                <span className="kpi-value">{salesStats.paidCount}</span>
                <span className="kpi-label">Pagados</span>
              </div>
            </div>
          </div>

          {salesByDayData.length > 0 && (
            <div className="chart-section">
              <h3>📈 Evolución de ventas</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={salesByDayData}>
                  <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={12} />
                  <YAxis tickFormatter={v => `$${v}`} stroke="var(--text-tertiary)" fontSize={12} />
                  <Tooltip formatter={v => formatCurrency(v, 'UYU')} />
                  <Legend />
                  <Line type="monotone" dataKey="ventas"  name="Ventas"  stroke="var(--accent-blue)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cobrado" name="Cobrado" stroke="var(--accent-green)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="report-section">
            <h3>🏆 Top productos más vendidos (solo cobrados)</h3>
            <div className="top-products-list">
              {salesStats.topProducts.length === 0 ? (
                <div className="empty-message">No hay datos en este período</div>
              ) : salesStats.topProducts.map((p, i) => (
                <div key={i} className="top-product-item">
                  <div className="top-product-rank">#{i + 1}</div>
                  <div className="top-product-info">
                    <span className="top-product-name">{p.name}</span>
                    <span className="top-product-meta">{p.quantity} unidades</span>
                  </div>
                  <div className="top-product-revenue">{formatCurrency(p.revenue, 'UYU')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CLIENTES ────────────────────────────────────────────────────────── */}
      {reportType === 'customers' && (
        <div className="report-content">
          <div className="kpi-grid">
            <div className="kpi-card primary">
              <div className="kpi-icon">👥</div>
              <div className="kpi-info">
                <span className="kpi-value">{customerStats.totalCustomers}</span>
                <span className="kpi-label">Clientes activos</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon">💵</div>
              <div className="kpi-info">
                <span className="kpi-value">{formatCurrency(customerStats.averageOrder, 'UYU')}</span>
                <span className="kpi-label">Ticket promedio (cobrado)</span>
              </div>
            </div>
          </div>

          <div className="report-section">
            <h3>🏆 Top clientes (por gasto cobrado)</h3>
            <div className="top-customers-list">
              {topCustomersOrdenados.length === 0 ? (
                <div className="empty-message">No hay datos en este período</div>
              ) : topCustomersOrdenados.map((c, i) => (
                <div key={i} className="top-customer-item">
                  <div className="top-customer-rank">#{i + 1}</div>
                  <div className="top-customer-info">
                    <span className="top-customer-name">{c.name}</span>
                    <span className="top-customer-meta">{c.orders} pedidos</span>
                  </div>
                  <div className="top-customer-spent">{formatCurrency(c.spent, 'UYU')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── INVENTARIO ──────────────────────────────────────────────────────── */}
      {reportType === 'stock' && (
        <div className="report-content">
          <div className="filter-group">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">Todas las categorías</option>
              {[...new Set(products.map(p => p.category).filter(Boolean))].map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card primary">
              <div className="kpi-icon">📦</div>
              <div className="kpi-info">
                <span className="kpi-value">{stockStats.totalProducts}</span>
                <span className="kpi-label">Total productos</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon">💰</div>
              <div className="kpi-info">
                <span className="kpi-value">{formatCurrency(stockStats.totalValue, 'UYU')}</span>
                <span className="kpi-label">Valor del inventario</span>
              </div>
            </div>
            <div className="kpi-card warning">
              <div className="kpi-icon">⚠️</div>
              <div className="kpi-info">
                <span className="kpi-value">{stockStats.lowStockCount}</span>
                <span className="kpi-label">Stock bajo</span>
              </div>
            </div>
            <div className="kpi-card danger">
              <div className="kpi-icon">❌</div>
              <div className="kpi-info">
                <span className="kpi-value">{stockStats.outOfStockCount}</span>
                <span className="kpi-label">Agotados</span>
              </div>
            </div>
          </div>

          {stockStats.lowStockProducts.length > 0 && (
            <div className="report-section warning">
              <h3>⚠️ Productos con stock bajo (&lt;{LOW_STOCK_THRESHOLD} unidades)</h3>
              <div className="low-stock-list">
                {stockStats.lowStockProducts.map(p => (
                  <div key={p.id} className="stock-item">
                    <span className="stock-name">{p.name}</span>
                    <span className="stock-quantity">{p.stock} uds</span>
                    <span className="stock-price">{formatCurrency(p.price, 'UYU')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stockStats.outOfStockProducts.length > 0 && (
            <div className="report-section danger">
              <h3>❌ Productos agotados</h3>
              <div className="out-stock-list">
                {stockStats.outOfStockProducts.map(p => (
                  <div key={p.id} className="stock-item">
                    <span className="stock-name">{p.name}</span>
                    <span className="stock-price">{formatCurrency(p.price, 'UYU')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stockStats.lowStockProducts.length === 0 && stockStats.outOfStockProducts.length === 0 && (
            <div className="empty-message success">✅ ¡Todo en orden! No hay productos con problemas de stock.</div>
          )}
        </div>
      )}

      {reportType === 'inactive' && (
        <div className="report-content">
          <div className="kpi-grid">
            <div className="kpi-card warning">
              <div className="kpi-icon">😴</div>
              <div className="kpi-info">
                <span className="kpi-value">{inactiveStats.inactivos.length}</span>
                <span className="kpi-label">Clientes inactivos ({INACTIVE_THRESHOLD_DAYS}+ días)</span>
              </div>
            </div>
            <div className="kpi-card danger">
              <div className="kpi-icon">💸</div>
              <div className="kpi-info">
                <span className="kpi-value">{formatCurrency(inactiveStats.valorEnRiesgo, 'UYU')}</span>
                <span className="kpi-label">Valor histórico</span>
              </div>
            </div>
          </div>

          {inactivosOrdenados.length > 0 ? (
            <div className="report-section warning">
              <h3>😴 Sin comprar hace {INACTIVE_THRESHOLD_DAYS}+ días</h3>
              <div className="low-stock-list">
                {inactivosOrdenados.map(c => (
                  <div key={c.name} className="stock-item">
                    <span className="stock-name">{c.name}</span>
                    <span className="stock-quantity">{c.diasInactivo === null ? 'Nunca compró' : `${c.diasInactivo} días`}</span>
                    <span className="stock-price">{formatCurrency(c.totalSpent, 'UYU')}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-message success">✅ Todos tus clientes compraron en los últimos {INACTIVE_THRESHOLD_DAYS} días.</div>
          )}
        </div>
      )}

      {/* Exportar */}
      <div className="export-buttons">
        <button className="btn-export-pdf" onClick={exportToPDF} disabled={loading}>
          {loading ? '⏳ Generando…' : '📄 Exportar PDF'}
        </button>
        <button className="btn-export-excel" onClick={exportToExcel}>
          📊 Exportar Excel
        </button>
      </div>

      <div className="bottom-padding" />
    </div>
  )
}

export default ReportsScreen