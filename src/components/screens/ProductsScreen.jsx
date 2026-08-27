import React, { useState, useMemo, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatCurrency, todayKey } from '../../utils/helpers'
import {
  importProductsFromExcel,
  downloadProductTemplate,
  exportProductsToPDF,
  exportProductsToExcel,
  mergeProductsWithStock,
} from '../../utils/exportImport'
import { IntegrationManager } from '../common/IntegrationManager'

const EMPTY_FORM = {
  name: '', code: '', price: '', stock: '', description: '',
  category: '', images: '', alto: '', ancho: '', profundidad: '', additionalInfo: '',
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 150)
}

function parseImages(str) {
  if (Array.isArray(str)) return str.filter(Boolean)
  return (str || '').split(',').map(s => s.trim()).filter(Boolean)
}

function stringifyImages(arr) {
  if (Array.isArray(arr)) return arr.join(', ')
  return arr || ''
}

function getFirebaseIntegration() {
  try {
    const saved = JSON.parse(localStorage.getItem('zenday-integrations-v2') || '[]')
    return saved.find(i => i.type === 'firebase') || null
  } catch { return null }
}

async function publishToFirebase(product, integration) {
  if (!window.electronAPI?.fetchExternal) throw new Error('No disponible fuera de Electron')
  const c = integration.config
  const baseUrl = c.databaseURL.replace(/\/$/, '')
  const path = c.path || 'productos'

  let firebaseKey = product.firebaseKey

  if (!firebaseKey) {
    const listRes = await window.electronAPI.fetchExternal(`${baseUrl}/${path}.json`)
    if (listRes.ok && listRes.data) {
      const match = Object.entries(listRes.data).find(([, val]) =>
        val && val.nombre && val.nombre.trim().toLowerCase() === (product.name || '').trim().toLowerCase()
      )
      if (match) firebaseKey = match[0]
    }
  }

  const imagenes = parseImages(product.images || product.imagenes)

  const payload = {
    nombre:      product.name || '',
    descripcion: product.description || '',
    precio:      Number(product.price) || 0,
    stock:       Number(product.stock) || 0,
    categoria:   product.category || '',
    imagenes:    imagenes.length ? imagenes : [],
    adicionales: product.additionalInfo || product.adicionales || '',
    alto:        Number(product.alto) || 0,
    ancho:       Number(product.ancho) || 0,
    profundidad: Number(product.profundidad) || 0,
    vendido:     'Disponible',
    nuevoAt:     Date.now(),
  }

  if (firebaseKey) {
    const url = `${baseUrl}/${path}/${firebaseKey}.json`
    const res = await window.electronAPI.fetchExternal(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`Error HTTP ${res.status}`)
    return firebaseKey
  } else {
    const listRes = await window.electronAPI.fetchExternal(`${baseUrl}/${path}.json`)
    let nextKey = '1'
    if (listRes.ok && listRes.data) {
      const keys = Object.keys(listRes.data).map(Number).filter(n => !isNaN(n))
      const maxKey = keys.length ? Math.max(...keys) : 0
      nextKey = String(maxKey + 1)
    }
    payload.id = nextKey
    const url = `${baseUrl}/${path}/${nextKey}.json`
    const res = await window.electronAPI.fetchExternal(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`Error HTTP ${res.status}`)
    return nextKey
  }
}

