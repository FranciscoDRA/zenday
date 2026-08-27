// src/components/common/IntegrationManager.jsx
// Sistema genérico de integraciones para ZenDay
// Firebase, WooCommerce, Shopify, MercadoLibre, REST API

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { newId } from '../../utils/helpers'

// ─── PLATAFORMAS ──────────────────────────────────────────────────────────────

const PLATFORMS = {
  firebase: {
    id:          'firebase',
    label:       'Firebase',
    icon:        '🔥',
    color:       'var(--accent-amber)',
    description: 'Google Firebase Realtime Database',
    fields: [
      { key: 'name',        label: 'Nombre',         placeholder: 'Ej: patofelting.com',                          required: true },
      { key: 'databaseURL', label: 'Database URL',   placeholder: 'https://mi-proyecto-rtdb.firebaseio.com',      required: true },
      { key: 'path',        label: 'Ruta productos', placeholder: 'productos',                                    required: true },
      { key: 'nameField',   label: 'Campo nombre',   placeholder: 'nombre',                                       required: true },
      { key: 'stockField',  label: 'Campo stock',    placeholder: 'stock',                                        required: true },
    ],
  },
  woocommerce: {
    id:          'woocommerce',
    label:       'WooCommerce',
    icon:        '🛒',
    color:       '#7c3aed',
    description: 'WordPress + WooCommerce',
    fields: [
      { key: 'name',           label: 'Nombre',          placeholder: 'Mi tienda WooCommerce', required: true },
      { key: 'siteURL',        label: 'URL del sitio',   placeholder: 'https://mi-tienda.com', required: true },
      { key: 'consumerKey',    label: 'Consumer Key',    placeholder: 'ck_...',                required: true },
      { key: 'consumerSecret', label: 'Consumer Secret', placeholder: 'cs_...',                required: true, type: 'password' },
    ],
  },
  shopify: {
    id:          'shopify',
    label:       'Shopify',
    icon:        '🏪',
    color:       'var(--accent-green)',
    description: 'Tienda Shopify',
    fields: [
      { key: 'name',     label: 'Nombre',              placeholder: 'Mi tienda Shopify',          required: true },
      { key: 'shopName', label: 'Nombre de la tienda', placeholder: 'mi-tienda (sin .myshopify.com)', required: true },
      { key: 'apiKey',   label: 'Admin API Token',     placeholder: 'shpat_...',                  required: true, type: 'password' },
    ],
  },
  mercadolibre: {
    id:          'mercadolibre',
    label:       'MercadoLibre',
    icon:        '🛍️',
    color:       'var(--accent-amber)',
    description: 'Publicaciones de MercadoLibre',
    fields: [
      { key: 'name',        label: 'Nombre',       placeholder: 'Mi cuenta ML', required: true },
      { key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...',  required: true, type: 'password' },
      { key: 'sellerId',    label: 'Seller ID',    placeholder: '123456789',    required: true },
    ],
  },
  rest: {
    id:          'rest',
    label:       'API REST',
    icon:        '🔌',
    color:       'var(--accent-blue)',
    description: 'Cualquier API REST',
    fields: [
      { key: 'name',             label: 'Nombre',                   placeholder: 'Mi API',                 required: true },
      { key: 'baseURL',          label: 'URL base',                 placeholder: 'https://api.mi-web.com', required: true },
      { key: 'productsEndpoint', label: 'Endpoint productos (GET)', placeholder: '/products',              required: true },
      { key: 'stockEndpoint',    label: 'Endpoint stock (PATCH)',   placeholder: '/products/{id}/stock',   required: true },
      { key: 'apiKey',           label: 'API Key (opcional)',       placeholder: 'sk_...',                 type: 'password' },
      { key: 'nameField',        label: 'Campo nombre',             placeholder: 'name' },
      { key: 'stockField',       label: 'Campo stock',              placeholder: 'stock' },
      { key: 'idField',          label: 'Campo ID',                 placeholder: 'id' },
    ],
  },
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'zenday-integrations-v2'

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveSaved(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
}

// ─── MATCHING ─────────────────────────────────────────────────────────────────

function normalize(str) {
  if (!str) return ''
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function matchScore(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  
  const wa = new Set(na.split(/\s+/))
  const wb = new Set(nb.split(/\s+/))
  const common = [...wa].filter(w => wb.has(w) && w.length > 1).length
  const total  = Math.max(wa.size, wb.size)
  return total > 0 ? common / total : 0
}

// ─── VERIFICACIÓN DE ELECTRON API ─────────────────────────────────────────────

function checkElectronAPI() {
  if (!window.electronAPI || typeof window.electronAPI.fetchExternal !== 'function') {
    throw new Error('Electron API no disponible. La aplicación necesita recargarse.')
  }
  return true
}

// ─── FETCH PRODUCTOS EXTERNOS (con retry mejorado) ────────────────────────────

async function fetchWithRetry(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      // CORREGIDO: No hacer retry en errores 4xx (deterministas)
      const isHTTPError = err.message?.match(/HTTP ([45]\d\d)/)
      const is4xx = isHTTPError && parseInt(isHTTPError[1]) >= 400 && parseInt(isHTTPError[1]) < 500
      if (is4xx) throw err  // 4xx: no reintentar (401, 403, 404, etc)
      
      if (i === maxRetries - 1) throw err
      const delay = baseDelay * Math.pow(2, i)
      console.log(`[IntegrationManager] Retry ${i+1}/${maxRetries} after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

async function fetchExternal(integration) {
  checkElectronAPI()
  const c = integration.config

  return fetchWithRetry(async () => {
    switch (integration.type) {

      case 'firebase': {
        const url = `${c.databaseURL.replace(/\/$/, '')}/${c.path || 'productos'}.json`
        const response = await window.electronAPI.fetchExternal(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = response.data
        if (!data) return []
        return Object.entries(data)
          .filter(([key, val]) => val !== null && typeof val === 'object')
          .map(([key, val]) => ({
            externalId: key,
            name:       val[c.nameField  || 'nombre'] || key,
            stock:      Number(val[c.stockField || 'stock']) || 0,
            price:      Number(val.precio || val.price) || 0,
            raw:        val,
          }))
      }

      case 'woocommerce': {
        const auth = btoa(`${c.consumerKey}:${c.consumerSecret}`)
        const url = `${c.siteURL.replace(/\/$/, '')}/wp-json/wc/v3/products?per_page=100`
        const response = await window.electronAPI.fetchExternal(url, {
          headers: { Authorization: `Basic ${auth}` }
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = response.data
        if (!Array.isArray(data)) throw new Error(data.message || 'Error WooCommerce — verificá las credenciales')
        return data.map(p => ({
          externalId: p.id,
          name:       p.name,
          stock:      Number(p.stock_quantity) || 0,
          price:      Number(p.price) || 0,
          raw:        p,
        }))
      }

      case 'shopify': {
        const url = `https://${c.shopName}.myshopify.com/admin/api/2024-01/products.json?limit=250`
        const response = await window.electronAPI.fetchExternal(url, {
          headers: { 'X-Shopify-Access-Token': c.apiKey, 'Content-Type': 'application/json' }
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = response.data
        if (!data.products) throw new Error('Error Shopify — verificá el token')
        return data.products.map(p => ({
          externalId: p.id,
          name:       p.title,
          stock:      p.variants?.reduce((s, v) => s + (v.inventory_quantity || 0), 0) || 0,
          price:      Number(p.variants?.[0]?.price) || 0,
          variantId:  p.variants?.[0]?.id,
          raw:        p,
        }))
      }

      case 'mercadolibre': {
        const url = `https://api.mercadolibre.com/users/${c.sellerId}/items/search?limit=50`
        const response = await window.electronAPI.fetchExternal(url, {
          headers: { Authorization: `Bearer ${c.accessToken}` }
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = response.data
        const ids = data.results || []
        const items = await Promise.all(
          ids.slice(0, 50).map(async (id) => {
            const itemResponse = await window.electronAPI.fetchExternal(
              `https://api.mercadolibre.com/items/${id}`,
              { headers: { Authorization: `Bearer ${c.accessToken}` } }
            )
            return itemResponse.ok ? itemResponse.data : null
          })
        )
        return items
          .filter(p => p)
          .map(p => ({
            externalId: p.id,
            name:       p.title,
            stock:      Number(p.available_quantity) || 0,
            price:      Number(p.price) || 0,
            raw:        p,
          }))
      }

      case 'rest': {
        const headers = {}
        if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`
        const url = `${c.baseURL}${c.productsEndpoint || '/products'}`
        const response = await window.electronAPI.fetchExternal(url, { headers })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = response.data
        const list = Array.isArray(data) ? data : (data.products || data.data || data.items || [])
        return list.map(p => ({
          externalId: p[c.idField    || 'id'],
          name:       p[c.nameField  || 'name'],
          stock:      Number(p[c.stockField || 'stock']) || 0,
          price:      Number(p.price) || 0,
          raw:        p,
        }))
      }

      default:
        throw new Error(`Tipo desconocido: ${integration.type}`)
    }
  })
}

// ─── PUSH STOCK CORREGIDO (PATCH en Firebase) ─────────────────────────────────

async function pushStock(integration, externalId, newStock, extProduct) {
  checkElectronAPI()
  const c = integration.config

  return fetchWithRetry(async () => {
    switch (integration.type) {

      case 'firebase': {
        const baseUrl = c.databaseURL.replace(/\/$/, '')
        const url = `${baseUrl}/${c.path || 'productos'}/${externalId}.json`
        
        // CORREGIDO: Usar PATCH en lugar de PUT para evitar sobreescribir datos
        const body = { [c.stockField || 'stock']: newStock }
        
        // Si el producto estaba agotado y ahora tiene stock, agregar timestamp
        if ((extProduct?.stock || 0) <= 0 && newStock > 0) {
          body.restockedAt = Date.now()
        }
        
        const response = await window.electronAPI.fetchExternal(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return
      }

      case 'woocommerce': {
        const auth = btoa(`${c.consumerKey}:${c.consumerSecret}`)
        const response = await window.electronAPI.fetchExternal(
          `${c.siteURL.replace(/\/$/, '')}/wp-json/wc/v3/products/${externalId}`,
          {
            method: 'PUT',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock_quantity: newStock, manage_stock: true }),
          }
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return
      }

      case 'shopify': {
        const variantId = extProduct?.variantId
        if (!variantId) throw new Error('El producto no tiene variantes (variantId faltante)')
        
        const varResponse = await window.electronAPI.fetchExternal(
          `https://${c.shopName}.myshopify.com/admin/api/2024-01/variants/${variantId}.json`,
          { headers: { 'X-Shopify-Access-Token': c.apiKey } }
        )
        if (!varResponse.ok) throw new Error(`Failed to get variant: HTTP ${varResponse.status}`)
        const varData = varResponse.data
        const invItemId = varData.variant?.inventory_item_id
        
        if (!invItemId) throw new Error('El producto no tiene inventory_item_id')
        
        const locResponse = await window.electronAPI.fetchExternal(
          `https://${c.shopName}.myshopify.com/admin/api/2024-01/locations.json`,
          { headers: { 'X-Shopify-Access-Token': c.apiKey } }
        )
        if (!locResponse.ok) throw new Error(`Failed to get locations: HTTP ${locResponse.status}`)
        const locData = locResponse.data
        const locationId = locData.locations?.[0]?.id
        
        if (!locationId) throw new Error('No se encontraron locations en la tienda Shopify')
        
        const invResponse = await window.electronAPI.fetchExternal(
          `https://${c.shopName}.myshopify.com/admin/api/2024-01/inventory_levels/set.json`,
          {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': c.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_id: locationId, inventory_item_id: invItemId, available: newStock }),
          }
        )
        if (!invResponse.ok) throw new Error(`Failed to update stock: HTTP ${invResponse.status}`)
        return
      }

      case 'mercadolibre': {
        const response = await window.electronAPI.fetchExternal(
          `https://api.mercadolibre.com/items/${externalId}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ available_quantity: newStock }),
          }
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return
      }

      case 'rest': {
        const endpoint = (c.stockEndpoint || '/products/{id}/stock').replace('{id}', externalId)
        const headers = { 'Content-Type': 'application/json' }
        if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`
        const response = await window.electronAPI.fetchExternal(`${c.baseURL}${endpoint}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ [c.stockField || 'stock']: newStock }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return
      }

      default:
        throw new Error(`Tipo desconocido: ${integration.type}`)
    }
  })
}

// ─── TEST CONNECTION CON TIMEOUT ──────────────────────────────────────────────

async function testConnection(integration) {
  // CORREGIDO: Timeout de 5 segundos para test de conexión
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout: la conexión tardó más de 5 segundos')), 5000)
  )
  
  try {
    await Promise.race([fetchExternal(integration), timeoutPromise])
    return { success: true, error: null }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

// Subcomponente memoizado para ítems de integración
const SavedIntegrationItem = React.memo(({ integ, loading, activeId, onSync, onDelete }) => (
  <div style={{ display:'flex', alignItems:'center', gap:12,
    padding:'12px 14px', borderRadius:12, background:'var(--bg-tertiary)',
    border:'1px solid var(--border)' }}>
    <div style={{ width:40, height:40, borderRadius:10, display:'flex',
      alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0,
      background:`${integ.color}20` }}>
      {integ.icon}
    </div>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:14, fontWeight:700, overflow:'hidden',
        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{integ.name}</div>
      <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>
        {PLATFORMS[integ.type]?.label}
      </div>
    </div>
    <button onClick={() => onSync(integ)} disabled={loading}
      style={{ padding:'9px 16px', background:`${integ.color}20`, border:'none',
        borderRadius:8, color:integ.color, fontWeight:700, cursor:'pointer',
        fontSize:12, fontFamily:'inherit', flexShrink:0,
        opacity: loading && activeId === integ.id ? .6 : 1 }}>
      {loading && activeId === integ.id ? '⏳...' : '🔄 Sincronizar'}
    </button>
    <button onClick={() => onDelete(integ.id)}
      style={{ background:'transparent', border:'none', color:'var(--text-tertiary)',
        cursor:'pointer', fontSize:16, flexShrink:0, padding:4 }}>🗑️</button>
  </div>
));

export function IntegrationManager({ products = [], onIntegrationsChange }) {
  const toast = useToast()
  const { confirm } = useConfirm()

  const [isOpen,      setIsOpen]      = useState(false)
  const [view,        setView]        = useState('menu')
  const [saved,       setSaved]       = useState(loadSaved)
  const [addType,     setAddType]     = useState('firebase')
  const [formData,    setFormData]    = useState({})
  const [testingConn, setTestingConn] = useState(null)

  // sync
  const [activeInteg, setActiveInteg] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [extProducts, setExtProducts] = useState([])
  const [matches,     setMatches]     = useState([])
  const [syncing,     setSyncing]     = useState(false)
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 })  // ← NUEVO
  const [syncResult,  setSyncResult]  = useState(null)
  const [syncHistory, setSyncHistory] = useState([])

  const platform = PLATFORMS[addType]

  // Verificar Electron API al montar (silencioso en dev)
  useEffect(() => {
    const isDev = process.env.NODE_ENV === 'development'
    try {
      checkElectronAPI()
    } catch (err) {
      if (!isDev) {
        console.error('[IntegrationManager]', err.message)
        toast.addToast('⚠️ API de Electron no disponible. Las integraciones no funcionarán.', 'error')
      }
    }
  }, [toast])

  // Cargar historial de sincronización
  useEffect(() => {
    try {
      const history = JSON.parse(localStorage.getItem('sync_logs') || '[]')
      setSyncHistory(history)
    } catch {}
  }, [])

  // CORREGIDO: logSync sin side effects en el updater
  const logSync = useCallback((integrationName, status, details) => {
    const newLog = {
      id: newId(),
      integrationName,
      status,
      timestamp: new Date().toISOString(),
      details
    }
    setSyncHistory(prev => {
      const updated = [newLog, ...prev].slice(0, 50)
      // Side effect fuera del updater usando queueMicrotask
      queueMicrotask(() => localStorage.setItem('sync_logs', JSON.stringify(updated)))
      return updated
    })
  }, [])

  // ── Guardar integración ───────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const required = platform.fields.filter(f => f.required && !formData[f.key])
    if (required.length > 0) {
      toast.addToast(`❌ Completá: ${required.map(f => f.label).join(', ')}`, 'error')
      return
    }
    
    const newInteg = {
      id: newId(),
      type:      addType,
      name:      formData.name || platform.label,
      icon:      platform.icon,
      color:     platform.color,
      config:    { ...formData },
      createdAt: new Date().toISOString(),
    }
    
    // Probar conexión antes de guardar con timeout
    setTestingConn(addType)
    const test = await testConnection(newInteg)
    setTestingConn(null)
    
    if (!test.success) {
      // Era window.confirm: en Electron eso abre el cartel gris del sistema,
      // con la ruta del archivo arriba. Al lado del resto de la app parece
      // que algo se rompio. useConfirm usa el modal propio, que ademas se
      // cierra con Escape y confirma con Enter.
      const ok = await confirm(
        `⚠️ Error de conexión: ${test.error}\n\n` +
        `¿Querés guardar la integración igualmente? Podrás corregir los datos más tarde.`,
        'Guardar con errores'
      )
      if (!ok) return
    }
    
    const updated = [...saved, newInteg]
    setSaved(updated)
    saveSaved(updated)
    toast.addToast(`✅ "${newInteg.name}" guardada${test.success ? '' : ' (con errores de conexión)'}`, 'success')
    if (onIntegrationsChange) onIntegrationsChange()
    setView('menu')
    setFormData({})
  }, [platform, formData, saved, addType, toast, onIntegrationsChange])

  // ── Eliminar ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback((id) => {
    const updated = saved.filter(s => s.id !== id)
    setSaved(updated)
    saveSaved(updated)
    toast.addToast('🗑️ Integración eliminada', 'info')
    if (onIntegrationsChange) onIntegrationsChange()
  }, [saved, toast, onIntegrationsChange])

  // ── Cargar externos y calcular matches ────────────────────────────────────
  const handleStartSync = useCallback(async (integration) => {
    setLoading(true)
    setActiveInteg(integration)
    setSyncResult(null)
    try {
      const external = await fetchExternal(integration)
      setExtProducts(external)

      const calculated = products.map(zen => {
        let best = null, bestScore = 0
        external.forEach(ext => {
          const score = matchScore(zen.name, ext.name)
          if (score > bestScore) { bestScore = score; best = ext }
        })
        return {
          zenProduct: zen,
          extProduct: bestScore >= 0.7 ? best : null,
          score:      bestScore,
          matched:    bestScore >= 0.7,
          stockDiff:  bestScore >= 0.7 && best ? zen.stock !== best.stock : false,
          selected:   bestScore >= 0.7,
        }
      })

      setMatches(calculated)
      setView('sync')
    } catch (err) {
      toast.addToast(`❌ ${err.message}`, 'error')
      logSync(integration.name, 'error', { error: err.message, type: 'fetch' })
    } finally {
      setLoading(false)
    }
  }, [products, toast, logSync])

  // ── Toggle / cambiar match ─────────────────────────────────────────────────
  const toggleSelected = useCallback((zenId) => {
    setMatches(prev => prev.map(m =>
      m.zenProduct.id === zenId ? { ...m, selected: !m.selected } : m
    ))
  }, [])

  const changeMatch = useCallback((zenId, extId) => {
    const ext = extProducts.find(p => String(p.externalId) === String(extId))
    setMatches(prev => prev.map(m => {
      if (m.zenProduct.id !== zenId) return m
      return { ...m, extProduct: ext || null, matched: !!ext,
        stockDiff: ext ? m.zenProduct.stock !== ext.stock : false, selected: !!ext }
    }))
  }, [extProducts])

  // ── Sincronizar con progreso y concurrencia limitada ───────────────────────
  const handleSync = useCallback(async () => {
    const toSync = matches.filter(m => m.selected && m.matched && m.extProduct)
    if (!toSync.length) { toast.addToast('⚠️ Nada seleccionado', 'warning'); return }

    setSyncing(true)
    setSyncProgress({ current: 0, total: toSync.length })
    
    const results = []
    const CONCURRENCY = 5  // ← máximo 5 requests simultáneos
    
    for (let i = 0; i < toSync.length; i += CONCURRENCY) {
      const batch = toSync.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(async (m, idx) => {
          try {
            await pushStock(activeInteg, m.extProduct.externalId, m.zenProduct.stock || 0, m.extProduct)
            return { 
              name: m.zenProduct.name, 
              ok: true,
              before: m.extProduct.stock, 
              after: m.zenProduct.stock 
            }
          } catch (err) {
            return { name: m.zenProduct.name, ok: false, error: err.message }
          }
        })
      )
      
      batchResults.forEach(r => {
        results.push(r.status === 'fulfilled' ? r.value : r.reason)
      })
      
      setSyncProgress({ current: Math.min(i + CONCURRENCY, toSync.length), total: toSync.length })
    }
    
    setSyncing(false)
    setSyncResult(results)
    setView('result')

    const ok  = results.filter(r => r.ok).length
    const err = results.filter(r => !r.ok).length
    
    const status = err === 0 ? 'success' : (ok > 0 ? 'partial' : 'error')
    logSync(activeInteg.name, status, { ok, err, total: toSync.length, results })
    
    // Alertar productos agotados
    const outOfStock = results.filter(r => r.ok && r.after === 0)
    if (outOfStock.length > 0) {
      toast.addToast(`⚠️ ${outOfStock.length} producto${outOfStock.length !== 1 ? 's' : ''} quedó agotado en la web`, 'warning')
    }
    
    if (ok)  toast.addToast(`✅ ${ok} producto${ok!==1?'s':''} sincronizado${ok!==1?'s':''}`, 'success')
    if (err) toast.addToast(`⚠️ ${err} error${err!==1?'es':''}`, 'warning')
  }, [matches, activeInteg, toast, logSync])

  const stats = useMemo(() => ({
    selected: matches.filter(m => m.selected).length,
    matched:  matches.filter(m => m.matched).length,
    withDiff: matches.filter(m => m.matched && m.stockDiff).length,
  }), [matches])

  const close = () => { setIsOpen(false); setView('menu'); setSyncResult(null) }

  // ─── PANEL ────────────────────────────────────────────────────────────────
  const panel = isOpen ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:16 }}
      onClick={() => !syncing && close()}>
      <div style={{ background:'var(--bg-secondary)', borderRadius:20, width:'100%',
        maxWidth:680, maxHeight:'88vh', display:'flex', flexDirection:'column',
        boxShadow:'0 24px 64px rgba(0,0,0,0.25)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <h3 style={{ margin:0, color:'white', fontSize:16, fontWeight:800 }}>🔌 Integraciones</h3>
            <p style={{ margin:'2px 0 0', color:'rgba(255,255,255,0.75)', fontSize:11 }}>
              Sincronizá tu stock con tiendas online
            </p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {view !== 'menu' && (
              <button onClick={() => setView('menu')}
                style={{ background:'rgba(255,255,255,0.15)', border:'none', borderRadius:8,
                  padding:'6px 12px', color:'white', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                ← Volver
              </button>
            )}
            <button onClick={close}
              style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:'50%',
                width:30, height:30, color:'white', cursor:'pointer', fontSize:15 }}>✕</button>
          </div>
        </div>

        {/* ── MENÚ ─────────────────────────────────────────────────────────── */}
        {view === 'menu' && (
          <div style={{ flex:1, overflowY:'auto', padding:20 }}>

            {/* Integraciones guardadas */}
            {saved.length > 0 && (
              <>
                <p style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)',
                  textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
                  Mis integraciones
                </p>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
                  {saved.map(integ => (
                    <SavedIntegrationItem
                      key={integ.id}
                      integ={integ}
                      loading={loading}
                      activeId={activeInteg?.id}
                      onSync={handleStartSync}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Empty state */}
            {saved.length === 0 && (
              <div style={{ textAlign:'center', padding:'32px 0 24px', color:'var(--text-tertiary)' }}>
                <span style={{ fontSize:48, display:'block', marginBottom:12, opacity:.25 }}>🔌</span>
                <p style={{ fontSize:14, fontWeight:600, margin:'0 0 4px' }}>
                  Sin integraciones configuradas
                </p>
                <p style={{ fontSize:12, margin:0 }}>
                  Conectá tu tienda online para sincronizar el stock automáticamente
                </p>
              </div>
            )}

            {/* Conectar nueva */}
            <p style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)',
              textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
              Conectar plataforma
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {Object.values(PLATFORMS).map(p => (
                <button key={p.id}
                  onClick={() => { setAddType(p.id); setFormData({}); setView('add') }}
                  style={{ padding:'16px 8px', borderRadius:12, border:'1px solid var(--border)',
                    background:'var(--bg-tertiary)', cursor:'pointer', display:'flex',
                    flexDirection:'column', alignItems:'center', gap:6, transition:'all 0.15s',
                    fontFamily:'inherit' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = p.color
                    e.currentTarget.style.background  = `${p.color}10`
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.background  = 'var(--bg-tertiary)'
                  }}>
                  <span style={{ fontSize:28 }}>{p.icon}</span>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)' }}>
                    {p.label}
                  </span>
                  <span style={{ fontSize:10, color:'var(--text-tertiary)', textAlign:'center',
                    lineHeight:1.3 }}>
                    {p.description}
                  </span>
                </button>
              ))}
            </div>

            {/* Historial de sincronización */}
            {syncHistory.length > 0 && (
              <>
                <p style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)',
                  textTransform:'uppercase', letterSpacing:1, marginTop:24, marginBottom:10 }}>
                  Últimas sincronizaciones
                </p>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {syncHistory.slice(0, 5).map(log => (
                    <div key={log.id} style={{ display:'flex', alignItems:'center', gap:10,
                      padding:'8px 12px', borderRadius:8, background:'var(--bg-tertiary)',
                      fontSize:11 }}>
                      <span style={{ 
                        width:8, height:8, borderRadius:'50%', flexShrink:0,
                        background: log.status === 'success' ? 'var(--accent-green)' : 
                                   log.status === 'partial' ? 'var(--accent-amber)' : 'var(--accent-red)'
                      }} />
                      <span style={{ flex:1 }}>{log.integrationName}</span>
                      <span style={{ color:'var(--text-tertiary)' }}>
                        {new Date(log.timestamp).toLocaleDateString()}
                      </span>
                      <span style={{ 
                        color: log.status === 'success' ? 'var(--accent-green)' : 
                               log.status === 'partial' ? 'var(--accent-amber)' : 'var(--accent-red)' 
                      }}>
                        {log.status === 'success' ? '✓ OK' : 
                         log.status === 'partial' ? '⚠️ Parcial' : '❌ Error'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── AGREGAR ──────────────────────────────────────────────────────── */}
        {view === 'add' && (
          <>
            <div key={addType} style={{ flex:1, overflowY:'auto', padding:20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                borderRadius:12, background:`${platform.color}10`,
                border:`1px solid ${platform.color}40`, marginBottom:20 }}>
                <span style={{ fontSize:28 }}>{platform.icon}</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:800 }}>{platform.label}</div>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{platform.description}</div>
                </div>
                {testingConn === addType && (
                  <span style={{ marginLeft:'auto', fontSize:12, color:platform.color }}>
                    ⏳ Probando conexión...
                  </span>
                )}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {platform.fields.map(field => (
                  <div key={field.key}>
                    <label style={{ display:'block', fontSize:13, fontWeight:600, marginBottom:5 }}>
                      {field.label}
                      {field.required && <span style={{ color:'var(--accent-red)', marginLeft:3 }}>*</span>}
                    </label>
                    <input
                      type={field.type || 'text'}
                      placeholder={field.placeholder}
                      value={formData[field.key] || ''}
                      onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                      style={{ width:'100%', padding:'10px 14px', borderRadius:10,
                        border:'1px solid var(--border)', background:'var(--bg-tertiary)',
                        color:'var(--text-primary)', fontSize:13, fontFamily:'inherit',
                        boxSizing:'border-box' }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding:'14px 20px', borderTop:'1px solid var(--border)',
              background:'var(--bg-tertiary)', display:'flex', gap:10, flexShrink:0 }}>
              <button onClick={() => setView('menu')}
                style={{ flex:1, padding:'11px', background:'transparent',
                  border:'1px solid var(--border)', borderRadius:12, cursor:'pointer',
                  fontSize:13, fontFamily:'inherit', color:'var(--text-secondary)', fontWeight:600 }}>
                Cancelar
              </button>
              <button onClick={handleSave}
                disabled={testingConn === addType}
                style={{ flex:2, padding:'11px',
                  background:`linear-gradient(135deg,${platform.color},${platform.color}bb)`,
                  border:'none', borderRadius:12, color:'white', fontWeight:700,
                  cursor: testingConn === addType ? 'wait' : 'pointer',
                  fontSize:13, fontFamily:'inherit', opacity: testingConn === addType ? 0.6 : 1 }}>
                {testingConn === addType ? '⏳ Probando...' : 'Guardar integración'}
              </button>
            </div>
          </>
        )}

        {/* ── SYNC ─────────────────────────────────────────────────────────── */}
        {view === 'sync' && (
          <>
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              {[
                { label:'ZenDay',        value:matches.length,   color:'var(--accent-blue)' },
                { label:'Matches',       value:stats.matched,    color:'var(--accent-green)' },
                { label:'Diferencias',   value:stats.withDiff,   color:'var(--accent-amber)' },
                { label:'Seleccionados', value:stats.selected,   color:'#3b82f6' },
              ].map((s, i) => (
                <div key={s.label} style={{ flex:1, textAlign:'center', padding:'10px 0',
                  borderRight: i < 3 ? '1px solid var(--border)' : 'none',
                  background:'var(--bg-tertiary)' }}>
                  <div style={{ fontSize:18, fontWeight:800, color:s.color }}>{s.value}</div>
                  <div style={{ fontSize:10, color:'var(--text-tertiary)' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'12px 20px' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {matches.map(m => (
                  <div key={m.zenProduct.id}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
                      borderRadius:12, border:'1px solid var(--border)',
                      background: m.selected ? 'rgba(99,102,241,0.05)' : 'var(--bg-tertiary)',
                      opacity: m.matched ? 1 : 0.55 }}>
                    <input type="checkbox" checked={m.selected} disabled={!m.matched}
                      onChange={() => toggleSelected(m.zenProduct.id)}
                      style={{ width:15, height:15, flexShrink:0,
                        cursor: m.matched ? 'pointer' : 'not-allowed' }} />

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {m.zenProduct.name}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>
                        Stock: <strong style={{ color: m.zenProduct.stock > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {m.zenProduct.stock || 0} uds
                        </strong>
                      </div>
                    </div>

                    <span style={{ fontSize:13, color:'var(--text-tertiary)', flexShrink:0 }}>→</span>

                    <div style={{ flex:1, minWidth:0 }}>
                      <select value={m.extProduct?.externalId ?? ''}
                        onChange={e => changeMatch(m.zenProduct.id, e.target.value)}
                        style={{ width:'100%', padding:'4px 6px', borderRadius:8,
                          border:'1px solid var(--border)', background:'var(--bg-secondary)',
                          fontSize:11, fontFamily:'inherit', color:'var(--text-primary)' }}>
                        <option value="">— Sin match —</option>
                        {extProducts.map(ep => (
                          <option key={ep.externalId} value={ep.externalId}>{ep.name}</option>
                        ))}
                      </select>
                      {m.matched && (
                        <div style={{ fontSize:10, color:'var(--text-tertiary)', marginTop:2 }}>
                          Web: <strong style={{ color: m.stockDiff ? 'var(--accent-amber)' : 'var(--text-secondary)' }}>
                            {m.extProduct?.stock ?? '?'} uds {m.stockDiff ? '⚠️' : ''}
                          </strong>
                        </div>
                      )}
                    </div>

                    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:20,
                      flexShrink:0, fontWeight:700,
                      background: m.matched
                        ? m.score >= 0.95 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'
                        : 'rgba(239,68,68,0.10)',
                      color: m.matched                        ? m.score >= 0.95 ? 'var(--accent-green)' : 'var(--accent-amber)'
                        : 'var(--accent-red)' }}>
                      {m.matched
                        ? m.score >= 0.95 ? '✓ Exacto' : `~${Math.round(m.score*100)}%`
                        : 'Sin match'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding:'14px 20px', borderTop:'1px solid var(--border)',
              background:'var(--bg-tertiary)', display:'flex', gap:10, flexShrink:0 }}>
              <button onClick={() => setView('menu')}
                style={{ flex:1, padding:'11px', background:'transparent',
                  border:'1px solid var(--border)', borderRadius:12, cursor:'pointer',
                  fontSize:13, fontFamily:'inherit', color:'var(--text-secondary)', fontWeight:600 }}>
                Cancelar
              </button>
              <button onClick={handleSync}
                disabled={syncing || stats.selected === 0}
                style={{ flex:2, padding:'11px', borderRadius:12, border:'none', fontSize:13,
                  fontFamily:'inherit', fontWeight:700, color:'white',
                  cursor: stats.selected === 0 ? 'not-allowed' : 'pointer',
                  background: stats.selected === 0
                    ? 'var(--bg-tertiary)' : 'linear-gradient(135deg,#6366f1,#10b981)',
                  opacity: stats.selected === 0 ? .5 : 1 }}>
                {syncing
                  ? `⏳ Sincronizando ${syncProgress.current}/${syncProgress.total}...`
                  : `🔄 Sincronizar ${stats.selected} producto${stats.selected!==1?'s':''}`}
              </button>
            </div>
          </>
        )}

        {/* ── RESULTADO ────────────────────────────────────────────────────── */}
        {view === 'result' && syncResult && (
          <div style={{ flex:1, overflowY:'auto', padding:24 }}>
            <div style={{ textAlign:'center', marginBottom:20 }}>
              <span style={{ fontSize:48 }}>
                {syncResult.every(r => r.ok) ? '🎉' : syncResult.some(r => r.ok) ? '⚠️' : '❌'}
              </span>
              <h4 style={{ margin:'8px 0 4px', fontSize:18, fontWeight:800 }}>
                {syncResult.filter(r => r.ok).length} sincronizados
                {syncResult.some(r => !r.ok) && `, ${syncResult.filter(r => !r.ok).length} con error`}
              </h4>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {syncResult.map((r, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center',
                  justifyContent:'space-between', padding:'10px 14px', borderRadius:10,
                  background: r.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                  border:`1px solid ${r.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>
                    {r.ok ? '✅' : '❌'} {r.name}
                  </span>
                  {r.ok ? (
                    <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>
                      {r.before} → <strong style={{ color:'var(--accent-green)' }}>{r.after} uds</strong>
                    </span>
                  ) : (
                    <span style={{ fontSize:11, color:'var(--accent-red)' }}>{r.error}</span>
                  )}
                </div>
              ))}
            </div>
            <button onClick={close}
              style={{ marginTop:20, width:'100%', padding:'12px',
                background:'linear-gradient(135deg,#6366f1,#10b981)', border:'none',
                borderRadius:12, color:'white', fontWeight:700, cursor:'pointer',
                fontSize:14, fontFamily:'inherit' }}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      <button onClick={() => setIsOpen(true)}
        style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'10px 18px',
          background:'linear-gradient(135deg,#6366f1,#8b5cf6)', border:'none', borderRadius:40,
          color:'white', fontWeight:700, cursor:'pointer', fontSize:13, fontFamily:'inherit',
          boxShadow:'0 4px 12px rgba(99,102,241,0.3)' }}>
        🔌 Integraciones
        {saved.length > 0 && (
          <span style={{ background:'rgba(255,255,255,0.25)', borderRadius:20,
            padding:'1px 7px', fontSize:11 }}>
            {saved.length}
          </span>
        )}
      </button>
      {createPortal(panel, document.body)}
    </>
  )
}