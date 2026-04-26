import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency } from '../../utils/helpers'
import { useToast } from '../../contexts/ToastContext'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PAID_STATUSES = new Set(['completed', 'delivered', 'picked'])

const CATEGORIES = ['Materiales','Transporte','Servicios','Publicidad','Alquiler','Salarios','Otros']

const CATEGORY_COLORS = {
  Materiales: '#6366f1',
  Transporte: '#f59e0b',
  Servicios:  '#10b981',
  Publicidad: '#ef4444',
  Alquiler:   '#8b5cf6',
  Salarios:   '#ec4899',
  Otros:      '#6b7280',
}

const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MONTH_NAMES_LONG  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                            'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getRevenueDate(a) {
  return a.deliveredAt || a.paymentDate || a.startTime
}

function pctChange(current, prev) {
  if (prev === 0) return 0
  return ((current - prev) / Math.abs(prev)) * 100
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
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
      borderRadius: 12, padding: 12,
    }}>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>{label}</p>
      {payload.map((item, i) => (
        <p key={i} style={{ color: item.color, margin: '4px 0', fontSize: 13 }}>
          {item.name}: {formatCurrency(item.value, 'UYU')}
        </p>
      ))}
    </div>
  )
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function FinancialScreen({ nav, appointments, expenses = [], setExpenses }) {
  const focusRef = useScreenFocus()
  const toast    = useToast()

  const [selectedMonth,     setSelectedMonth]     = useState(null)   // { month, year } | null = mes actual
  const [showExpenseModal,  setShowExpenseModal]  = useState(false)
  const [chartView,         setChartView]         = useState('bar')
  const [newExpense,        setNewExpense]         = useState({
    amount: '', category: '', description: '',
    date: new Date().toISOString().split('T')[0],
  })

  // ── Fecha de referencia (memoizada) ───────────────────────────────────────
  const now = useMemo(() => new Date(), [])
  const currentMonth = now.getMonth()
  const currentYear  = now.getFullYear()

  const targetMonth = selectedMonth?.month ?? currentMonth
  const targetYear  = selectedMonth?.year  ?? currentYear

  const currentMonthName = selectedMonth
    ? `${MONTH_NAMES_LONG[selectedMonth.month]} ${selectedMonth.year}`
    : `${MONTH_NAMES_LONG[currentMonth]} ${currentYear}`

  // ── Navegación de mes ─────────────────────────────────────────────────────
  const goToPrevMonth = useCallback(() => {
    const base  = selectedMonth ?? { month: currentMonth, year: currentYear }
    const month = base.month === 0 ? 11 : base.month - 1
    const year  = base.month === 0 ? base.year - 1 : base.year
    setSelectedMonth({ month, year })
  }, [selectedMonth, currentMonth, currentYear])

  const goToNextMonth = useCallback(() => {
    const base = selectedMonth ?? { month: currentMonth, year: currentYear }
    // No avanzar más allá del mes actual
    if (base.year === currentYear && base.month === currentMonth) return
    const month = base.month === 11 ? 0  : base.month + 1
    const year  = base.month === 11 ? base.year + 1 : base.year
    // Guardar null si volvemos al mes actual
    const isNow = month === currentMonth && year === currentYear
    setSelectedMonth(isNow ? null : { month, year })
  }, [selectedMonth, currentMonth, currentYear])

  const isAtCurrentMonth = !selectedMonth ||
    (selectedMonth.month === currentMonth && selectedMonth.year === currentYear)

  // ── Ingresos del mes seleccionado ─────────────────────────────────────────
  const revenueData = useMemo(() => {
    const filtered = appointments.filter(a => {
    const d = new Date(getRevenueDate(a))
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear
        && PAID_STATUSES.has(a.status)
    })
    const total   = filtered.reduce((s, a) => s + (a.price || 0), 0)
    const paid    = filtered.filter(a => a.paid).reduce((s, a) => s + (a.price || 0), 0)
    return { total, paid, pending: total - paid, count: filtered.length }
  }, [appointments, targetMonth, targetYear])

  // ── Gastos del mes seleccionado ───────────────────────────────────────────
  const expenseData = useMemo(() => {
    const filtered = expenses.filter(e => {
      const d = new Date(e.date)
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear
    })
    const total = filtered.reduce((s, e) => s + (e.amount || 0), 0)
    const byCategory = filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + (e.amount || 0)
      return acc
    }, {})
    return { total, byCategory, count: filtered.length, items: filtered }
  }, [expenses, targetMonth, targetYear])

  const netProfit = revenueData.total - expenseData.total

  // ── Variación vs mes anterior ─────────────────────────────────────────────
  const previousMonthData = useMemo(() => {
    const pm = targetMonth === 0 ? 11 : targetMonth - 1
    const py = targetMonth === 0 ? targetYear - 1 : targetYear

    const prevRevenue = appointments
      .filter(a => {
      const d = new Date(getRevenueDate(a))
return d.getMonth() === pm && d.getFullYear() === py&& PAID_STATUSES.has(a.status)
      })
      .reduce((s, a) => s + (a.price || 0), 0)

    const prevExpenses = expenses
      .filter(e => {
        const d = new Date(e.date)
        return d.getMonth() === pm && d.getFullYear() === py
      })
      .reduce((s, e) => s + (e.amount || 0), 0)

    const prevProfit = prevRevenue - prevExpenses

    return {
      revenueChange: pctChange(revenueData.total, prevRevenue),
      expenseChange: pctChange(expenseData.total, prevExpenses),
      profitChange:  pctChange(netProfit,         prevProfit),
    }
  }, [appointments, expenses, revenueData.total, expenseData.total, netProfit, targetMonth, targetYear])

  // ── Gráfico de categorías ─────────────────────────────────────────────────
  const categoryChartData = useMemo(() =>
    Object.entries(expenseData.byCategory).map(([name, value]) => ({
      name, value, color: CATEGORY_COLORS[name] ?? '#6b7280',
    })),
  [expenseData.byCategory])

  // ── Comparativa 6 meses ───────────────────────────────────────────────────
  const monthlyChartData = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - (5 - i))
      const m = d.getMonth(), y = d.getFullYear()

      const revenue = appointments
        .filter(a => {
    const ad = new Date(getRevenueDate(a))
          return ad.getMonth() === m && ad.getFullYear() === y && PAID_STATUSES.has(a.status)
        })
        .reduce((s, a) => s + (a.price || 0), 0)

      const expense = expenses
        .filter(e => {
          const ed = new Date(e.date)
          return ed.getMonth() === m && ed.getFullYear() === y
        })
        .reduce((s, e) => s + (e.amount || 0), 0)

      return { name: MONTH_NAMES_SHORT[m], ingresos: revenue, gastos: expense, ganancia: revenue - expense }
    }),
  [appointments, expenses])

  // ── Últimos 7 días ────────────────────────────────────────────────────────
  const weeklyData = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const dateStr = d.toISOString().split('T')[0]

      const revenue = appointments
        .filter(a => (getRevenueDate(a) || '').startsWith(dateStr) && PAID_STATUSES.has(a.status))

        .reduce((s, a) => s + (a.price || 0), 0)

      const expense = expenses
        .filter(e => e.date === dateStr)
        .reduce((s, e) => s + (e.amount || 0), 0)

      return {
        name:     d.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3),
        ingresos: revenue,
        gastos:   expense,
      }
    }),
  [appointments, expenses])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddExpense = useCallback(() => {
    const amount = parseFloat(newExpense.amount)
    if (!amount || amount <= 0) { toast.addToast('❌ Ingresá un monto válido', 'error'); return }
    if (amount > 1_000_000)       toast.addToast('⚠️ El monto parece muy alto', 'warning')
    if (!newExpense.category)    { toast.addToast('❌ Seleccioná una categoría', 'error'); return }

    const expense = {
      id:          `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount,
      category:    newExpense.category,
      description: newExpense.description || 'Sin descripción',
      date:        newExpense.date,
    }

    setExpenses?.(prev => [...prev, expense])
    toast.addToast('✅ Gasto registrado', 'success')
    setShowExpenseModal(false)
    setNewExpense({ amount:'', category:'', description:'', date: new Date().toISOString().split('T')[0] })
  }, [newExpense, setExpenses, toast])

  const handleExportReport = useCallback(() => {
    const report = {
      fecha:        new Date().toISOString(),
      ingresos:     revenueData,
      gastos:       expenseData,
      ganancia:     netProfit,
      citas:        appointments.length,
      gastosDetalle:expenseData.items,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' })
    downloadBlob(blob, `reporte-financiero-${new Date().toISOString().split('T')[0]}.json`)
    toast.addToast('📁 Reporte exportado', 'success')
  }, [revenueData, expenseData, netProfit, appointments.length, toast])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const fmtChange = (val) => `${val > 0 ? '↑' : val < 0 ? '↓' : '='} ${Math.abs(val).toFixed(1)}% vs mes anterior`

  return (
    <div ref={focusRef} tabIndex={-1} className="financial-screen">

      {/* Header */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">Panel Financiero</h2>
        <div className="top-bar-actions">
          <button className="icon-btn"                                      onClick={handleExportReport} title="Exportar reporte">📄</button>
          <button className={`icon-btn ${chartView==='bar'  ? 'active':''}`} onClick={() => setChartView('bar')}  title="Barras">📊</button>
          <button className={`icon-btn ${chartView==='area' ? 'active':''}`} onClick={() => setChartView('area')} title="Área">📈</button>
        </div>
      </div>

      <div className="current-date">
        {now.toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
      </div>

      {/* Selector de mes */}
      <div className="month-selector">
        <button onClick={goToPrevMonth}>←</button>
        <span className="current-month">{currentMonthName}</span>
        <button onClick={goToNextMonth} disabled={isAtCurrentMonth} style={{ opacity: isAtCurrentMonth ? .4 : 1 }}>→</button>
        {!isAtCurrentMonth && (
          <button className="reset-month" onClick={() => setSelectedMonth(null)}>Mes actual</button>
        )}
      </div>

      {/* Agregar gasto */}
      <div className="add-expense-container">
        <button className="add-expense-btn" onClick={() => setShowExpenseModal(true)}>
          + Registrar Gasto
        </button>
      </div>

      {/* KPIs */}
      <div className="stats-grid">
        <div className="stat-card revenue">
          <span className="stat-value">{formatCurrency(revenueData.total, 'UYU')}</span>
          <span className="stat-label">Ingresos</span>
          <span className={`stat-change ${previousMonthData.revenueChange >= 0 ? 'positive':'negative'}`}>
            {fmtChange(previousMonthData.revenueChange)}
          </span>
        </div>

        <div className="stat-card expense">
          <span className="stat-value">{formatCurrency(expenseData.total, 'UYU')}</span>
          <span className="stat-label">Gastos</span>
          <span className={`stat-change ${previousMonthData.expenseChange <= 0 ? 'positive':'negative'}`}>
            {fmtChange(previousMonthData.expenseChange)}
          </span>
        </div>

        <div className={`stat-card ${netProfit >= 0 ? 'profit':'loss'}`}>
          <span className="stat-value">{formatCurrency(netProfit, 'UYU')}</span>
          <span className="stat-label">Ganancia neta</span>
          <span className={`stat-change ${previousMonthData.profitChange >= 0 ? 'positive':'negative'}`}>
            {fmtChange(previousMonthData.profitChange)}
          </span>
        </div>
      </div>

      {/* Gráfico principal */}
      <div className="chart-section">
        <h3 className="chart-title">📊 Ingresos vs Gastos — Últimos 6 meses</h3>
        <ResponsiveContainer width="100%" height={280}>
          {chartView === 'bar' ? (
            <BarChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
              <YAxis stroke="var(--text-tertiary)" fontSize={12} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="ingresos" name="Ingresos" fill="#10b981" radius={[8,8,0,0]} />
              <Bar dataKey="gastos"   name="Gastos"   fill="#ef4444" radius={[8,8,0,0]} />
            </BarChart>
          ) : (
            <AreaChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
              <YAxis stroke="var(--text-tertiary)" fontSize={12} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10b981" fill="#10b98133" />
              <Area type="monotone" dataKey="gastos"   name="Gastos"   stroke="#ef4444" fill="#ef444433" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Categorías + 7 días */}
      <div className="charts-row">
        <div className="chart-section half">
          <h3 className="chart-title">🥧 Gastos por categoría</h3>
          {categoryChartData.length === 0 ? (
            <div className="empty-chart"><span>📊</span><p>Sin gastos este mes</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                  {categoryChartData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-section half">
          <h3 className="chart-title">📈 Últimos 7 días</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={11} />
              <YAxis stroke="var(--text-tertiary)" fontSize={11} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="ingresos" name="Ingresos" stroke="#6366f1" fill="#6366f133" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Resumen */}
      <div className="summary-section">
        <h3 className="summary-title">📋 Resumen de {currentMonthName}</h3>
        <div className="summary-grid">
          {[
            { label:'Total ingresos',        value: formatCurrency(revenueData.total, 'UYU'),   cls:'revenue' },
            { label:'Total gastos',           value: formatCurrency(expenseData.total, 'UYU'),   cls:'expense' },
            { label:'Balance',                value: formatCurrency(netProfit, 'UYU'),            cls: netProfit >= 0 ? 'positive':'negative' },
            { label:'Margen',                 value: revenueData.total === 0 ? '0%' : `${((netProfit/revenueData.total)*100).toFixed(1)}%` },
            { label:'Pedidos completados',    value: revenueData.count },
            { label:'Gastos registrados',     value: expenseData.count },
            { label:'Pendiente de cobro',     value: formatCurrency(revenueData.pending, 'UYU'), cls:'warning' },
            { label:'Ticket promedio',        value: revenueData.count === 0 ? '$0' : formatCurrency(revenueData.total/revenueData.count,'UYU') },
          ].map(({ label, value, cls }) => (
            <div key={label} className="summary-item">
              <span>{label}</span>
              <span className={cls}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gastos del mes */}
      {expenseData.items.length > 0 && (
        <div className="expenses-list-section">
          <h3>📝 Gastos del mes</h3>
          <div className="expenses-list">
            {expenseData.items.slice(0, 5).map(expense => (
              <div key={expense.id} className="expense-item">
                <div>
                  <span className="expense-category" style={{ color: CATEGORY_COLORS[expense.category] ?? '#6b7280' }}>
                    {expense.category}
                  </span>
                  <span className="expense-desc">{expense.description}</span>
                </div>
                <span className="expense-amount">{formatCurrency(expense.amount, 'UYU')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal agregar gasto */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>💰 Registrar Gasto</h3>

            <div className="form-group">
              <label>Monto (UYU)</label>
              <input
                type="number" autoFocus placeholder="Ej: 1500" min="0" step="100"
                value={newExpense.amount}
                onChange={e => setNewExpense(p => ({ ...p, amount: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Categoría</label>
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
                max={new Date().toISOString().split('T')[0]}
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

            <div className="modal-buttons">
              <button className="btn-cancel" onClick={() => setShowExpenseModal(false)}>Cancelar</button>
              <button className="btn-save"   onClick={handleAddExpense}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}

export default FinancialScreen