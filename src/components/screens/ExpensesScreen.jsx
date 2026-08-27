import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency, newId, todayKey } from '../../utils/helpers'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Alquiler', 'Servicios', 'Materiales', 'Transporte',
  'Publicidad', 'Sueldos', 'Impuestos', 'Mantenimiento', 'Otros',
]

const CATEGORY_ICONS = {
  Alquiler:     '🏠',
  Servicios:    '💡',
  Materiales:   '📦',
  Transporte:   '🚗',
  Publicidad:   '📢',
  Sueldos:      '👥',
  Impuestos:    '📋',
  Mantenimiento:'🔧',
  Otros:        '💸',
}

// FIX: era una constante de módulo, así que `todayKey()` se evaluaba UNA vez al
// cargar la app y la fecha quedaba congelada. Dejando ZenDay abierta de un día
// para el otro, los gastos nuevos salían con la fecha de ayer.
const emptyForm = () => ({
  description: '',
  amount:      '',
  category:    'Otros',
  date:        todayKey(),
  notes:       '',
})

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Muestra una fecha "YYYY-MM-DD" en hora local sin bug de UTC */
function formatLocalDate(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-UY')
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function ExpensesScreen({ expenses, setExpenses, nav }) {
  const focusRef = useScreenFocus()
  const toast    = useToast()
  const { confirm }  = useConfirm()

  const [searchQuery,    setSearchQuery]    = useState('')
  const [showForm,       setShowForm]       = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [formData,       setFormData]       = useState(emptyForm)

  // ── Datos derivados ───────────────────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return expenses.filter(e => {
      const desc = (e.description || '').toLowerCase()   // guard null/undefined
      const cat  = (e.category    || '').toLowerCase()
      return desc.includes(q) || cat.includes(q)
    })
  }, [expenses, searchQuery])

  const totalExpenses = useMemo(() =>
    expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
  [expenses])

  const categoryTotals = useMemo(() => {
    const totals = {}
    expenses.forEach(e => {
      const cat = e.category || 'Otros'
      totals[cat] = (totals[cat] || 0) + (e.amount || 0)
    })
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  }, [expenses])

  // ── Abrir / cerrar form ───────────────────────────────────────────────────
  const openNewForm = useCallback(() => {
    setEditingExpense(null)
    setFormData(emptyForm())
    setShowForm(true)
  }, [])

  const openEditForm = useCallback((expense) => {
    setEditingExpense(expense)
    setFormData({
      description: expense.description || '',
      amount:      expense.amount?.toString() || '',
      category:    expense.category || 'Otros',
      date:        expense.date || todayKey(),
      notes:       expense.notes || '',
    })
    setShowForm(true)
  }, [])

  const closeForm = useCallback(() => {
    setShowForm(false)
    setEditingExpense(null)
    setFormData(emptyForm())
  }, [])

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!formData.description.trim()) {
      toast.addToast('La descripción es obligatoria', 'error')
      return
    }
    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount <= 0) {
      toast.addToast('El monto debe ser mayor a 0', 'error')
      return
    }

    if (editingExpense) {
      setExpenses(prev => prev.map(e =>
        e.id === editingExpense.id ? { ...e, ...formData, amount } : e
      ))
      toast.addToast('Gasto actualizado', 'success')
    } else {
      setExpenses(prev => [...prev, {
        id: newId(),
        ...formData,
        amount,
        createdAt: new Date().toISOString(),
      }])
      toast.addToast('Gasto registrado', 'success')
    }

    closeForm()
  }, [formData, editingExpense, setExpenses, toast, closeForm])

  // ── Eliminar ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (expense) => {
    if (!await confirm(`¿Eliminar gasto "${expense.description}"?`)) return
    setExpenses(prev => prev.filter(e => e.id !== expense.id))
    toast.addToast('Gasto eliminado', 'success')
  }, [confirm, setExpenses, toast])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="expenses-screen">

      {/* Top bar */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">💰 Gastos</h2>
        <button className="top-bar-action" onClick={openNewForm} aria-label="Nuevo gasto">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Resumen */}
      <div className="expenses-summary">
        <div className="summary-card">
          <span className="summary-icon">💰</span>
          <div className="summary-info">
            <span className="summary-label">Total gastos</span>
            <span className="summary-value">{formatCurrency(totalExpenses, 'UYU')}</span>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon">📊</span>
          <div className="summary-info">
            <span className="summary-label">Categorías usadas</span>
            <span className="summary-value">{categoryTotals.length}</span>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon">📅</span>
          <div className="summary-info">
            <span className="summary-label">Registros</span>
            <span className="summary-value">{expenses.length}</span>
          </div>
        </div>
      </div>

      {/* Desglose por categoría */}
      {categoryTotals.length > 0 && (
        <div className="category-breakdown">
          <h3>📊 Desglose por categoría</h3>
          <div className="category-list">
            {categoryTotals.map(([category, total]) => (
              <div key={category} className="category-item">
                <span className="category-name">
                  {CATEGORY_ICONS[category] ?? '💸'} {category}
                </span>
                <span className="category-amount">{formatCurrency(total, 'UYU')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="search-container">
        <div className="search-bar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Buscar gasto…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="expenses-list">
        {filteredExpenses.length === 0 ? (
          <div className="empty-state">
            <span className="empty-emoji">💰</span>
            <p className="empty-title">No hay gastos registrados</p>
            <p className="empty-subtitle">Registrá tus gastos para llevar un mejor control</p>
            <button className="btn-primary" onClick={openNewForm}>+ Registrar gasto</button>
          </div>
        ) : (
          filteredExpenses.map(expense => (
            <div key={expense.id} className="expense-card">
              <div className="expense-icon">
                {CATEGORY_ICONS[expense.category] ?? '💸'}
              </div>
              <div className="expense-info">
                <h4>{expense.description}</h4>
                <div className="expense-meta">
                  <span>📅 {formatLocalDate(expense.date)}</span>
                  <span>🏷️ {expense.category}</span>
                </div>
                {expense.notes && (
                  <div className="expense-notes">📝 {expense.notes}</div>
                )}
              </div>
              <div className="expense-amount">
                {formatCurrency(expense.amount, 'UYU')}
              </div>
              <div className="expense-actions">
                <button className="btn-icon-sm"        onClick={() => openEditForm(expense)} title="Editar">✏️</button>
                <button className="btn-icon-sm danger" onClick={() => handleDelete(expense)} title="Eliminar">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="modal-overlay-premium" onClick={closeForm}>
          <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
            <div className="modal-header-premium">
              <h2>{editingExpense ? '✏️ Editar gasto' : '➕ Nuevo gasto'}</h2>
              <button className="modal-close" onClick={closeForm}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group-premium">
                <label>Descripción *</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ej: Compra de materiales"
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="form-row-premium">
                <div className="form-group-premium">
                  <label>Monto (UYU) *</label>
                  <div className="input-with-prefix">
                    <span>$</span>
                    <input
                      type="number" placeholder="0" min="0" step="0.01"
                      value={formData.amount}
                      onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-group-premium">
                  <label>Categoría</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData(p => ({ ...p, category: e.target.value }))}
                  >
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group-premium">
                <label>Fecha</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                />
              </div>

              <div className="form-group-premium">
                <label>Notas (opcional)</label>
                <textarea
                  rows={3}
                  placeholder="Detalles adicionales…"
                  value={formData.notes}
                  onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer-premium">
              <button className="btn-secondary-premium" onClick={closeForm}>Cancelar</button>
              <button className="btn-primary-premium"   onClick={handleSave}>
                {editingExpense ? 'Actualizar' : 'Guardar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}