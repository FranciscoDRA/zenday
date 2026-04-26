// src/components/screens/ReportsScreen.jsx

import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency } from '../../utils/helpers'
import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const MAX_DATE_RANGE_DAYS = 365
const LOW_STOCK_THRESHOLD = 5
const PAID_STATUSES       = new Set(['completed', 'delivered', 'picked'])

// ─── HELPERS DE FECHA ─────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → Date en hora LOCAL (evita el bug de UTC) */

function getRevenueDate(a) {
  return a.deliveredAt || a.paymentDate || a.startTime
}

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

export function ReportsScreen({ nav, appointments, products, patients }) {
  const focusRef = useScreenFocus()
  const toast    = useToast()

  const [dateRange,      setDateRange]     = useState('month')
  const [startDate,      setStartDate]     = useState(() => {
    const t = new Date()
    return format(new Date(t.getFullYear(), t.getMonth(), 1), 'yyyy-MM-dd')
  })
  const [endDate,        setEndDate]       = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [reportType,     setReportType]    = useState('sales')
  const [loading,        setLoading]       = useState(false)
  const [categoryFilter, setCategoryFilter]= useState('all')

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

  // ── Filtrado por rango ────────────────────────────────────────────────────
  const filteredAppointments = useMemo(() => {
    const start = parseDateLocal(startDate)                     // ← hora local
    const end   = new Date(parseDateLocal(endDate))
    end.setHours(23, 59, 59, 999)

    return appointments.filter(apt => {
      const d = new Date(getRevenueDate(apt))
return d >= start && d <= end
    })
  }, [appointments, startDate, endDate])

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

    const productSales = {}
    completed.forEach(apt => {
      const name = apt.productName || 'Producto sin nombre'
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0, paid: 0 }
      productSales[name].quantity++
      productSales[name].revenue += apt.price || 0
      if (apt.paid) productSales[name].paid += apt.price || 0
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
  const customerStats = useMemo(() => {
    const byCustomer = {}
    filteredAppointments.forEach(apt => {
      const name = apt.patientName || 'Sin nombre'
      if (!byCustomer[name]) byCustomer[name] = { orders: 0, spent: 0, paid: 0 }
      byCustomer[name].orders++
      byCustomer[name].spent += apt.price || 0
      if (apt.paid) byCustomer[name].paid += apt.price || 0
    })

    const topCustomers = Object.entries(byCustomer)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10)

    // ← totalOrders estaba ausente — causaba que averageOrder siempre mostrara '$0'
    const completedCount = filteredAppointments.filter(a => PAID_STATUSES.has(a.status)).length

    return {
      totalCustomers: Object.keys(byCustomer).length,
      topCustomers,
      totalOrders:   completedCount,
      averageOrder:  completedCount > 0 ? salesStats.totalSales / completedCount : 0,
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

  // ── Comparativa período anterior ──────────────────────────────────────────
  const previousPeriodStats = useMemo(() => {
    const start = parseDateLocal(startDate)
    const end   = parseDateLocal(endDate)
    const days  = Math.max(1, Math.ceil((end - start) / 86_400_000))

    const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days)

    const prevTotal = appointments
      .filter(a => {
        const d = new Date(getRevenueDate(a))
      return d >= prevStart && d <= prevEnd && PAID_STATUSES.has(a.status) && a.paid
      })
      .reduce((s, a) => s + (a.price || 0), 0)

    const change = prevTotal === 0
      ? (salesStats.totalSales > 0 ? 100 : 0)
      : ((salesStats.totalSales - prevTotal) / prevTotal) * 100

    return { prevTotalSales: prevTotal, change }
  }, [appointments, startDate, endDate, salesStats.totalSales])

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
  const exportToPDF = useCallback(async () => {
    if (!validateDateRange()) return
    setLoading(true)
    try {
      const doc = new jsPDF()
      const pw  = doc.internal.pageSize.getWidth()

      doc.setFontSize(24); doc.setTextColor(99,102,241)
      doc.text('ZenDay', pw/2, 20, { align:'center' })

      doc.setFontSize(18); doc.setTextColor(0,0,0)
      doc.text(`Reporte de ${reportType === 'sales' ? 'Ventas' : reportType === 'customers' ? 'Clientes' : 'Stock'}`, pw/2, 35, { align:'center' })

      doc.setFontSize(10); doc.setTextColor(100,100,100)
      doc.text(`Período: ${formatLocalDate(startDate)} al ${formatLocalDate(endDate)}`, pw/2, 45, { align:'center' })
      doc.text(`Generado: ${new Date().toLocaleString()}`, pw/2, 52, { align:'center' })

      let y = 65

      if (reportType === 'sales') {
        doc.setFontSize(14); doc.setTextColor(0,0,0)
        doc.text('Resumen de Ventas', 14, y); y += 10

        autoTable(doc, {
          startY: y,
          body: [
            ['Total ventas',          formatCurrency(salesStats.totalSales, 'UYU')],
            ['Pendiente de cobro',    formatCurrency(salesStats.totalPending, 'UYU')],
            ['Total pedidos',         salesStats.totalOrders.toString()],
            ['Pedidos pagados',       salesStats.paidCount.toString()],
            ['Pedidos pendientes',    salesStats.pendingCount.toString()],
            ['Variación vs anterior', `${previousPeriodStats.change > 0 ? '+' : ''}${previousPeriodStats.change.toFixed(1)}%`],
          ],
          theme:'striped', styles:{ fontSize:10 },
          columnStyles:{ 0:{ fontStyle:'bold' } },
        })

        y = doc.lastAutoTable.finalY + 15

        if (salesStats.topProducts.length > 0) {
          doc.text('Top productos más vendidos', 14, y); y += 5
          autoTable(doc, {
            startY: y,
            head: [['Producto','Cantidad','Ingresos']],
            body: salesStats.topProducts.map(p => [p.name, p.quantity.toString(), formatCurrency(p.revenue,'UYU')]),
            theme:'striped', headStyles:{ fillColor:[99,102,241] },
          })
        }

      } else if (reportType === 'customers') {
        autoTable(doc, {
          startY: y,
          head: [['Cliente','Pedidos','Gastado']],
          body: customerStats.topCustomers.map(c => [c.name, c.orders.toString(), formatCurrency(c.spent,'UYU')]),
          theme:'striped', headStyles:{ fillColor:[99,102,241] },
        })

      } else {
        autoTable(doc, {
          startY: y,
          body: [
            ['Total productos',          stockStats.totalProducts.toString()],
            ['Valor del inventario',     formatCurrency(stockStats.totalValue,'UYU')],
            ['Productos con stock bajo', stockStats.lowStockCount.toString()],
            ['Productos agotados',       stockStats.outOfStockCount.toString()],
          ],
          theme:'striped',
        })

        if (stockStats.lowStockProducts.length > 0) {
          y = doc.lastAutoTable.finalY + 15
          doc.text('Productos con stock bajo', 14, y); y += 5
          autoTable(doc, {
            startY: y,
            head: [['Producto','Stock','Precio']],
            body: stockStats.lowStockProducts.map(p => [p.name, p.stock.toString(), formatCurrency(p.price,'UYU')]),
            theme:'striped', headStyles:{ fillColor:[245,158,11] },
          })
        }
      }

      doc.save(`reporte_${reportType}_${startDate}_al_${endDate}.pdf`)
      toast.addToast('📄 Reporte PDF generado', 'success')
    } catch (err) {
      console.error('[Reports] PDF error:', err)
      toast.addToast('❌ Error al generar el PDF', 'error')
    } finally {
      setLoading(false)
    }
  }, [reportType, startDate, endDate, salesStats, customerStats, stockStats, previousPeriodStats, validateDateRange, toast])

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportToExcel = useCallback(() => {
    if (!validateDateRange()) return

    let data = []
    if (reportType === 'sales') {
      data = [
        ['Resumen de Ventas'],
        ['Concepto','Valor'],
        ['Total ventas',          formatCurrency(salesStats.totalSales,'UYU')],
        ['Pendiente de cobro',    formatCurrency(salesStats.totalPending,'UYU')],
        ['Total pedidos',         salesStats.totalOrders],
        ['Pedidos pagados',       salesStats.paidCount],
        ['Pedidos pendientes',    salesStats.pendingCount],
        ['Variación vs anterior', `${previousPeriodStats.change > 0 ? '+' : ''}${previousPeriodStats.change.toFixed(1)}%`],
        [],
        ['Top Productos'],
        ['Producto','Cantidad','Ingresos'],
        ...salesStats.topProducts.map(p => [p.name, p.quantity, formatCurrency(p.revenue,'UYU')]),
      ]
    } else if (reportType === 'customers') {
      data = [
        ['Resumen de Clientes'],
        ['Concepto','Valor'],
        ['Total clientes activos', customerStats.totalCustomers],
        ['Ticket promedio',        formatCurrency(customerStats.averageOrder,'UYU')],
        [],
        ['Top Clientes'],
        ['Cliente','Pedidos','Gastado'],
        ...customerStats.topCustomers.map(c => [c.name, c.orders, formatCurrency(c.spent,'UYU')]),
      ]
    } else {
      data = [
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
    XLSX.utils.book_append_sheet(wb, ws, `Reporte_${reportType}`)
    XLSX.writeFile(wb, `reporte_${reportType}_${startDate}_al_${endDate}.xlsx`)
    toast.addToast('📊 Reporte Excel generado', 'success')
  }, [reportType, startDate, endDate, salesStats, customerStats, stockStats, previousPeriodStats, validateDateRange, toast])

  const trendClass = previousPeriodStats.change > 0 ? 'positive' : previousPeriodStats.change < 0 ? 'negative' : 'neutral'
  const trendIcon  = previousPeriodStats.change > 0 ? '↑' : previousPeriodStats.change < 0 ? '↓' : '→'

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="reports-screen">
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">📊 Reportes</h2>
      </div>

      {/* Tipo de reporte */}
      <div className="report-type-selector">
        {[
          { key:'sales',     label:'💰 Ventas' },
          { key:'customers', label:'👥 Clientes' },
          { key:'stock',     label:'📦 Inventario' },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`report-type-btn ${reportType === key ? 'active' : ''}`}
            onClick={() => setReportType(key)}
          >
            {label}
          </button>
        ))}
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
                <span className="kpi-label">Ventas totales</span>
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
                  <Line type="monotone" dataKey="ventas"  name="Ventas"  stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cobrado" name="Cobrado" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="report-section">
            <h3>🏆 Top productos más vendidos</h3>
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
                {/* ← ahora usa customerStats.totalOrders que SÍ existe */}
                <span className="kpi-value">{formatCurrency(customerStats.averageOrder, 'UYU')}</span>
                <span className="kpi-label">Ticket promedio</span>
              </div>
            </div>
          </div>

          <div className="report-section">
            <h3>🏆 Top clientes</h3>
            <div className="top-customers-list">
              {customerStats.topCustomers.length === 0 ? (
                <div className="empty-message">No hay datos en este período</div>
              ) : customerStats.topCustomers.map((c, i) => (
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