export function ProductsScreen({ nav, products, setProducts, appointments = [], onIntegrationsChange }) {
  const focusRef = useScreenFocus()
  const toast = useToast()
  const { confirm } = useConfirm()

  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [isImporting, setIsImporting] = useState(false)
  const [isPublishing, setIsPublishing] = useState(null)
  const [duplicateModal, setDuplicateModal] = useState({ show: false, duplicates: [], newProducts: [] })
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return products.filter(p => {
      const name = (p.name || '').toLowerCase()
      const code = (p.code || '').toLowerCase()
      return name.includes(q) || code.includes(q)
    })
  }, [products, searchQuery])

  const stats = useMemo(() => ({
    total:      products.length,
    lowStock:   products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 5).length,
    outOfStock: products.filter(p => (p.stock || 0) === 0).length,
    totalValue: products.reduce((sum, p) => sum + (p.price || 0) * (p.stock || 0), 0),
  }), [products])

  // ========== FUNCIÓN PARA VERIFICAR PEDIDOS ASOCIADOS A UN PRODUCTO ==========
  const verificarPedidosAsociados = useCallback((productId) => {
    const productIdStr = String(productId)
    
    // 1. Verificar en appointments (pedidos de agenda)
    // FIX: contaba TODOS los pedidos, incluidos los entregados y los cancelados,
    // así que un artículo que alguna vez vendiste quedaba bloqueado para siempre.
    // El mensaje decía "completá los pedidos primero" y completarlos no cambiaba
    // nada. La rama de emprendedor (más abajo) ya filtraba por estado.
    const ESTADOS_ACTIVOS = new Set(['scheduled', 'confirmed', 'pending'])
    const pedidosEnAppointments = (appointments || []).filter(a => {
      if (!a.productId) return false
      return String(a.productId) === productIdStr && ESTADOS_ACTIVOS.has(a.status)
    })
    
    // 2. Verificar en pedidos del Panel de Producción
    let pedidosEnEmprendedor = []
    try {
      const saved = localStorage.getItem('zenday-emprendedor-pedidos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          pedidosEnEmprendedor = parsed.filter(p => {
            if (!p.articuloId) return false
            return String(p.articuloId) === productIdStr && p.estado !== 'ENTREGADO'
          })
        }
      }
    } catch (e) {
      console.error('[ProductsScreen] Error loading emprendedor pedidos:', e)
    }
    
    const totalPedidos = pedidosEnAppointments.length + pedidosEnEmprendedor.length
    
    return {
      total: totalPedidos,
      enAppointments: pedidosEnAppointments.length,
      enEmprendedor: pedidosEnEmprendedor.length,
      detalles: {
        appointments: pedidosEnAppointments.map(a => ({ id: a.id, patientName: a.patientName, status: a.status })),
        emprendedor: pedidosEnEmprendedor.map(p => ({ id: p.id, cliente: p.cliente, estado: p.estado }))
      }
    }
  }, [appointments])

  const checkDuplicates = useCallback((fd, excludeId = null) => {
    const nameLower = fd.name.toLowerCase()
    const codeLower = fd.code?.trim().toLowerCase()
    const byName = products.find(p => p.id !== excludeId && (p.name || '').toLowerCase() === nameLower)
    if (byName) return `Ya existe un artículo con nombre "${byName.name}"`
    if (codeLower) {
      const byCode = products.find(p => p.id !== excludeId && (p.code || '').toLowerCase() === codeLower)
      if (byCode) return `Ya existe un artículo con código "${byCode.code}"`
    }
    return null
  }, [products])

  const buildProductData = useCallback((fd) => ({
    ...fd,
    price:    parseFloat(fd.price),
    stock:    parseInt(fd.stock, 10),
    imagenes: parseImages(fd.images),
    alto:     Number(fd.alto) || 0,
    ancho:    Number(fd.ancho) || 0,
    profundidad: Number(fd.profundidad) || 0,
  }), [])

  const validateForm = useCallback((fd, excludeId = null) => {
    if (!fd.name.trim()) { toast.addToast('El nombre es obligatorio', 'error'); return false }
    const price = parseFloat(fd.price)
    if (isNaN(price) || price <= 0) { toast.addToast('El precio debe ser mayor a 0', 'error'); return false }
    const stock = parseInt(fd.stock, 10)
    if (isNaN(stock) || stock < 0) { toast.addToast('El stock debe ser ≥ 0', 'error'); return false }
    const dup = checkDuplicates(fd, excludeId)
    if (dup) { toast.addToast(`⚠️ ${dup}`, 'warning'); return false }
    return true
  }, [checkDuplicates, toast])

  const handleSave = useCallback(() => {
    if (!validateForm(formData, editingProduct?.id ?? null)) return
    const data = buildProductData(formData)
    if (editingProduct) {
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? { ...p, ...data } : p))
      toast.addToast('Artículo actualizado', 'success')
    } else {
      setProducts(prev => [...prev, { ...data, id: genId(), createdAt: new Date().toISOString() }])
      toast.addToast('Artículo creado', 'success')
    }
    setShowForm(false); setEditingProduct(null); setFormData(EMPTY_FORM); setActiveTab('basic')
  }, [formData, editingProduct, validateForm, buildProductData, setProducts, toast])

  const handlePublishToWeb = useCallback(async (product) => {
    const integration = getFirebaseIntegration()
    if (!integration) {
      toast.addToast('❌ No hay integración Firebase configurada. Agregala en 🔌 Integraciones.', 'error')
      return
    }
    setIsPublishing(product.id)
    try {
      const firebaseKey = await publishToFirebase(product, integration)
      setProducts(prev => prev.map(p =>
        p.id === product.id ? { ...p, firebaseKey, publishedToWeb: true } : p
      ))
      toast.addToast(`✅ "${product.name}" publicado en la web`, 'success')
    } catch (err) {
      toast.addToast(`❌ Error al publicar: ${err.message}`, 'error')
    } finally {
      setIsPublishing(null)
    }
  }, [setProducts, toast])

  const handleSaveAndPublish = useCallback(async () => {
    if (!validateForm(formData, editingProduct?.id ?? null)) return
    const data = buildProductData(formData)
    let savedProduct
    if (editingProduct) {
      savedProduct = { ...editingProduct, ...data }
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? savedProduct : p))
    } else {
      savedProduct = { ...data, id: genId(), createdAt: new Date().toISOString() }
      setProducts(prev => [...prev, savedProduct])
    }
    setShowForm(false); setEditingProduct(null); setFormData(EMPTY_FORM); setActiveTab('basic')
    await handlePublishToWeb(savedProduct)
  }, [formData, editingProduct, validateForm, buildProductData, setProducts, handlePublishToWeb])

  // ========== DELETE PRODUCT CON VALIDACIÓN DE PEDIDOS ASOCIADOS ==========
  const handleDelete = useCallback(async (product) => {
    // Verificar si el producto tiene pedidos asociados
    const pedidosAsociados = verificarPedidosAsociados(product.id)
    
    console.log('[ProductsScreen] Verificando producto:', product.name)
    console.log('[ProductsScreen] Pedidos en appointments:', pedidosAsociados.enAppointments)
    console.log('[ProductsScreen] Pedidos en emprendedor:', pedidosAsociados.enEmprendedor)
    
    if (pedidosAsociados.total > 0) {
      let mensaje = `❌ No se puede eliminar "${product.name}"\n\n`
      mensaje += `Este producto tiene ${pedidosAsociados.total} pedido(s) asociado(s):\n`
      if (pedidosAsociados.enAppointments > 0) {
        mensaje += `📋 ${pedidosAsociados.enAppointments} en la agenda\n`
      }
      if (pedidosAsociados.enEmprendedor > 0) {
        mensaje += `📦 ${pedidosAsociados.enEmprendedor} en producción\n`
      }
      mensaje += `\n⚠️ Eliminá o completá los pedidos primero.`
      
      toast.addToast(mensaje, 'error')
      return
    }
    
    const ok = await confirm(`¿Eliminar "${product.name}"?\n\nEsta acción no se puede deshacer.`)
    if (!ok) return
    
    setProducts(prev => prev.filter(p => p.id !== product.id))
    toast.addToast('Artículo eliminado', 'success')
  }, [confirm, setProducts, toast, verificarPedidosAsociados])

  const handleDeleteAll = useCallback(async () => {
    // Verificar productos con pedidos asociados antes de eliminar todos
    const productosConPedidos = []
    for (const product of products) {
      const pedidos = verificarPedidosAsociados(product.id)
      if (pedidos.total > 0) {
        productosConPedidos.push({ name: product.name, pedidos: pedidos.total })
      }
    }
    
    if (productosConPedidos.length > 0) {
      let mensaje = `❌ No se pueden eliminar todos los artículos porque hay productos con pedidos:\n\n`
      productosConPedidos.slice(0, 5).forEach(p => {
        mensaje += `• ${p.name}: ${p.pedidos} pedido(s)\n`
      })
      if (productosConPedidos.length > 5) {
        mensaje += `\n...y ${productosConPedidos.length - 5} más`
      }
      toast.addToast(mensaje, 'error')
      return
    }
    
    const count = products.length
    if (!await confirm(`⚠️ ¿ELIMINAR TODOS LOS ARTÍCULOS?\n\nSe eliminarán ${count} artículos permanentemente.`)) return
    setProducts([])
    toast.addToast(`🗑️ Se eliminaron ${count} artículos`, 'success')
  }, [confirm, products, setProducts, toast, verificarPedidosAsociados])

  const handleBackup = useCallback(() => {
    if (products.length === 0) { toast.addToast('No hay artículos para respaldar', 'error'); return }
    const blob = new Blob([JSON.stringify({ version: '1.0', date: new Date().toISOString(), products }, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `zenday_productos_backup_${todayKey()}.json`)
    toast.addToast(`💾 Backup creado con ${products.length} artículos`, 'success')
  }, [products, toast])

  const handleRestoreBackup = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const backupData = JSON.parse(event.target.result)
          if (!backupData.products || !Array.isArray(backupData.products)) { toast.addToast('❌ Backup inválido', 'error'); return }
          const ok = await confirm(`⚠️ ¿RESTAURAR BACKUP?\n\nSe reemplazarán ${products.length} artículos por ${backupData.products.length}.`)
          if (!ok) return
          setProducts(backupData.products)
          toast.addToast(`✅ Backup restaurado: ${backupData.products.length} artículos`, 'success')
        } catch { toast.addToast('❌ Error al leer el backup', 'error') }
      }
      reader.onerror = () => toast.addToast('❌ No se pudo leer el archivo', 'error')
      reader.readAsText(file)
    }
    input.click()
  }, [confirm, products.length, setProducts, toast])

  const openNewForm = useCallback(() => {
    setEditingProduct(null); setFormData(EMPTY_FORM); setActiveTab('basic'); setShowForm(true)
  }, [])

  const openEditForm = useCallback((product) => {
    setEditingProduct(product)
    setFormData({
      name:           product.name || '',
      code:           product.code || '',
      price:          product.price?.toString() || '',
      stock:          product.stock?.toString() || '',
      description:    product.description || '',
      category:       product.category || '',
      images:         stringifyImages(product.images || product.imagenes),
      alto:           product.alto?.toString() || '',
      ancho:          product.ancho?.toString() || '',
      profundidad:    product.profundidad?.toString() || '',
      additionalInfo: product.additionalInfo || product.adicionales || '',
    })
    setActiveTab('basic'); setShowForm(true)
  }, [])

  const closeForm = useCallback(() => {
    setShowForm(false); setEditingProduct(null); setFormData(EMPTY_FORM); setActiveTab('basic')
  }, [])

  const handleImportProducts = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return
      setIsImporting(true)
      try {
        const result = await importProductsFromExcel(file, products)
        if (result.duplicateCount > 0) {
          setDuplicateModal({ show: true, duplicates: result.duplicates, newProducts: result.products })
        } else if (result.newCount > 0) {
          const toAdd = result.products.map(p => ({ ...p, id: genId(), createdAt: new Date().toISOString() }))
          setProducts(prev => [...prev, ...toAdd])
          toast.addToast(`✅ ${result.newCount} artículos importados`, 'success')
        } else { toast.addToast('⚠️ No se encontraron artículos nuevos', 'warning') }
      } catch (err) { toast.addToast(err.message || 'Error al importar', 'error') }
      finally { setIsImporting(false) }
    }
    input.click()
  }, [products, setProducts, toast])

  const closeDuplicateModal = useCallback(() => setDuplicateModal({ show: false, duplicates: [], newProducts: [] }), [])

  const handleSkipDuplicates = useCallback(() => {
    const { newProducts, duplicates } = duplicateModal
    if (newProducts.length > 0) {
      setProducts(prev => [...prev, ...newProducts.map(p => ({ ...p, id: genId(), createdAt: new Date().toISOString() }))])
      toast.addToast(`✅ ${newProducts.length} nuevos importados. ${duplicates.length} omitidos.`, 'success')
    } else { toast.addToast('⚠️ No había artículos nuevos', 'info') }
    closeDuplicateModal()
  }, [duplicateModal, setProducts, toast, closeDuplicateModal])

  const handleMergeStock = useCallback(() => {
    const { duplicates, newProducts } = duplicateModal
    const { updatedProducts, mergedCount } = mergeProductsWithStock([...duplicates, ...newProducts], products)
    setProducts(updatedProducts)
    toast.addToast(mergedCount.length > 0 ? `📦 Stock actualizado en ${mergedCount.length} artículos.` : `✅ ${newProducts.length} importados`, 'success')
    closeDuplicateModal()
  }, [duplicateModal, products, setProducts, toast, closeDuplicateModal])

  const handleReplaceDuplicates = useCallback(() => {
    const { duplicates, newProducts } = duplicateModal
    const dupCodes = new Set(duplicates.map(d => d.code).filter(Boolean))
    const dupNames = new Set(duplicates.map(d => d.name))
    const remaining = products.filter(p => !dupCodes.has(p.code) && !dupNames.has(p.name))
    const toAdd = [...newProducts, ...duplicates].map(p => ({ ...p, id: genId(), createdAt: new Date().toISOString() }))
    setProducts([...remaining, ...toAdd])
    toast.addToast(`✅ ${toAdd.length} importados (${duplicates.length} reemplazados)`, 'success')
    closeDuplicateModal()
  }, [duplicateModal, products, setProducts, toast, closeDuplicateModal])

  const handleExportExcel = useCallback(() => {
    if (products.length === 0) { toast.addToast('No hay artículos para exportar', 'error'); return }
    exportProductsToExcel(products); toast.addToast('📊 Excel generado', 'success')
  }, [products, toast])

  const handleExportPDF = useCallback(() => {
    if (products.length === 0) { toast.addToast('No hay artículos para exportar', 'error'); return }
    exportProductsToPDF(products); toast.addToast('📄 PDF generado', 'success')
  }, [products, toast])

  const getProductImage = (p) => {
    const imgs = Array.isArray(p.imagenes) ? p.imagenes : parseImages(p.images)
    return imgs?.[0] || null
  }

  return (
    <div ref={focusRef} tabIndex={-1} className="products-screen-premium">

      <div className="products-header">
        <div className="header-left">
          <BackButton onClick={() => nav.goBack()} />
          <h1 className="products-title">Artículos</h1>
          <span className="product-count">{stats.total} total</span>
        </div>
        <div className="header-actions">
          <IntegrationManager products={products} onIntegrationsChange={onIntegrationsChange} />
          <div className="import-export-group">
            <button className="btn-import-premium" onClick={handleImportProducts} disabled={isImporting}>
              {isImporting ? '⏳ Importando…' : '📤 Importar Excel'}
            </button>
            <button className="btn-template-premium" onClick={downloadProductTemplate} title="Descargar plantilla">📋</button>
          </div>
          <div className="import-export-group">
            <button className="btn-export-premium" onClick={handleExportExcel}>📊 Excel</button>
            <button className="btn-export-premium" onClick={handleExportPDF}>📄 PDF</button>
          </div>
          <div className="more-menu-container">
            <button className="btn-icon-premium" onClick={() => setShowMoreMenu(v => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="6" r="2" fill="currentColor" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <circle cx="12" cy="18" r="2" fill="currentColor" />
              </svg>
            </button>
            {showMoreMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setShowMoreMenu(false)} />
                <div className="more-menu">
                  <button onClick={() => { handleBackup(); setShowMoreMenu(false) }}><span>💾</span> Hacer backup</button>
                  <button onClick={() => { handleRestoreBackup(); setShowMoreMenu(false) }}><span>🔄</span> Restaurar backup</button>
                  <div className="menu-divider" />
                  <button onClick={() => { handleDeleteAll(); setShowMoreMenu(false) }} className="danger">
                    <span>🗑️</span> Borrar todos los artículos
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="btn-primary-premium" onClick={openNewForm}><span>+</span> Nuevo artículo</button>
        </div>
      </div>

      <div className="import-guide-premium">
        <div className="guide-step"><span className="step-number">1</span><button className="guide-link" onClick={downloadProductTemplate}>📋 Descargar plantilla</button></div>
        <div className="guide-arrow">→</div>
        <div className="guide-step"><span className="step-number">2</span><span className="step-text">Completar Excel</span></div>
        <div className="guide-arrow">→</div>
        <div className="guide-step"><span className="step-number">3</span><button className="guide-link" onClick={handleImportProducts} disabled={isImporting}>{isImporting ? '⏳ Importando…' : '📤 Importar'}</button></div>
      </div>

      <div className="products-stats">
        <div className="stat-card-premium"><span className="stat-icon">📦</span><div className="stat-content"><span className="stat-value">{stats.total}</span><span className="stat-label">Artículos</span></div></div>
        <div className="stat-card-premium warning"><span className="stat-icon">⚠️</span><div className="stat-content"><span className="stat-value">{stats.lowStock}</span><span className="stat-label">Stock bajo</span></div></div>
        <div className="stat-card-premium danger"><span className="stat-icon">❌</span><div className="stat-content"><span className="stat-value">{stats.outOfStock}</span><span className="stat-label">Agotados</span></div></div>
        <div className="stat-card-premium success"><span className="stat-icon">💰</span><div className="stat-content"><span className="stat-value">{formatCurrency(stats.totalValue, 'UYU')}</span><span className="stat-label">Valor total</span></div></div>
      </div>

      <div className="products-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input placeholder="Buscar por nombre o código…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        {searchQuery && <button className="clear-search" onClick={() => setSearchQuery('')}>✕</button>}
      </div>

      {duplicateModal.show && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 600 }}>
            <div className="modal-header-premium">
              <h2>⚠️ Se detectaron duplicados</h2>
              <button className="modal-close" onClick={closeDuplicateModal}>✕</button>
            </div>
            <div className="modal-body">
              <p>Se encontraron <strong>{duplicateModal.duplicates.length}</strong> artículos duplicados:</p>
              <div className="duplicates-list">
                {duplicateModal.duplicates.slice(0, 10).map((dup, i) => (
                  <div key={i} className="duplicate-item">
                    <span className="dup-name">{dup.name}</span>
                    <span className="dup-reason">{dup.duplicateReason}</span>
                    {dup.existingProduct && <span className="dup-existing">Stock actual: {dup.existingProduct.stock || 0}</span>}
                  </div>
                ))}
                {duplicateModal.duplicates.length > 10 && <div className="duplicate-more">…y {duplicateModal.duplicates.length - 10} más</div>}
              </div>
              <p className="import-summary">📊 Nuevos: {duplicateModal.newProducts?.length || 0} · Duplicados: {duplicateModal.duplicates.length}</p>
              <div className="duplicate-options">
                <button className="btn-option" onClick={handleSkipDuplicates}>📦 Solo agregar nuevos</button>
                <button className="btn-option merge" onClick={handleMergeStock}>🔄 Sumar stock</button>
                <button className="btn-option replace" onClick={handleReplaceDuplicates}>🔁 Reemplazar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 620 }}>
            <div className="modal-header-premium">
              <h2>{editingProduct ? 'Editar artículo' : 'Nuevo artículo'}</h2>
              <button className="modal-close" onClick={closeForm}>✕</button>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
              {[{ id: 'basic', label: '📋 Básico' }, { id: 'web', label: '🌐 Web / Fotos' }].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                  flex: 1, padding: '12px', border: 'none', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13,
                  borderBottom: activeTab === tab.id ? '2px solid #6366f1' : '2px solid transparent',
                  fontWeight: activeTab === tab.id ? 700 : 400,
                  color: activeTab === tab.id ? 'var(--accent-blue)' : 'var(--text-secondary)',
                }}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="modal-body" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {activeTab === 'basic' && (
                <>
                  <div className="form-group-premium">
                    <label>Nombre del artículo <span className="required">*</span></label>
                    <input autoFocus placeholder="Ej: Osito Kawaii" value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="form-row-premium">
                    <div className="form-group-premium">
                      <label>Código / SKU</label>
                      <input placeholder="CAM-001" value={formData.code}
                        onChange={e => setFormData(p => ({ ...p, code: e.target.value }))} />
                    </div>
                    <div className="form-group-premium">
                      <label>Categoría</label>
                      <input placeholder="Ej: Kawaii, Personaje" value={formData.category}
                        onChange={e => setFormData(p => ({ ...p, category: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-row-premium">
                    <div className="form-group-premium">
                      <label>Precio (UYU) <span className="required">*</span></label>
                      <div className="input-with-prefix">
                        <span>$</span>
                        <input type="number" placeholder="0" min="0" step="0.01" value={formData.price}
                          onChange={e => setFormData(p => ({ ...p, price: e.target.value }))} />
                      </div>
                    </div>
                    <div className="form-group-premium">
                      <label>Stock disponible</label>
                      <input type="number" placeholder="0" min="0" value={formData.stock}
                        onChange={e => setFormData(p => ({ ...p, stock: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-group-premium">
                    <label>Descripción</label>
                    <textarea rows={3} placeholder="Describí el producto…" value={formData.description}
                      onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
                  </div>
                </>
              )}

              {activeTab === 'web' && (
                <>
                  <div className="form-group-premium">
                    <label>🖼️ Imágenes (URLs separadas por coma)</label>
                    <textarea rows={3}
                      placeholder="https://i.imgur.com/abc.jpg, https://i.imgur.com/def.jpg"
                      value={formData.images}
                      onChange={e => setFormData(p => ({ ...p, images: e.target.value }))} />
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      Subí las fotos a imgur.com y pegá las URLs acá
                    </span>
                  </div>

                  {formData.images && parseImages(formData.images).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                      {parseImages(formData.images).map((url, i) => (
                        <img key={i} src={url} alt={`img-${i}`}
                          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                          onError={e => { e.target.style.display = 'none' }} />
                      ))}
                    </div>
                  )}

                  <div className="form-group-premium">
                    <label>📝 Adicionales / Materiales</label>
                    <input placeholder="Ej: Ojos de plástico, relleno hipoalergénico" value={formData.additionalInfo}
                      onChange={e => setFormData(p => ({ ...p, additionalInfo: e.target.value }))} />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📐 Dimensiones (cm)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      {[{ key: 'alto', label: 'Alto' }, { key: 'ancho', label: 'Ancho' }, { key: 'profundidad', label: 'Prof.' }].map(d => (
                        <div key={d.key}>
                          <label style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>{d.label}</label>
                          <input type="number" placeholder="0" min="0" value={formData[d.key]}
                            onChange={e => setFormData(p => ({ ...p, [d.key]: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--border)', background: 'var(--bg-tertiary)',
                              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {editingProduct?.publishedToWeb && (
                    <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.08)',
                      borderRadius: 10, border: '1px solid rgba(16,185,129,0.3)', fontSize: 13 }}>
                      ✅ Publicado en la web (key Firebase: <code>{editingProduct.firebaseKey}</code>)
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer-premium" style={{ gap: 8 }}>
              <button className="btn-secondary-premium" onClick={closeForm}>Cancelar</button>
              <button className="btn-secondary-premium" onClick={handleSave}>
                {editingProduct ? '💾 Actualizar' : '💾 Guardar'}
              </button>
              <button onClick={handleSaveAndPublish}
                style={{ padding: '11px 16px', background: 'linear-gradient(135deg, #10b981, #6366f1)',
                  border: 'none', borderRadius: 12, color: 'white', fontWeight: 700,
                  cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                {editingProduct ? '🌐 Actualizar y publicar' : '🌐 Guardar y publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="products-grid">
        {filtered.length === 0 ? (
          <div className="empty-state-premium">
            <span className="empty-icon">📦</span>
            <h3>No hay artículos</h3>
            <p>{searchQuery ? 'No se encontraron resultados' : 'Comienza agregando tu primer artículo'}</p>
            {!searchQuery && <button className="btn-primary-premium" onClick={openNewForm}>+ Crear primer artículo</button>}
          </div>
        ) : (
          filtered.map((p, i) => {
            const stock = p.stock || 0
            const status = stock === 0 ? 'out' : stock < 5 ? 'low' : 'ok'
            const img = getProductImage(p)
            const publishing = isPublishing === p.id
            return (
              <div key={`product-${p.id}-${i}`} className="product-card-premium">
                {img && (
                  <img src={img} alt={p.name}
                    style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: '12px 12px 0 0', marginBottom: 8 }}
                    onError={e => { e.target.style.display = 'none' }} />
                )}
                <div className="product-card-header">
                  <h3>{p.name}</h3>
                  <div className="product-actions">
                    {p.publishedToWeb && <span title="Publicado en la web" style={{ fontSize: 14 }}>🌐</span>}
                    <button className="btn-icon-sm" onClick={() => openEditForm(p)}>✏️</button>
                    <button className="btn-icon-sm danger" onClick={() => handleDelete(p)}>🗑️</button>
                  </div>
                </div>
                {p.code && <span className="product-code-premium">{p.code}</span>}
                {p.category && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>📂 {p.category}</span>}
                {p.description && <p className="product-description">{p.description}</p>}
                <div className="product-footer">
                  <span className="product-price-premium">{formatCurrency(p.price, 'UYU')}</span>
                  <span className={`stock-badge ${status}`}>
                    {stock === 0 ? '⚠️ Agotado' : stock < 5 ? `📦 ${stock} uds` : `${stock} uds`}
                  </span>
                </div>
                <button onClick={() => handlePublishToWeb(p)} disabled={publishing}
                  style={{
                    marginTop: 8, width: '100%', padding: '7px', border: 'none', borderRadius: 8,
                    cursor: publishing ? 'not-allowed' : 'pointer', fontSize: 12,
                    fontFamily: 'inherit', fontWeight: 600,
                    background: p.publishedToWeb ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.10)',
                    color: p.publishedToWeb ? 'var(--accent-green)' : 'var(--accent-blue)',
                  }}>
                  {publishing ? '⏳ Publicando…' : p.publishedToWeb ? '🌐 Actualizar en web' : '🌐 Publicar en web'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}