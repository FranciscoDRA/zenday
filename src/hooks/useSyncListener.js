// src/hooks/useSyncListener.js
// Escucha cambios en integraciones y actualiza el stock en ZenDay
// También escucha /pedidos en Firebase y los importa como pagos pendientes

import { useEffect, useRef, useCallback } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

const STORAGE_KEY      = 'zenday-integrations-v2'
const PEDIDOS_IMPORTED = 'zenday-pedidos-importados'
const POLL_INTERVAL    = 30 * 1000  // 30 segundos
const PEDIDOS_INTERVAL = 30 * 1000  // 30 segundos

// ─── NORMALIZE PARA MATCHING ──────────────────────────────────────────────────

function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function matchScore(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  const wa = new Set(na.split(/\s+/))
  const wb = new Set(nb.split(/\s+/))
  const common = [...wa].filter(w => wb.has(w) && w.length > 2).length
  const total  = Math.max(wa.size, wb.size)
  return total > 0 ? common / total : 0
}

// ─── KEYS YA IMPORTADAS ───────────────────────────────────────────────────────

function getImportedKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(PEDIDOS_IMPORTED) || '[]')) }
  catch { return new Set() }
}

function addImportedKey(key) {
  try {
    const keys = getImportedKeys()
    keys.add(key)
    localStorage.setItem(PEDIDOS_IMPORTED, JSON.stringify([...keys]))
  } catch { /* sin espacio o storage no disponible: se ignora */ }
}

// ─── FETCH PEDIDOS DESDE FIREBASE ────────────────────────────────────────────

async function fetchPedidosFirebase(integration) {
  const c = integration.config
  if (!c?.databaseURL) return []
  try {
    const url      = `${c.databaseURL.replace(/\/$/, '')}/pedidos.json`
    const response = await window.electronAPI.fetchExternal(url)
    if (!response.ok || !response.data) return []
    if (typeof response.data !== 'object') return []
    return Object.entries(response.data)
      .filter(([, val]) => val && typeof val === 'object' && val.estado === 'aprobado')
      .map(([key, val]) => ({ key, ...val }))
  } catch (err) {
    console.warn('[Sync] Error fetching pedidos:', err.message)
    return []
  }
}

// ─── CONVERTIR PEDIDO → APPOINTMENTS ─────────────────────────────────────────

function pedidoToAppointments(pedido) {
  const cliente  = pedido.datosCliente || {}
  const carrito  = pedido.carrito || []
  const nombre   = `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() || 'Cliente web'
  const telefono = cliente.telefono || cliente.phone || ''
  const envio    = cliente.envio || 'retiro'
  const direccion= cliente.direccion || ''
  const nota     = envio === 'retiro' ? 'Retiro en local' : `Envío a ${direccion}`

  return carrito.map((item, i) => ({
    id:              `mp-${pedido.key}-${i}-${Date.now()}`,
    patientName:     nombre,
    patientId:       null,
    patientPhone:    telefono,
    productName:     item.nombre || item.name || 'Producto web',
    productId:       null,
    price:           Number(item.precio || item.price || 0) * Number(item.cantidad || item.quantity || 1),
    quantity:        Number(item.cantidad || item.quantity) || 1,
    startTime:       pedido.fechaPago || pedido.fechaRegistro || new Date().toISOString(),
    status:          'delivered',
    paid:            true,
    fromWeb:         true,
    fromMercadoPago: true,
    paymentId:       pedido.paymentId,
    externalRef:     pedido.key,
    notes:           `Pedido web MP #${pedido.paymentId || pedido.key} — ${nota}`,
    createdAt:       new Date().toISOString(),
  }))
}

// ─── FETCH STOCK EXTERNO ──────────────────────────────────────────────────────

