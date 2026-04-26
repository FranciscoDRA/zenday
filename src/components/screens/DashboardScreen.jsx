import React, { useMemo, useState, useCallback } from 'react'
import { AppointmentCard } from '../common/AppointmentCard'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency } from '../../utils/helpers'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { exportFinancialToPDF, exportAppointmentsToExcel } from '../../utils/exportImport'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PAID_STATUSES   = new Set(['completed', 'delivered', 'picked'])
const MONTH_NAMES     = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const CHART_TITLES    = {
  '7days':   '📅 Ingresos últimos 7 días',
  '30days':  '📅 Ingresos últimos 30 días',
  '6months': '📊 Ingresos vs Gastos — Últimos 6 meses',
}

// ─── CORREGIDO: Fecha efectiva para reportes financieros ──────────────────────
function getRevenueDate(appointment) {
  // Prioridad: deliveredAt (fecha de entrega) > paymentDate > startTime
  return appointment.deliveredAt || appointment.paymentDate || appointment.startTime
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function pct(current, prev) {
  if (prev === 0) return 0
  return ((current - prev) / Math.abs(prev) * 100).toFixed(1)
}

function isInMonth(isoString, month, year) {
  if (!isoString) return false
  const d = new Date(isoString)
  return !isNaN(d.getTime()) && d.getMonth() === month && d.getFullYear() === year
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    }}>
      <p style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>{label}</p>
      {payload.map((item, i) => (
        <p key={i} style={{ color: item.color, margin: '4px 0', fontSize: 13 }}>
          {item.name}: {formatCurrency(item.value, 'UYU')}
        </p>
      ))}
      {payload.length >= 2 && (
        <p style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 13,
          color: payload[0].value - payload[1].value >= 0 ? '#10b981' : '#ef4444',
        }}>
          Balance: {formatCurrency(payload[0].value - payload[1].value, 'UYU')}
        </p>
      )}
    </div>
  )
}

const NoDataChart = ({ message = 'No hay datos para mostrar' }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: 240, color: 'var(--text-tertiary)',
  }}>
    <span style={{ fontSize: 40, marginBottom: 12, opacity: .3 }}>📊</span>
    <p style={{ fontSize: 13 }}>{message}</p>
  </div>
)

// ─── DASHBOARD EMPRENDEDOR ────────────────────────────────────────────────────

