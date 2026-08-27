import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency, parseLocalDate, todayKey, getRevenueDate } from '../../utils/helpers'
import { cierreDelDia, desglosePorMedio } from '../../utils/mediosDePago'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, LineChart, Line, ComposedChart, Legend
} from 'recharts'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PAID_STATUSES = new Set(['completed', 'delivered', 'picked'])

const CATEGORIES = ['Materiales', 'Transporte', 'Servicios', 'Publicidad', 'Alquiler', 'Salarios', 'Otros']

const CATEGORY_COLORS = {
  Materiales: 'var(--accent-blue)',
  Transporte: 'var(--accent-amber)',
  Servicios: 'var(--accent-green)',
  Publicidad: 'var(--accent-red)',
  Alquiler: '#8b5cf6',
  Salarios: '#ec4899',
  Otros: '#6b7280',
}

const MONTH_NAMES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTH_NAMES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// getRevenueDate vive en utils/helpers: las tres pantallas de plata tenian
// su propia copia y NO coincidian. Ver el comentario alla.

function pctChange(current, prev) {
  if (prev === 0) return current > 0 ? 100 : 0
  return ((current - prev) / Math.abs(prev)) * 100
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 150)
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
    }}>
      <p style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>{label}</p>
      {payload.map((item, i) => (
        <p key={i} style={{ color: item.color, margin: '4px 0', fontSize: 13 }}>
          {item.name}: {formatCurrency(item.value, 'UYU')}
        </p>
      ))}
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export function FinancialScreen({ nav, appointments, expenses = [], setExpenses }) {
  const focusRef = useScreenFocus()
  const toast = useToast()
  const { confirm } = useConfirm()

  // Estados
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(null) // null = ver año completo
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [chartView, setChartView] = useState('bar')
  const [reportType, setReportType] = useState('monthly')
  const [isExporting, setIsExporting] = useState(false)
  const [newExpense, setNewExpense] = useState({
    amount: '', category: '', description: '',
    date: todayKey(),
  })

  // Fechas
  const now = useMemo(() => new Date(), [])
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const targetMonth = selectedMonth?.month ?? null
  const targetYear = selectedYear

  // ========== INGRESOS ==========
  // FIX: antes era `paid === true || PAID_STATUSES.has(status)`. Como el filtro
  // de abajo ya exige PAID_STATUSES, este predicado daba true para TODOS los
  // elementos filtrados y "Falta cobrar" quedaba siempre en $0. El cobro lo
  // determina el flag `paid`, no el estado del pedido.
  const isPaidOrCompleted = useCallback((appointment) => {
    return appointment.paid === true
  }, [])

  const revenueData = useMemo(() => {
    let filtered = appointments.filter(a => {
      const d = new Date(getRevenueDate(a))
      return d.getFullYear() === targetYear && PAID_STATUSES.has(a.status)
    })

    if (targetMonth !== null) {
      filtered = filtered.filter(a => new Date(getRevenueDate(a)).getMonth() === targetMonth)
    }

    const paid = filtered.filter(a => isPaidOrCompleted(a)).reduce((s, a) => s + (a.price || 0), 0)
    const pending = filtered.filter(a => !isPaidOrCompleted(a)).reduce((s, a) => s + (a.price || 0), 0)
    const total = paid + pending   // facturado = cobrado + pendiente
    const paidCount = filtered.filter(a => isPaidOrCompleted(a)).length
    const unpaidCount = filtered.length - paidCount

    return {
      total,        // facturado: cobrado + pendiente
      paid,         // lo que efectivamente cobraste
      pending,      // lo que falta cobrar
      count: filtered.length,
      paidCount,
      unpaidCount,
      averageTicket: paidCount === 0 ? 0 : paid / paidCount,
      // La lista ya filtrada por período. Se expone para que el desglose por
      // medio de pago salga EXACTAMENTE de los mismos registros que el total
      // de arriba: así los dos números no se pueden separar nunca.
      items: filtered,
    }
  }, [appointments, targetYear, targetMonth, isPaidOrCompleted])

  // ========== GASTOS ==========
  const expenseData = useMemo(() => {
    let filtered = expenses.filter(e => {
      const d = parseLocalDate(e.date)
      return d.getFullYear() === targetYear
    })

    if (targetMonth !== null) {
      filtered = filtered.filter(e => parseLocalDate(e.date).getMonth() === targetMonth)
    }

    const total = filtered.reduce((s, e) => s + (e.amount || 0), 0)
    const byCategory = filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + (e.amount || 0)
      return acc
    }, {})

    return {
      total, byCategory, count: filtered.length,
      items: filtered.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date))
    }
  }, [expenses, targetYear, targetMonth])

  // `revenueData.total` es FACTURADO (cobrado + pendiente). La ganancia real y
  // el margen tienen que salir de lo que entro de verdad: `paid`. Con `total`,
  // la tarjeta "Ganancia real" venia inflada por todo lo que falta cobrar.
  // ── El cierre del día ────────────────────────────────────────────────────
  // La pregunta que se hace todo el mundo a las ocho de la noche antes de bajar
  // la persiana: cuánto entró hoy, por qué vía, y cuánta plata tiene que haber
  // físicamente en el cajón. Hasta ahora la app sabía el total del mes y nada
  // sobre el día.
  const cierre = useMemo(() => cierreDelDia(appointments, new Date()),
    [appointments])

  // ── Cómo te pagaron, en el período que estás mirando ─────────────────────
  //
  // El cierre de arriba es de HOY: sirve para contar el cajón antes de bajar la
  // persiana, y mañana ya no dice nada de ayer.
  //
  // Esto es el mismo dato pero del mes (o del año) elegido arriba, que es lo
  // que se mira para entender el negocio en vez de para cuadrar la caja.
  //
  // Faltaba, y era el agujero que hacía inútil todo lo demás: se podía marcar
  // "cobré con débito" y ese dato no aparecía en ningún lado que no fuera el
  // día de hoy. `desglosePorMedio` estaba escrito y probado desde el principio
  // y no lo llamaba nadie. Registrar algo que después no se puede consultar es
  // pedirle trabajo al usuario a cambio de nada.
  //
  // Sale de `revenueData.items`, la MISMA lista ya filtrada que da el total de
  // "Cobrado". No de `appointments` con un rango de fechas propio: dos filtros
  // parecidos se desincronizan solos y la suma de los medios dejaría de dar el
  // total de arriba. Acá no pueden separarse ni por un peso.
  const desglose = useMemo(() => desglosePorMedio(revenueData.items),
    [revenueData.items])

  // Cuánto de lo cobrado en el período no tiene medio anotado. Se muestra
  // explícito: si es alto, el desglose todavía no sirve para decidir nada y el
  // usuario tiene que saberlo, no descubrirlo.
  const sinRegistrar = desglose.porMedio.find(m => m.id === 'sin-registrar')

  const netProfit = revenueData.paid - expenseData.total
  const profitMargin = revenueData.paid === 0 ? 0 : (netProfit / revenueData.paid) * 100

  // ========== DATOS ACUMULADOS POR MES (para el año) ==========
  const monthlyData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      // CORREGIDO: filtrar por paid === true O status completado
      const monthRevenue = appointments
        .filter(a => {
          const d = new Date(getRevenueDate(a))
          return d.getMonth() === i && d.getFullYear() === targetYear && 
                 PAID_STATUSES.has(a.status) && isPaidOrCompleted(a)
        })
        .reduce((s, a) => s + (a.price || 0), 0)

      const monthExpense = expenses
        .filter(e => {
          const d = parseLocalDate(e.date)
          return d.getMonth() === i && d.getFullYear() === targetYear
        })
        .reduce((s, e) => s + (e.amount || 0), 0)

      return {
        name: MONTH_NAMES_SHORT[i],
        ingresos: monthRevenue,
        gastos: monthExpense,
        ganancia: monthRevenue - monthExpense,
        isCurrentMonth: i === currentMonth && targetYear === currentYear
      }
    })
  }, [appointments, expenses, targetYear, currentMonth, currentYear, isPaidOrCompleted])

  // ========== ACUMULADO ANUAL ==========
  const yearlyAccumulated = useMemo(() => {
    const totalRevenue = monthlyData.reduce((sum, m) => sum + m.ingresos, 0)
    const totalExpenses = monthlyData.reduce((sum, m) => sum + m.gastos, 0)
    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      profit: totalRevenue - totalExpenses,
      margin: totalRevenue === 0 ? 0 : ((totalRevenue - totalExpenses) / totalRevenue) * 100
    }
  }, [monthlyData])

  // ========== COMPARATIVA CON AÑO ANTERIOR ==========
  const previousYearData = useMemo(() => {
    const prevYear = targetYear - 1
    let prevRevenue = 0
    let prevExpenses = 0

    appointments.forEach(a => {
      const d = new Date(getRevenueDate(a))
      if (d.getFullYear() === prevYear && PAID_STATUSES.has(a.status) && isPaidOrCompleted(a)) {
        prevRevenue += a.price || 0
      }
    })

    expenses.forEach(e => {
      const d = parseLocalDate(e.date)
      if (d.getFullYear() === prevYear) {
        prevExpenses += e.amount || 0
      }
    })

    const prevProfit = prevRevenue - prevExpenses

    return {
      revenue: prevRevenue,
      expenses: prevExpenses,
      profit: prevProfit,
      revenueChange: pctChange(yearlyAccumulated.revenue, prevRevenue),
      expenseChange: pctChange(yearlyAccumulated.expenses, prevExpenses),
      profitChange: pctChange(yearlyAccumulated.profit, prevProfit)
    }
  }, [appointments, expenses, targetYear, yearlyAccumulated, isPaidOrCompleted])

  // ========== CATEGORÍAS PARA GRÁFICO ==========
  const categoryChartData = useMemo(() =>
    Object.entries(expenseData.byCategory).map(([name, value]) => ({
      name, value, color: CATEGORY_COLORS[name] ?? '#6b7280',
    })).sort((a, b) => b.value - a.value),
    [expenseData.byCategory])

  // ========== NAVEGACIÓN ==========
  const goToPrevYear = () => setSelectedYear(prev => prev - 1)
  const goToNextYear = () => {
    if (selectedYear < currentYear) setSelectedYear(prev => prev + 1)
  }
  const goToCurrentYear = () => {
    setSelectedYear(currentYear)
    setSelectedMonth(null)
  }

  const selectMonth = (monthIndex) => {
    if (selectedMonth?.month === monthIndex && selectedYear === targetYear) {
      setSelectedMonth(null)
    } else {
      setSelectedMonth({ month: monthIndex, year: targetYear })
    }
  }

  const isSelectedMonth = (monthIndex) => {
    return selectedMonth?.month === monthIndex && selectedYear === targetYear
  }

  // ========== EXPORTAR A EXCEL ==========
  const handleExportExcel = useCallback(async () => {
    setIsExporting(true)
    try {
      const reportData = []

      if (targetMonth !== null) {
        // Reporte mensual
        reportData.push(['RESUMEN FINANCIERO - MES', `${MONTH_NAMES_LONG[targetMonth]} ${targetYear}`])
        reportData.push([])
        reportData.push(['MÉTRICA', 'VALOR'])
        reportData.push(['Ingresos Cobrados', revenueData.paid])
        reportData.push(['Pendiente de Cobro', revenueData.pending])
        reportData.push(['Total Facturado', revenueData.total])
        reportData.push(['Gastos Totales', expenseData.total])
        reportData.push(['Ganancia Real', netProfit])
        reportData.push(['Margen de Ganancia', `${profitMargin.toFixed(2)}%`])
        reportData.push(['Citas Completadas', revenueData.count])
        reportData.push(['Citas Cobradas', revenueData.paidCount])
        reportData.push(['Citas sin Cobrar', revenueData.unpaidCount])
        reportData.push([])
        reportData.push(['GASTOS POR CATEGORÍA'])
        reportData.push(['Categoría', 'Monto'])
        Object.entries(expenseData.byCategory).forEach(([cat, amount]) => {
          reportData.push([cat, amount])
        })
      } else {
        // Reporte anual
        reportData.push(['RESUMEN FINANCIERO - AÑO', targetYear])
        reportData.push([])
        reportData.push(['MÉTRICA', 'VALOR'])
        reportData.push(['Ingresos Cobrados', yearlyAccumulated.revenue])
        reportData.push(['Gastos Anuales', yearlyAccumulated.expenses])
        reportData.push(['Ganancia Real', yearlyAccumulated.profit])
        reportData.push(['Margen Anual', `${yearlyAccumulated.margin.toFixed(2)}%`])
        reportData.push([])
        reportData.push(['COMPARATIVA CON AÑO ANTERIOR'])
        reportData.push(['Métrica', `${targetYear}`, `${targetYear - 1}`, 'Variación'])
        reportData.push(['Ingresos Cobrados', yearlyAccumulated.revenue, previousYearData.revenue, `${previousYearData.revenueChange.toFixed(1)}%`])
        reportData.push(['Gastos', yearlyAccumulated.expenses, previousYearData.expenses, `${previousYearData.expenseChange.toFixed(1)}%`])
        reportData.push(['Ganancia', yearlyAccumulated.profit, previousYearData.profit, `${previousYearData.profitChange.toFixed(1)}%`])
        reportData.push([])
        reportData.push(['DETALLE POR MES'])
        reportData.push(['Mes', 'Ingresos Cobrados', 'Gastos', 'Ganancia'])
        monthlyData.forEach(m => {
          reportData.push([m.name, m.ingresos, m.gastos, m.ganancia])
        })
      }

      const ws = XLSX.utils.aoa_to_sheet(reportData)
      const wb = XLSX.utils.book_new()
      const fileName = targetMonth !== null
        ? `reporte-financiero-${MONTH_NAMES_LONG[targetMonth]}-${targetYear}.xlsx`
        : `reporte-financiero-${targetYear}.xlsx`

      XLSX.utils.book_append_sheet(wb, ws, 'Reporte Financiero')
      XLSX.writeFile(wb, fileName)
      toast.addToast('📊 Reporte exportado a Excel', 'success')
    } catch (err) {
      console.error('Error exporting Excel:', err)
      toast.addToast('❌ Error al exportar reporte', 'error')
    } finally {
      setIsExporting(false)
    }
  }, [targetYear, targetMonth, revenueData, expenseData, netProfit, profitMargin, yearlyAccumulated, monthlyData, previousYearData, toast])

  // ========== AGREGAR GASTO ==========
  const handleAddExpense = useCallback(() => {
    const amount = parseFloat(newExpense.amount)
    if (!amount || amount <= 0) {
      toast.addToast('❌ Ingresá un monto válido', 'error')
      return
    }
    if (amount > 1_000_000) toast.addToast('⚠️ El monto parece muy alto', 'warning')
    if (!newExpense.category) {
      toast.addToast('❌ Seleccioná una categoría', 'error')
      return
    }

    const expense = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount,
      category: newExpense.category,
      description: newExpense.description || 'Sin descripción',
      date: newExpense.date,
    }

    setExpenses?.(prev => [...prev, expense])
    toast.addToast('✅ Gasto registrado', 'success')
    setShowExpenseModal(false)
    setNewExpense({
      amount: '', category: '', description: '',
      date: todayKey(),
    })
  }, [newExpense, setExpenses, toast])

  // ========== ELIMINAR GASTO ==========
  const handleDeleteExpense = useCallback(async (expenseId) => {
    const confirmed = await confirm('¿Eliminar este gasto?', 'Esta acción no se puede deshacer')
    if (!confirmed) return

    setExpenses(prev => prev.filter(e => e.id !== expenseId))
    toast.addToast('🗑️ Gasto eliminado', 'success')
  }, [setExpenses, confirm, toast])

  // ========== RENDER PRINCIPAL ==========
  const periodLabel = targetMonth !== null
    ? `${MONTH_NAMES_LONG[targetMonth]} ${targetYear}`
    : `Año ${targetYear}`

  return (
    <div ref={focusRef} tabIndex={-1} className="financial-screen">

      {/* Header */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">💰 Panel Financiero</h2>
        <div className="top-bar-actions" style={{ display: 'flex', gap: '8px' }}>
          <button
            className="icon-btn"
            onClick={handleExportExcel}
            disabled={isExporting}
            title="Exportar a Excel"
            style={{ opacity: isExporting ? 0.5 : 1 }}
          >
            📊
          </button>
          <button
            className={`icon-btn ${chartView === 'bar' ? 'active' : ''}`}
            onClick={() => setChartView('bar')}
            title="Gráfico de barras"
          >
            📊
          </button>
          <button
            className={`icon-btn ${chartView === 'area' ? 'active' : ''}`}
            onClick={() => setChartView('area')}
            title="Gráfico de área"
          >
            📈
          </button>
          <button
            className={`icon-btn ${chartView === 'composed' ? 'active' : ''}`}
            onClick={() => setChartView('composed')}
            title="Gráfico combinado"
          >
            📉
          </button>
        </div>
      </div>

      <div className="current-date" style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-tertiary)' }}>
        {now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>

      {/* Selector de período */}
      <div className="month-selector" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={goToPrevYear}>← Año anterior</button>
        <span className="current-month" style={{ fontSize: 18, fontWeight: 700 }}>{periodLabel}</span>
        <button onClick={goToNextYear} disabled={selectedYear >= currentYear} style={{ opacity: selectedYear >= currentYear ? 0.4 : 1 }}>
          Año siguiente →
        </button>
        {selectedYear !== currentYear && (
          <button className="reset-month" onClick={goToCurrentYear}>Año actual</button>
        )}
      </div>

      {/* Selector de meses (grid) */}
      <div style={{
        display: 'grid', gridTemplateRows: 'repeat(2, 1fr)', gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '8px', marginBottom: 24, background: 'var(--bg-secondary)', padding: 12,
        borderRadius: 16, border: '1px solid var(--border)'
      }}>
        {MONTH_NAMES_SHORT.map((month, idx) => (
          <button
            key={month}
            onClick={() => selectMonth(idx)}
            style={{
              padding: '8px 4px', borderRadius: 10, border: 'none',
              background: isSelectedMonth(idx) ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
              color: isSelectedMonth(idx) ? 'white' : 'var(--text-primary)',
              cursor: 'pointer', fontWeight: 500, fontSize: 14,
              transition: 'all 0.2s'
            }}
          >
            {month}
          </button>
        ))}
      </div>

      {/* Botón agregar gasto */}
      <div className="add-expense-container" style={{ marginBottom: 24 }}>
        <button className="add-expense-btn" onClick={() => setShowExpenseModal(true)}>
          + Registrar Gasto
        </button>
      </div>

      {/* ── CIERRE DEL DÍA ────────────────────────────────────────────────
          Va PRIMERO a propósito. El resto de esta pantalla contesta "cómo viene
          el mes"; esto contesta "cuánto tiene que haber en la caja ahora", que
          es lo que se necesita todos los días a la misma hora. */}
      <div className="cierre-dia">
        <div className="cierre-dia-encabezado">
          <div>
            <h3>🧾 Cierre de hoy</h3>
            <span className="cierre-dia-fecha">
              {new Date().toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>
          <div className="cierre-dia-total">
            <span className="cierre-dia-monto">{formatCurrency(cierre.total, 'UYU')}</span>
            <span className="cierre-dia-cuenta">
              {cierre.cantidad === 1 ? '1 cobro' : `${cierre.cantidad} cobros`}
            </span>
          </div>
        </div>

        {cierre.cantidad === 0 ? (
          <p className="cierre-dia-vacio">Todavía no registraste cobros hoy.</p>
        ) : (
          <>
            <div className="cierre-dia-medios">
              {cierre.porMedio.map(m => (
                <div key={m.id} className="cierre-dia-medio">
                  <span className="cierre-dia-icono">{m.icono}</span>
                  <span className="cierre-dia-label">{m.label}</span>
                  <span className="cierre-dia-cant">{m.cantidad}</span>
                  <strong className="cierre-dia-valor">{formatCurrency(m.monto, 'UYU')}</strong>
                </div>
              ))}
            </div>

            {/* Ésta es la línea por la que existe todo esto. */}
            <div className="cierre-dia-caja">
              <span>💵 En la caja tiene que haber</span>
              <strong>{formatCurrency(cierre.enCaja, 'UYU')}</strong>
            </div>
          </>
        )}
      </div>

      {/* KPIs principales - VERSIÓN CLARA */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        
        <div className="stat-card revenue" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.05))' }}>
          <span className="stat-value" style={{ color: 'var(--accent-green)' }}>{formatCurrency(revenueData.paid, 'UYU')}</span>
          <span className="stat-label">✅ Lo que cobraste</span>
          <span className="stat-change">{revenueData.paidCount} citas completadas</span>
        </div>

        <div className="stat-card warning">
          <span className="stat-value" style={{ color: 'var(--accent-amber)' }}>{formatCurrency(revenueData.pending, 'UYU')}</span>
          <span className="stat-label">⏳ Falta cobrar</span>
          <span className="stat-change">{revenueData.unpaidCount} citas sin cobrar</span>
        </div>

        <div className={`stat-card ${netProfit >= 0 ? 'profit' : 'loss'}`}>
          <span className="stat-value" style={{ color: netProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {formatCurrency(netProfit, 'UYU')}
          </span>
          <span className="stat-label">💸 Ganancia real</span>
          <span className="stat-change">Cobrado menos gastos</span>
        </div>

      </div>

      {/* Total general como contexto */}
      <div style={{ 
        padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 12, 
        marginBottom: 24, border: '1px solid var(--border)', fontSize: 13,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          📊 Total facturado (cobrado + pendiente):
        </span>
        {/* `total` YA es cobrado + pendiente. Sumarle `pending` otra vez contaba
            el pendiente dos veces: 50 cobrado + 20 pendiente daba 90 facturado. */}
        <strong>{formatCurrency(revenueData.total, 'UYU')}</strong>
      </div>

      {/* ── CÓMO TE PAGARON, EN ESTE PERÍODO ──────────────────────────────
          Va acá, pegado a los KPI, porque habla del MISMO período que ellos.
          El "Cierre de hoy" de más arriba habla del día y mezclarlos confunde.

          La suma de estas filas da exacto el "Cobrado" de la tarjeta verde:
          salen de la misma lista filtrada, no de dos filtros parecidos. */}
      {desglose.cantidad > 0 && (
        <div className="desglose-medios">
          <div className="desglose-medios-titulo">
            <h3>💳 Cómo te pagaron</h3>
            <span className="desglose-medios-periodo">{periodLabel}</span>
          </div>

          <div className="desglose-medios-lista">
            {desglose.porMedio.map(m => {
              const porcentaje = desglose.total > 0 ? (m.monto / desglose.total) * 100 : 0
              return (
                <div key={m.id} className="desglose-medio">
                  <div className="desglose-medio-fila">
                    <span className="desglose-medio-icono">{m.icono}</span>
                    <span className="desglose-medio-label">{m.label}</span>
                    <span className="desglose-medio-cant">
                      {m.cantidad === 1 ? '1 cobro' : `${m.cantidad} cobros`}
                    </span>
                    <span className="desglose-medio-pct">{porcentaje.toFixed(0)}%</span>
                    <strong className="desglose-medio-monto">{formatCurrency(m.monto, 'UYU')}</strong>
                  </div>
                  {/* La barra es el punto: de un vistazo se ve si el negocio
                      depende de una sola vía de cobro. Un número solo no. */}
                  <div className="desglose-medio-barra">
                    <div
                      className={`desglose-medio-relleno ${m.id === 'sin-registrar' ? 'es-incognita' : ''}`}
                      style={{ width: `${Math.max(porcentaje, 1)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="desglose-medios-pie">
            <span>💵 De eso, efectivo</span>
            <strong>{formatCurrency(desglose.enCaja, 'UYU')}</strong>
          </div>

          {/* Honestidad antes que un gráfico lindo: si la mitad de los cobros no
              tienen medio anotado, el desglose no sirve para decidir nada
              todavía, y el usuario tiene que saberlo acá y no darse cuenta solo
              tres meses después. */}
          {sinRegistrar && (
            <p className="desglose-medios-aviso">
              ⚠️ {formatCurrency(sinRegistrar.monto, 'UYU')} de este período se cobraron antes
              de que se pudiera anotar el medio de pago, o se marcaron como cobrados sin elegir uno.
              Esa parte no está repartida arriba.
            </p>
          )}
        </div>
      )}

      {/* Comparativa con año anterior (solo vista anual) */}
      {targetMonth === null && (
        <div className="chart-section" style={{ marginBottom: 24 }}>
          <h3 className="chart-title">📈 Comparativa con {targetYear - 1}</h3>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(previousYearData.revenue, 'UYU')}</span>
              <span className="stat-label">Ingresos {targetYear - 1}</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(previousYearData.expenses, 'UYU')}</span>
              <span className="stat-label">Gastos {targetYear - 1}</span>
            </div>
            <div className={`stat-card ${previousYearData.profit >= 0 ? 'profit' : 'loss'}`}>
              <span className="stat-value" style={{ color: previousYearData.profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {formatCurrency(previousYearData.profit, 'UYU')}
              </span>
              <span className="stat-label">Ganancia {targetYear - 1}</span>
            </div>
          </div>
        </div>
      )}

      {/* Gráfico principal */}
      <div className="chart-section">
        <h3 className="chart-title">📊 Evolución {targetMonth !== null ? 'mensual' : `- ${targetYear}`}</h3>
        <ResponsiveContainer width="100%" height={350}>
          {chartView === 'bar' && (
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
              <YAxis stroke="var(--text-tertiary)" fontSize={12} tickFormatter={(v) => formatCurrency(v, 'UYU')} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="ingresos" name="Ingresos Cobrados" fill="var(--accent-green)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="gastos" name="Gastos" fill="var(--accent-red)" radius={[8, 8, 0, 0]} />
            </BarChart>
          )}
          {chartView === 'area' && (
            <AreaChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
              <YAxis stroke="var(--text-tertiary)" fontSize={12} tickFormatter={(v) => formatCurrency(v, 'UYU')} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area type="monotone" dataKey="ingresos" name="Ingresos Cobrados" stroke="var(--accent-green)" fill="#10b98133" />
              <Area type="monotone" dataKey="gastos" name="Gastos" stroke="var(--accent-red)" fill="#ef444433" />
            </AreaChart>
          )}
          {chartView === 'composed' && (
            <ComposedChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
              <YAxis stroke="var(--text-tertiary)" fontSize={12} tickFormatter={(v) => formatCurrency(v, 'UYU')} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="ingresos" name="Ingresos Cobrados" fill="var(--accent-green)" barSize={30} />
              <Line type="monotone" dataKey="ganancia" name="Ganancia" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Categorías de gastos + resumen */}
      <div className="charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
        <div className="chart-section half">
          <h3 className="chart-title">🥧 Gastos por categoría</h3>
          {categoryChartData.length === 0 ? (
            <div className="empty-chart"><span>📊</span><p>Sin gastos este período</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={categoryChartData}
                  cx="50%" cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {categoryChartData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-section half">
          <h3 className="chart-title">📋 Resumen {targetMonth !== null ? `de ${MONTH_NAMES_LONG[targetMonth]}` : `del año`}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderBottom: '1px solid var(--border)' }}>
              <span>✅ Cobrado</span>
              <strong style={{ color: 'var(--accent-green)' }}>{formatCurrency(revenueData.paid, 'UYU')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderBottom: '1px solid var(--border)' }}>
              <span>⏳ Pendiente de cobro</span>
              <strong style={{ color: 'var(--accent-amber)' }}>{formatCurrency(revenueData.pending, 'UYU')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderBottom: '1px solid var(--border)' }}>
              <span>📦 Gastos</span>
              <strong style={{ color: 'var(--accent-red)' }}>{formatCurrency(expenseData.total, 'UYU')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderBottom: '1px solid var(--border)' }}>
              <span>💸 Ganancia real</span>
              <strong style={{ color: netProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{formatCurrency(netProfit, 'UYU')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8 }}>
              <span>📊 Margen</span>
              <strong>{profitMargin.toFixed(1)}%</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de gastos del período */}
      {expenseData.items.length > 0 && (
        <div className="expenses-list-section" style={{ marginTop: 24 }}>
          <h3>📝 Gastos del {targetMonth !== null ? `mes` : `año`}</h3>
          <div className="expenses-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {expenseData.items.map(expense => (
              <div key={expense.id} className="expense-item" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 12, background: 'var(--bg-tertiary)', borderRadius: 12,
                border: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="expense-category" style={{
                    color: CATEGORY_COLORS[expense.category] ?? '#6b7280',
                    fontWeight: 600, fontSize: 12
                  }}>
                    {expense.category}
                  </span>
                  <span className="expense-desc" style={{ fontSize: 13 }}>{expense.description}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    📅 {parseLocalDate(expense.date)?.toLocaleDateString() || expense.date}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="expense-amount" style={{ fontWeight: 700, color: 'var(--accent-red)' }}>
                    {formatCurrency(expense.amount, 'UYU')}
                  </span>
                  <button
                    onClick={() => handleDeleteExpense(expense.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-tertiary)' }}
                    title="Eliminar gasto"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal agregar gasto */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💰 Registrar Gasto</h3>
              <button className="modal-close" onClick={() => setShowExpenseModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Monto (UYU) *</label>
                <input
                  type="number" autoFocus placeholder="Ej: 1500" min="0" step="100"
                  value={newExpense.amount}
                  onChange={e => setNewExpense(p => ({ ...p, amount: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Categoría *</label>
                <select
                  value={newExpense.category}
                  onChange={e => setNewExpense(p => ({ ...p, category: e.target.value }))}
                >
                  <option value="">Seleccionar categoría</option>
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Fecha</label>
                <input
                  type="date"
                  value={newExpense.date}
                  max={todayKey()}
                  onChange={e => setNewExpense(p => ({ ...p, date: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Descripción (opcional)</label>
                <input
                  type="text" maxLength={100} placeholder="Ej: Compra de insumos"
                  value={newExpense.description}
                  onChange={e => setNewExpense(p => ({ ...p, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowExpenseModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={handleAddExpense}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}

export default FinancialScreen