async function fetchExternalStock(integration) {
  const c = integration.config
  if (!c) return []
  try {
    switch (integration.type) {
      case 'firebase': {
        const url = `${c.databaseURL.replace(/\/$/, '')}/${c.path || 'productos'}.json`
        const response = await window.electronAPI.fetchExternal(url)
        if (!response.ok || !response.data) return []
        return Object.entries(response.data)
          .filter(([, val]) => val !== null && typeof val === 'object')
          .map(([key, val]) => ({
            externalId:  key,
            name:        val[c.nameField  || 'nombre'] || key,
            stock:       Number(val[c.stockField || 'stock']) || 0,
            price:       Number(val.precio || val.price) || 0,
            description: val.descripcion || val.description || '',
            imagenes:    Array.isArray(val.imagenes) 
                           ? val.imagenes.filter(img => typeof img === 'string' && img.trim())
                           : (val.imagen ? [val.imagen] : []),
            category:    val.categoria || val.category || '',
          }))
      }
      case 'woocommerce': {
        const auth     = btoa(`${c.consumerKey}:${c.consumerSecret}`)
        const response = await window.electronAPI.fetchExternal(
          `${c.siteURL.replace(/\/$/, '')}/wp-json/wc/v3/products?per_page=100`,
          { headers: { Authorization: `Basic ${auth}` } }
        )
        if (!response.ok || !Array.isArray(response.data)) return []
        return response.data.map(p => ({ 
          externalId: String(p.id), 
          name: p.name, 
          stock: Number(p.stock_quantity) || 0,
          price: Number(p.price) || 0,
          imagenes: p.images?.map(img => img.src) || [],
          description: p.short_description || p.description || '',
        }))
      }
      case 'shopify': {
        const response = await window.electronAPI.fetchExternal(
          `https://${c.shopName}.myshopify.com/admin/api/2024-01/products.json?limit=250`,
          { headers: { 'X-Shopify-Access-Token': c.apiKey } }
        )
        if (!response.ok || !response.data?.products) return []
        return response.data.products.map(p => ({
          externalId: String(p.id), 
          name: p.title,
          stock: p.variants?.reduce((s, v) => s + (v.inventory_quantity || 0), 0) || 0,
          price: Number(p.variants?.[0]?.price) || 0,
          imagenes: p.images?.map(img => img.src) || [],
          description: p.body_html || '',
        }))
      }
      case 'mercadolibre': {
        const response = await window.electronAPI.fetchExternal(
          `https://api.mercadolibre.com/users/${c.sellerId}/items/search?limit=50`,
          { headers: { Authorization: `Bearer ${c.accessToken}` } }
        )
        if (!response.ok) return []
        const ids   = response.data?.results || []
        const items = await Promise.all(
          ids.slice(0, 50).map(id =>
            window.electronAPI.fetchExternal(`https://api.mercadolibre.com/items/${id}`, {
              headers: { Authorization: `Bearer ${c.accessToken}` },
            }).then(r => r.ok ? r.data : null).catch(() => null)
          )
        )
        return items.filter(Boolean).map(p => ({
          externalId: String(p.id), 
          name: p.title, 
          stock: Number(p.available_quantity) || 0,
          price: Number(p.price) || 0,
          imagenes: p.pictures?.map(pic => pic.url) || [],
          description: p.description || '',
        }))
      }
      case 'rest': {
        const headers = {}
        if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`
        const response = await window.electronAPI.fetchExternal(
          `${c.baseURL}${c.productsEndpoint || '/products'}`, { headers }
        )
        if (!response.ok) return []
        const list = Array.isArray(response.data)
          ? response.data
          : (response.data?.products || response.data?.items || [])
        return list.map(p => ({
          externalId: String(p[c.idField || 'id'] || ''),
          name:       p[c.nameField || 'name'] || '',
          stock:      Number(p[c.stockField || 'stock']) || 0,
          price:      Number(p.price) || 0,
          imagenes:   p.images || (p.image ? [p.image] : []),
          description: p.description || '',
        }))
      }
      default: return []
    }
  } catch (err) {
    console.warn(`[Sync] Error fetching stock ${integration.name}:`, err.message)
    return []
  }
}

// ─── APLICAR CAMBIOS DE STOCK (con imágenes) ─────────────────────────────────

function applyStockChanges(zenProducts, externalList, setProducts, onChanges) {
  if (!Array.isArray(zenProducts) || !Array.isArray(externalList)) return
  if (!zenProducts.length || !externalList.length) return

  let hasChanges = false
  const changes  = []

  const updated = zenProducts.map(zen => {
    let best = null, bestScore = 0
    externalList.forEach(ext => {
      if (!ext.name) return
      const score = matchScore(zen.name, ext.name)
      if (score > bestScore) { bestScore = score; best = ext }
    })
    if (!best || bestScore < 0.7) return zen
    
    // Detectar cualquier cambio (stock o imágenes)
    const stockChanged = best.stock !== zen.stock
    const imageChanged = best.imagenes?.length > 0 && 
      JSON.stringify(best.imagenes) !== JSON.stringify(zen.imagenes)
    
    if (!stockChanged && !imageChanged) return zen
    
    hasChanges = true
    if (stockChanged) {
      changes.push({ name: zen.name, before: zen.stock, after: best.stock })
    }
    
    return { 
      ...zen, 
      stock: best.stock,
      ...(best.price > 0 && { price: best.price }),
      ...(imageChanged && { imagenes: best.imagenes }),
      ...(best.description && { description: best.description }),
    }
  })

  if (hasChanges) {
    setProducts(updated)
    if (onChanges) onChanges(changes)
  }
}

// ─── HOOK PRINCIPAL ───────────────────────────────────────────────────────────

export function useSyncListener({ products, setProducts, setAppointments, onChanges, onNewOrder }) {
  const pollTimersRef   = useRef({})
  const pedidosTimerRef = useRef(null)
  const productsRef     = useRef(products)
  const isMountedRef    = useRef(true)

  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // ── Polling de pedidos ────────────────────────────────────────────────────
  const startPedidosPolling = useCallback((integration) => {
    if (pedidosTimerRef.current) clearInterval(pedidosTimerRef.current)

    const poll = async () => {
      if (!isMountedRef.current) return
      try {
        const pedidos  = await fetchPedidosFirebase(integration)
        if (!pedidos.length) return

        const imported = getImportedKeys()
        const nuevos   = pedidos.filter(p => !imported.has(p.key))
        if (!nuevos.length) return

        const appointments = nuevos.flatMap(pedidoToAppointments)

        if (setAppointments && appointments.length > 0) {
          setAppointments(prev => {
            const arr          = Array.isArray(prev) ? prev : []
            const existingRefs = new Set(arr.map(a => a.externalRef).filter(Boolean))
            const toAdd        = appointments.filter(a => !existingRefs.has(a.externalRef))
            return toAdd.length > 0 ? [...arr, ...toAdd] : arr
          })
        }

        nuevos.forEach(p => addImportedKey(p.key))

        if (onNewOrder) {
          nuevos.forEach(pedido => {
            const cliente = pedido.datosCliente || {}
            const nombre  = `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() || 'Cliente web'
            onNewOrder({
              nombre,
              monto:     pedido.monto,
              productos: (pedido.carrito || []).map(i => i.nombre || i.name).join(', '),
              pedidoKey: pedido.key,
            })
          })
        }

        console.log(`[Sync] 🛒 ${nuevos.length} pedido(s) importado(s) desde web`)
      } catch (err) {
        console.warn('[Sync] Error polling pedidos:', err.message)
      }
    }

    poll()
    pedidosTimerRef.current = setInterval(poll, PEDIDOS_INTERVAL)
    console.log('[Sync] 🛒 Escuchando pedidos web (cada 30s)')
  }, [setAppointments, onNewOrder])

  // ── Polling de stock (con soporte para tiempo real en Firebase) ───────────
  const startPolling = useCallback((integration) => {
    // Limpiar timer existente si hay
    if (pollTimersRef.current[integration.id]) {
      clearInterval(pollTimersRef.current[integration.id])
      delete pollTimersRef.current[integration.id]
    }

    // ── TIEMPO REAL PARA FIREBASE ──────────────────────────────
    if (integration.type === 'firebase' && integration.config?.databaseURL) {
      const c = integration.config
      
      // Verificar si es el mismo proyecto Firebase de ZenDay
      const isZenDayFirebase = c.databaseURL === 'https://zenday-297b3-default-rtdb.firebaseio.com' ||
                                c.useInternalFirebase === true
      
      if (isZenDayFirebase && db) {
        const productosRef = ref(db, c.path || 'productos')
        const unsub = onValue(productosRef, (snapshot) => {
          if (!isMountedRef.current) return
          if (!snapshot.exists()) return
          
          const data = snapshot.val()
          const externalList = Object.entries(data)
            .filter(([, val]) => val !== null && typeof val === 'object')
            .map(([key, val]) => ({
              externalId:  key,
              name:        val[c.nameField || 'nombre'] || key,
              stock:       Number(val[c.stockField || 'stock']) || 0,
              price:       Number(val.precio || val.price) || 0,
              description: val.descripcion || val.description || '',
              imagenes:    Array.isArray(val.imagenes) 
                             ? val.imagenes.filter(img => typeof img === 'string' && img.trim())
                             : (val.imagen ? [val.imagen] : []),
              category:    val.categoria || val.category || '',
            }))

          applyStockChanges(
            productsRef.current,
            externalList,
            setProducts,
            (changes) => { 
              if (onChanges) onChanges(integration.name, changes, 'realtime') 
            }
          )
        }, (error) => {
          console.warn(`[Sync] Firebase error: ${integration.name}`, error.message)
        })

        // Guardar la función de cleanup
        pollTimersRef.current[`${integration.id}-realtime`] = unsub
        console.log(`[Sync] ⚡ Listener en tiempo real: ${integration.name}`)
        return
      }
    }

    // ── POLLING PARA OTROS TIPOS ────────────────────────────────
    const poll = async () => {
      if (!isMountedRef.current) return
      try {
        const externalList = await fetchExternalStock(integration)
        if (!externalList.length) return
        applyStockChanges(
          productsRef.current,
          externalList,
          setProducts,
          (changes) => { if (onChanges) onChanges(integration.name, changes, 'poll') }
        )
      } catch (err) {
        console.warn(`[Sync] ⚠️ Error polling ${integration.name}:`, err.message)
      }
    }

    poll()
    pollTimersRef.current[integration.id] = setInterval(poll, POLL_INTERVAL)
    console.log(`[Sync] ⏱️ Polling iniciado: ${integration.name} (cada 30s)`)
  }, [setProducts, onChanges])

  // ── Efecto principal ──────────────────────────────────────────────────────
  useEffect(() => {
    const integrations = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
    })()

    integrations.forEach(integration => {
      startPolling(integration)
      if (integration.type === 'firebase') startPedidosPolling(integration)
    })

    return () => {
      // Limpiar timers y listeners en tiempo real
      Object.entries(pollTimersRef.current).forEach(([, val]) => {
        if (typeof val === 'function') {
          val() // unsubscribe de onValue
        } else {
          clearInterval(val)
        }
      })
      if (pedidosTimerRef.current) clearInterval(pedidosTimerRef.current)
      pollTimersRef.current  = {}
      pedidosTimerRef.current = null
    }
  }, [startPolling, startPedidosPolling])

  // ── Reconectar ────────────────────────────────────────────────────────────
  const reconnect = useCallback(() => {
    // Limpiar todo
    Object.entries(pollTimersRef.current).forEach(([, val]) => {
      if (typeof val === 'function') {
        val() // unsubscribe de onValue
      } else {
        clearInterval(val)
      }
    })
    if (pedidosTimerRef.current) clearInterval(pedidosTimerRef.current)
    pollTimersRef.current  = {}
    pedidosTimerRef.current = null

    // Reiniciar
    const integrations = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
    })()

    integrations.forEach(integration => {
      startPolling(integration)
      if (integration.type === 'firebase') startPedidosPolling(integration)
    })
  }, [startPolling, startPedidosPolling])

  return { reconnect }
}