function EntrepreneurDashboard({
  nav, appointments, products = [], patients = [], expenses = [],
  todayAppointments, updateStatus, markAsPaid, userMode,
}) {
  const focusRef = useScreenFocus()

  const [chartPeriod,  setChartPeriod]  = useState('6months')
  const [monthlyGoal,  setMonthlyGoal]  = useState(() => {
    const s = localStorage.getItem('zenday-monthly-goal')
    return s ? parseInt(s, 10) : 100_000
  })
  const [showGoalEdit, setShowGoalEdit] = useState(false)
  const [tempGoal,     setTempGoal]     = useState(monthlyGoal)

  // ── Fechas ────────────────────────────────────────────────────────────────
  const { currentMonth, currentYear, prevMonth, prevYear } = useMemo(() => {
    const now = new Date()
    const cm = now.getMonth(), cy = now.getFullYear()
    return { 
      currentMonth: cm, 
      currentYear: cy,
      prevMonth: cm === 0 ? 11 : cm - 1, 
      prevYear: cm === 0 ? cy - 1 : cy 
    }
  }, [])

  // ── Pedidos del Kanban ────────────────────────────────────────────────────
  const pedidos = useMemo(() => {
    try {
      const saved = localStorage.getItem('zenday-emprendedor-pedidos')
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed.filter(p => p?.id && p.estado !== 'ENTREGADO') : []
    } catch { return [] }
  }, [])

  const pedidosByEstado = useMemo(() => ({
    PENDIENTE:  pedidos.filter(p => p.estado === 'PENDIENTE').length,
    EN_PROCESO: pedidos.filter(p => p.estado === 'EN_PROCESO').length,
    COMPLETADO: pedidos.filter(p => p.estado === 'COMPLETADO').length,
  }), [pedidos])

  // ── Stock ─────────────────────────────────────────────────────────────────
  const stockAlerts = useMemo(() => ({
    out: products.filter(p => (p.stock || 0) === 0),
    low: products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 5),
  }), [products])

  // ── Cobros pendientes ─────────────────────────────────────────────────────
  const pendingPayments = useMemo(() => {
    const list = appointments.filter(a => PAID_STATUSES.has(a.status) && !a.paid)
    return { count: list.length, total: list.reduce((s, a) => s + (a.price || 0), 0) }
  }, [appointments])

  // ── CORREGIDO: Financieros con getRevenueDate ─────────────────────────────────
  const currentMonthIncome = useMemo(() =>
    appointments.filter(a => {
      const revenueDate = getRevenueDate(a)
      return isInMonth(revenueDate, currentMonth, currentYear) && PAID_STATUSES.has(a.status)
    }).reduce((s, a) => s + (a.price || 0), 0),
  [appointments, currentMonth, currentYear])

  const prevMonthIncome = useMemo(() =>
    appointments.filter(a => {
      const revenueDate = getRevenueDate(a)
      return isInMonth(revenueDate, prevMonth, prevYear) && PAID_STATUSES.has(a.status)
    }).reduce((s, a) => s + (a.price || 0), 0),
  [appointments, prevMonth, prevYear])

  const currentMonthExpenses = useMemo(() =>
    expenses.filter(e => isInMonth(e.date, currentMonth, currentYear))
      .reduce((s, e) => s + (e.amount || 0), 0),
  [expenses, currentMonth, currentYear])

  const prevMonthExpenses = useMemo(() =>
    expenses.filter(e => isInMonth(e.date, prevMonth, prevYear))
      .reduce((s, e) => s + (e.amount || 0), 0),
  [expenses, prevMonth, prevYear])

  const currentMonthProfit = currentMonthIncome - currentMonthExpenses
  const prevMonthProfit    = prevMonthIncome    - prevMonthExpenses
  const incomeVariation    = pct(currentMonthIncome,   prevMonthIncome)
  const expensesVariation  = pct(currentMonthExpenses, prevMonthExpenses)
  const profitVariation    = pct(currentMonthProfit,   prevMonthProfit)
  const goalProgress       = monthlyGoal > 0 ? (currentMonthIncome / monthlyGoal) * 100 : 0

  // ── CORREGIDO: Top productos del mes con getRevenueDate ────────────────────
  const topProducts = useMemo(() => {
    const map = {}
    appointments
      .filter(a => {
        const revenueDate = getRevenueDate(a)
        return isInMonth(revenueDate, currentMonth, currentYear) && PAID_STATUSES.has(a.status)
      })
      .forEach(a => {
        const name = a.productName || 'Sin nombre'
        if (!map[name]) map[name] = { name, qty: 0, revenue: 0 }
        map[name].qty++
        map[name].revenue += a.price || 0
      })
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5)
  }, [appointments, currentMonth, currentYear])

  // ── CORREGIDO: Gráficos con getRevenueDate ────────────────────────────────
  const last6MonthsData = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i))
      const m = d.getMonth(), y = d.getFullYear()
      const income = appointments.filter(a => {
        const revenueDate = getRevenueDate(a)
        return isInMonth(revenueDate, m, y) && PAID_STATUSES.has(a.status)
      }).reduce((s, a) => s + (a.price || 0), 0)
      const expense = expenses.filter(e => isInMonth(e.date, m, y)).reduce((s, e) => s + (e.amount || 0), 0)
      return { name: MONTH_NAMES[m], ingresos: income, gastos: expense }
    }), [appointments, expenses])

  const last7DaysData = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i))
      const dateStr = d.toISOString().split('T')[0]
      const income = appointments.filter(a => {
        const revenueDate = getRevenueDate(a)
        return revenueDate?.startsWith(dateStr) && PAID_STATUSES.has(a.status)
      }).reduce((s, a) => s + (a.price || 0), 0)
      return { name: d.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3), ingresos: income }
    }), [appointments])

  const last30DaysData = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - i))
      const dateStr = d.toISOString().split('T')[0]
      const income = appointments.filter(a => {
        const revenueDate = getRevenueDate(a)
        return revenueDate?.startsWith(dateStr) && PAID_STATUSES.has(a.status)
      }).reduce((s, a) => s + (a.price || 0), 0)
      return { name: `${d.getDate()}/${d.getMonth() + 1}`, ingresos: income }
    }), [appointments])

  const chartData = { '7days': last7DaysData, '30days': last30DaysData, '6months': last6MonthsData }[chartPeriod] ?? last6MonthsData
  const hasNoData = chartPeriod === '6months'
    ? last6MonthsData.every(m => m.ingresos === 0 && m.gastos === 0)
    : chartData.every(d => d.ingresos === 0)

  const handleSaveGoal = useCallback(() => {
    const n = parseInt(tempGoal, 10) || 0
    setMonthlyGoal(n)
    localStorage.setItem('zenday-monthly-goal', n.toString())
    setShowGoalEdit(false)
  }, [tempGoal])

  const handleExportPDF   = useCallback(() => exportFinancialToPDF(appointments, 'month'), [appointments])
  const handleExportExcel = useCallback(() => exportAppointmentsToExcel(appointments), [appointments])

  return (
    <div ref={focusRef} tabIndex={-1} className="dashboard-screen-premium">

      {/* Header */}
      <div className="dashboard-header-premium">
        <div>
          <h1>Panel de Control</h1>
          <p className="dashboard-date">
            {new Date().toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
          </p>
        </div>
        <div className="export-actions">
          <button className="btn-export" onClick={handleExportPDF}>📄 PDF</button>
          <button className="btn-export" onClick={handleExportExcel}>📊 Excel</button>
        </div>
      </div>

      {/* ── KPIs financieros ──────────────────────────────────────────────── */}
      <div className="kpi-grid financial-comparison">
        <div className="kpi-card income">
          <span className="kpi-icon">📈</span>
          <div className="kpi-content">
            <span className="kpi-value">{formatCurrency(currentMonthIncome, 'UYU')}</span>
            <span className="kpi-label">Ingresos del mes</span>
            <span className={`kpi-variation ${incomeVariation >= 0 ? 'positive' : 'negative'}`}>
              {incomeVariation > 0 ? '↑' : '↓'} {Math.abs(incomeVariation)}% vs anterior
            </span>
          </div>
        </div>

        <div className="kpi-card expenses">
          <span className="kpi-icon">📉</span>
          <div className="kpi-content">
            <span className="kpi-value">{formatCurrency(currentMonthExpenses, 'UYU')}</span>
            <span className="kpi-label">Gastos del mes</span>
            <span className={`kpi-variation ${Number(expensesVariation) <= 0 ? 'positive' : 'negative'}`}>
              {expensesVariation > 0 ? '↑' : '↓'} {Math.abs(expensesVariation)}% vs anterior
            </span>
          </div>
        </div>

        <div className={`kpi-card ${currentMonthProfit >= 0 ? 'profit' : 'loss'}`}>
          <span className="kpi-icon">{currentMonthProfit >= 0 ? '💰' : '⚠️'}</span>
          <div className="kpi-content">
            <span className="kpi-value">{formatCurrency(currentMonthProfit, 'UYU')}</span>
            <span className="kpi-label">Ganancia neta</span>
            <span className={`kpi-variation ${profitVariation >= 0 ? 'positive' : 'negative'}`}>
              {profitVariation > 0 ? '↑' : '↓'} {Math.abs(profitVariation)}% vs anterior
            </span>
          </div>
        </div>

        <div className="kpi-card warning" style={{ cursor:'pointer' }} onClick={() => nav.navigate('pending')}>
          <span className="kpi-icon">⏳</span>
          <div className="kpi-content">
            <span className="kpi-value">{formatCurrency(pendingPayments.total, 'UYU')}</span>
            <span className="kpi-label">Pendiente de cobro</span>
            <span className="kpi-subtext">{pendingPayments.count} pedido{pendingPayments.count !== 1 ? 's' : ''} sin cobrar →</span>
          </div>
        </div>
      </div>

      {/* ── Objetivo + Pedidos activos + Stock ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>

        {/* Objetivo mensual */}
        <div className="dash-card goal-card">
          <div className="goal-header">
            <h4>🎯 Objetivo del mes</h4>
            {!showGoalEdit ? (
              <button className="edit-goal-btn" onClick={() => { setTempGoal(monthlyGoal); setShowGoalEdit(true) }}>✏️</button>
            ) : (
              <div className="goal-edit-controls">
                <input type="number" autoFocus min="0" step="1000" value={tempGoal}
                  onChange={e => setTempGoal(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveGoal()}
                />
                <button onClick={handleSaveGoal}>✓</button>
                <button onClick={() => setShowGoalEdit(false)}>✕</button>
              </div>
            )}
          </div>
          <div className="goal-progress-container">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{
                width: `${Math.min(goalProgress, 100)}%`,
                background: goalProgress >= 100 ? '#10b981' : goalProgress >= 70 ? '#6366f1' : '#f59e0b',
              }} />
            </div>
            <div className="goal-stats">
              <span>{formatCurrency(currentMonthIncome, 'UYU')}</span>
              <span>{formatCurrency(monthlyGoal, 'UYU')}</span>
            </div>
          </div>
          <p className="goal-percentage">
            {goalProgress >= 100 ? '🎉 ¡Meta cumplida!' : `${goalProgress.toFixed(1)}% completado`}
          </p>
        </div>

        {/* Pedidos activos del Kanban */}
        <div className="dash-card" style={{ cursor: 'pointer' }} onClick={() => nav.navigate('emprendedor')}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>📦 Pedidos activos</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { key: 'pendientes', label: '⏳ Pendientes',  count: pedidosByEstado.PENDIENTE,  color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
              { key: 'enproceso',  label: '🔨 En proceso',  count: pedidosByEstado.EN_PROCESO, color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
              { key: 'listos',     label: '✅ Listos',      count: pedidosByEstado.COMPLETADO, color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
            ].map(({ key, label, count, color, bg }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 10, background: bg }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color }}>{count}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--accent-blue)', marginTop: 10, textAlign: 'right' }}>
            Ver panel de producción →
          </p>
        </div>

        {/* Alertas de stock */}
        <div className="dash-card">
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>🏪 Estado del inventario</h4>
          {stockAlerts.out.length === 0 && stockAlerts.low.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '16px 0', color: '#10b981' }}>
              <span style={{ fontSize: 28, marginBottom: 6 }}>✅</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Todo el stock en orden</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stockAlerts.out.slice(0, 3).map((p, i) => (
                <div key={`out-${String(p.id)}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', maxWidth: '65%' }}>{p.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444',
                    background: 'rgba(239,68,68,0.15)', padding: '2px 8px', borderRadius: 20 }}>AGOTADO</span>
                </div>
              ))}
              {stockAlerts.low.slice(0, 3).map((p, i) => (
                <div key={`low-${String(p.id)}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', maxWidth: '65%' }}>{p.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b',
                    background: 'rgba(245,158,11,0.15)', padding: '2px 8px', borderRadius: 20 }}>{p.stock} uds</span>
                </div>
              ))}
              {(stockAlerts.out.length + stockAlerts.low.length) > 6 && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 2 }}>
                  +{stockAlerts.out.length + stockAlerts.low.length - 6} más
                </p>
              )}
            </div>
          )}
          <button onClick={() => nav.navigate('products')}
            style={{ marginTop: 10, width: '100%', padding: '7px', background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: 12,
              color: 'var(--accent-blue)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Ver inventario completo →
          </button>
        </div>
      </div>

      {/* ── Gráfico + Top productos ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 16 }}>

        {/* Gráfico */}
        <div className="chart-card large">
          <div className="chart-header">
            <h3>{CHART_TITLES[chartPeriod]}</h3>
            <select className="period-selector" value={chartPeriod} onChange={e => setChartPeriod(e.target.value)}>
              <option value="7days">7 días</option>
              <option value="30days">30 días</option>
              <option value="6months">6 meses</option>
            </select>
          </div>
          {hasNoData ? <NoDataChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              {chartPeriod === '6months' ? (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={11} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={11} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="ingresos" name="Ingresos" fill="#10b981" radius={[6,6,0,0]} />
                  <Bar dataKey="gastos"   name="Gastos"   fill="#ef4444" radius={[6,6,0,0]} />
                </BarChart>
              ) : (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorIncome2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={11} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={11} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="ingresos" name="Ingresos"
                    stroke="#6366f1" fill="url(#colorIncome2)" strokeWidth={2} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          )}
        </div>

        {/* Top productos */}
        <div className="dash-card">
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
            🏆 Top productos este mes
          </h4>
          {topProducts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-tertiary)' }}>
              <span style={{ fontSize: 28, display: 'block', marginBottom: 6, opacity: .3 }}>📦</span>
              <span style={{ fontSize: 13 }}>Sin ventas este mes</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topProducts.map((p, i) => {
                const maxQty = topProducts[0].qty
                const barW   = (p.qty / maxQty) * 100
                const medals = ['🥇','🥈','🥉']
                const barColors = ['#f59e0b','#94a3b8','#f97316','#6366f1','#10b981']
                return (
                  <div key={`top-${p.name}-${i}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                        {medals[i] || `#${i+1}`} {p.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {p.qty} venta{p.qty !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barW}%`, borderRadius: 3,
                        background: barColors[i] || '#6366f1', transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#10b981', textAlign: 'right', marginTop: 1 }}>
                      {formatCurrency(p.revenue, 'UYU')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Cobros pendientes clickeables ─────────────────────────────────── */}
      {pendingPayments.count > 0 && (
        <div className="section-header-premium">
          <h3>💳 Cobros pendientes ({pendingPayments.count})</h3>
          <button className="section-link" onClick={() => nav.navigate('pending')}>Ver todos →</button>
        </div>
      )}
      {pendingPayments.count > 0 && (
        <div className="appointments-list-premium" style={{ marginBottom: 16 }}>
          {appointments
            .filter(a => PAID_STATUSES.has(a.status) && !a.paid)
            .slice(0, 5)
            .map((apt, i) => (
              <AppointmentCard
                key={`pend-${apt.id}-${i}`}
                appointment={apt}
                nav={nav}
                compact
                userMode={userMode}
                onStatusChange={s => updateStatus(apt.id, s)}
                onMarkAsPaid={() => markAsPaid(apt.id)}
              />
            ))}
        </div>
      )}

      {/* ── Pedidos de hoy ───────────────────────────────────────────────── */}
      <div className="section-header-premium">
        <h3>📋 Pedidos de hoy</h3>
        <button className="section-link" onClick={() => nav.navigate('agenda')}>Ver agenda →</button>
      </div>
      <div className="appointments-list-premium">
        {todayAppointments.length === 0 ? (
          <div className="empty-state-premium"><span>📅</span><p>No hay pedidos para hoy</p></div>
        ) : todayAppointments.map((apt, i) => (
          <AppointmentCard
            key={`today-${apt.id}-${i}`}
            appointment={apt}
            nav={nav}
            compact
            userMode={userMode}
            onStatusChange={s => updateStatus(apt.id, s)}
            onMarkAsPaid={() => markAsPaid(apt.id)}
          />
        ))}
      </div>

      {/* ── Acciones rápidas ──────────────────────────────────────────────── */}
      <div className="quick-actions-premium">
        <button className="btn-primary-premium"   onClick={() => nav.navigate('emprendedor')}>📦 Panel producción</button>
        <button className="btn-secondary-premium" onClick={() => nav.navigate('new')}>+ Nuevo pedido</button>
        <button className="btn-secondary-premium" onClick={() => nav.navigate('pending')}>💰 Cobros pendientes</button>
        <button className="btn-secondary-premium" onClick={() => nav.navigate('expenses')}>📝 Registrar gasto</button>
      </div>
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export function DashboardScreen({
  nav, stats, todayAppointments,
  updateStatus, markAsPaid,
  userMode, appointments, patients, expenses, products,
}) {
  const focusRef       = useScreenFocus()
  const isEntrepreneur = userMode === 'entrepreneur' || userMode === 'merchant'

  if (isEntrepreneur) {
    return (
      <EntrepreneurDashboard
        nav={nav}
        appointments={appointments || []}
        products={products || []}
        patients={patients || []}
        expenses={expenses || []}
        todayAppointments={todayAppointments || []}
        updateStatus={updateStatus}
        markAsPaid={markAsPaid}
        userMode={userMode}
      />
    )
  }

  // Modo profesional
  return (
    <div ref={focusRef} tabIndex={-1} className="dashboard-screen-premium">
      <div className="dashboard-header-premium">
        <div>
          <h1>Panel de Control</h1>
          <p className="dashboard-date">
            {new Date().toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        {[
          { key: 'consultas-hoy', cls:'primary', icon:'📊', value: stats.todayTotal,    label:'Consultas hoy' },
          { key: 'completadas',   cls:'success', icon:'✅', value: stats.todayCompleted, label:'Completadas' },
          { key: 'pendientes',    cls:'warning', icon:'⏳', value: stats.todayPending,   label:'Pendientes' },
          { key: 'pacientes',     cls:'info',    icon:'👥', value: stats.totalPatients,  label:'Pacientes' },
        ].map(k => (
          <div key={k.key} className={`kpi-card ${k.cls}`}>
            <span className="kpi-icon">{k.icon}</span>
            <div className="kpi-content">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-label">{k.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-header-premium">
        <h3>📋 Consultas de hoy</h3>
        <button className="section-link" onClick={() => nav.navigate('agenda')}>Ver agenda →</button>
      </div>

      <div className="appointments-list-premium">
        {todayAppointments.length === 0 ? (
          <div className="empty-state-premium"><span>📅</span><p>No hay consultas para hoy</p></div>
        ) : todayAppointments.map((apt, i) => (
          <AppointmentCard
            key={`consulta-${apt.id}-${i}`}
            appointment={apt}
            nav={nav}
            compact
            userMode={userMode}
            onStatusChange={s => updateStatus(apt.id, s)}
            onMarkAsPaid={() => markAsPaid(apt.id)}
          />
        ))}
      </div>

      <div className="quick-actions-premium">
        <button className="btn-primary-premium"   onClick={() => nav.navigate('new')}>+ Nueva consulta</button>
        <button className="btn-secondary-premium" onClick={() => nav.navigate('patients')}>👥 Gestionar pacientes</button>
        <button className="btn-secondary-premium" onClick={() => nav.navigate('financial')}>💰 Finanzas</button>
      </div>
    </div>
  )
}

export default DashboardScreen