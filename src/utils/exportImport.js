import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { newId, todayKey, texto } from './helpers'

// ========== FUNCIONES DE DETECCIÓN DE DUPLICADOS ==========

export function detectDuplicates(importedProducts, existingProducts) {
  const duplicates = []
  const newProducts = []
  
  // 👈 USAR ID COMO PRIORIDAD
  const existingIds = new Set()
  const existingCodes = new Set()
  const existingNames = new Set()
  
  existingProducts.forEach(p => {
    if (p.id) existingIds.add(String(p.id))
    // Los que ya estan guardados pueden traer code/name numericos de un Excel
    // importado antes de que esto se arreglara.
    if (p.code) existingCodes.add(texto(p.code).toLowerCase())
    if (p.name) existingNames.add(texto(p.name).toLowerCase())
  })
  
  importedProducts.forEach(product => {
    // 👈 PRIMERO VERIFICAR POR ID
    const idDuplicate = product.id && existingIds.has(String(product.id))
    const codeDuplicate = !idDuplicate && product.code && existingCodes.has(texto(product.code).toLowerCase())
    const nameDuplicate = !idDuplicate && !codeDuplicate && product.name && existingNames.has(texto(product.name).toLowerCase())
    
    if (idDuplicate || codeDuplicate || nameDuplicate) {
      duplicates.push({
        ...product,
        duplicateReason: idDuplicate ? 'ID duplicado' : (codeDuplicate ? 'Código duplicado' : 'Nombre duplicado'),
        existingProduct: existingProducts.find(p => 
          (idDuplicate && String(p.id) === String(product.id)) ||
          (codeDuplicate && p.code === product.code) || 
          (nameDuplicate && p.name === product.name)
        )
      })
    } else {
      newProducts.push(product)
    }
  })
  
  return { duplicates, newProducts }
}

export function mergeProductsWithStock(importedProducts, existingProducts) {
  const updatedProducts = [...existingProducts]
  const mergedCount = []
  
  importedProducts.forEach(imported => {
    // 👈 BUSCAR POR ID PRIMERO, LUEGO POR CÓDIGO, LUEGO POR NOMBRE
    const existingIndex = existingProducts.findIndex(p => 
      (imported.id && String(p.id) === String(imported.id)) ||
      (imported.code && p.code === imported.code) || 
      (imported.name && p.name === imported.name)
    )
    
    if (existingIndex !== -1) {
      const oldStock = updatedProducts[existingIndex].stock || 0
      const newStock = oldStock + (imported.stock || 0)
      updatedProducts[existingIndex] = {
        ...updatedProducts[existingIndex],
        stock: newStock,
        price: imported.price || updatedProducts[existingIndex].price,
        updatedAt: new Date().toISOString()
      }
      mergedCount.push({
        name: imported.name,
        oldStock,
        addedStock: imported.stock || 0,
        newStock
      })
    } else {
      updatedProducts.push({
        ...imported,
        id: imported.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString()
      })
    }
  })
  
  return { updatedProducts, mergedCount }
}

// ========== FUNCIONES DE IMPORTACIÓN ==========

export async function importProductsFromExcel(file, existingProducts = []) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet)
        
        console.log('📊 Columnas detectadas:', Object.keys(rows[0] || {}))
        
        const products = []
        for (const row of rows) {
          // ✅ GENERAR UN ID NUEVO SIEMPRE para evitar duplicados
          // El ID del Excel se ignora completamente
          const nuevoId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
          
          const product = {
            // ✅ ID SIEMPRE NUEVO, NUNCA usar el del Excel
            id: nuevoId,
            // Un codigo de articulo tipo 100245 entra como numero y despues
            // rompe la busqueda del panel. price y stock NO se tocan: ahi el
            // numero es lo que corresponde.
            name: texto(row['nombre'] || row['Nombre'] || row['NOMBRE'] || row['name'] || row['Name']),
            code: texto(row['codigo'] || row['Código'] || row['CODIGO'] || row['code'] || row['Code']),
            price: parseFloat(row['precio'] || row['Precio'] || row['PRECIO'] || row['price'] || row['Price'] || 0),
            stock: parseInt(row['stock'] || row['Stock'] || row['STOCK'] || 0),
            description: texto(row['descripcion'] || row['Descripción'] || row['DESCRIPCION'] || row['description'] || row['Description']),
            createdAt: new Date().toISOString()
          }
          
          // Validar que tenga al menos nombre
          if (texto(product.name) !== '') {
            products.push(product)
          } else {
            console.warn('⚠️ Fila ignorada: falta nombre', row)
          }
        }
        
        console.log('📦 Productos encontrados:', products.length)
        console.log('✅ Todos los productos tienen IDs nuevos y únicos')
        
        if (products.length === 0) {
          reject(new Error('No se encontraron productos. Asegúrate de que la columna "nombre" exista.'))
          return
        }
        
        const { duplicates, newProducts } = detectDuplicates(products, existingProducts)
        
        resolve({
          success: true,
          products: newProducts,
          duplicates: duplicates,
          totalImported: products.length,
          newCount: newProducts.length,
          duplicateCount: duplicates.length
        })
        
      } catch (error) {
        console.error('Error:', error)
        reject(error)
      }
    }
    
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

export async function importPatientsFromExcel(file, existingPatients = []) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet)
        
        const patients = []
        for (const row of rows) {
          // ✅ Para pacientes también generamos ID nuevo si no viene o si queremos evitar duplicados
          const patient = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`,
            // texto() en CADA campo. Sin esto, una celda de Excel con solo
            // digitos entra como NUMERO: el telefono 099412887 se guarda como
            // 99412887 y despues cualquier .trim() sobre el revienta. Ese es el
            // origen del error que rompia el alta de clientes.
            name:         texto(row['Nombre'] || row['nombre'] || row['NAME']),
            phone:        texto(row['Teléfono'] || row['telefono'] || row['PHONE']),
            email:        texto(row['Email'] || row['email'] || row['EMAIL']),
            address:      texto(row['Dirección'] || row['direccion'] || row['ADDRESS']),
            birthDate:    texto(row['Fecha Nacimiento'] || row['fecha_nacimiento']),
            observations: texto(row['Observaciones'] || row['observaciones']),
            createdAt: new Date().toISOString()
          }
          
          if (texto(patient.name) !== '') {
            patients.push(patient)
          }
        }
        
        resolve({
          success: true,
          patients: patients,
          totalImported: patients.length
        })
        
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

// ========== FUNCIONES DE EXPORTACIÓN ==========

// Plantillas
export function downloadProductTemplate() {
  const template = [
    ['nombre', 'codigo', 'precio', 'stock', 'descripcion'],
    ['Ej: Camiseta básica', 'PROD-001', 500, 10, 'Camiseta de algodón 100%'],
    ['Ej: Pantalón jeans', 'PROD-002', 1200, 5, 'Jeans azul clásico'],
    ['Ej: Zapatillas', 'PROD-003', 2500, 3, 'Zapatillas deportivas'],
  ]
  
  const ws = XLSX.utils.aoa_to_sheet(template)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Productos')
  XLSX.writeFile(wb, 'plantilla_productos.xlsx')
}

export function downloadPatientTemplate() {
  const template = [
    ['nombre', 'telefono', 'email', 'direccion', 'fecha_nacimiento', 'observaciones'],
    ['Ej: Juan Pérez', '099123456', 'juan@email.com', 'Av. Italia 123', '1990-05-15', 'Cliente regular'],
    ['Ej: María García', '098765432', 'maria@email.com', 'Calle Principal 456', '1985-12-20', ''],
  ]
  
  const ws = XLSX.utils.aoa_to_sheet(template)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
  XLSX.writeFile(wb, 'plantilla_clientes.xlsx')
}

// Exportar Productos
export function exportProductsToExcel(products) {
  const data = products.map(p => [
    p.name,
    p.code || '',
    p.price,
    p.stock || 0,
    p.description || ''
  ])
  
  const headers = [['Nombre', 'Código', 'Precio', 'Stock', 'Descripción']]
  const wsData = [...headers, ...data]
  
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Productos')
  XLSX.writeFile(wb, `productos_${todayKey()}.xlsx`)
}

export function exportProductsToPDF(products) {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Lista de Productos', 14, 22)
  doc.setFontSize(10)
  doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 32)
  
  const tableData = products.map(p => [
    p.name,
    p.code || '-',
    `$${p.price.toLocaleString()}`,
    p.stock || 0,
    p.description?.substring(0, 30) || '-'
  ])
  
  autoTable(doc, {
    head: [['Nombre', 'Código', 'Precio', 'Stock', 'Descripción']],
    body: tableData,
    startY: 40,
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
    margin: { top: 40 }
  })
  
  doc.save(`productos_${todayKey()}.pdf`)
}

// Exportar Pacientes
export function exportPatientsToExcel(patients) {
  const data = patients.map(p => [
    p.name,
    p.phone || '',
    p.email || '',
    p.address || '',
    p.birthDate || '',
    p.observations || ''
  ])
  
  const headers = [['Nombre', 'Teléfono', 'Email', 'Dirección', 'Fecha Nacimiento', 'Observaciones']]
  const wsData = [...headers, ...data]
  
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
  XLSX.writeFile(wb, `clientes_${todayKey()}.xlsx`)
}

export function exportPatientsToPDF(patients) {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Lista de Clientes', 14, 22)
  doc.setFontSize(10)
  doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 32)
  
  const tableData = patients.map(p => [
    p.name,
    p.phone || '-',
    p.email || '-',
    p.address?.substring(0, 30) || '-'
  ])
  
  autoTable(doc, {
    head: [['Nombre', 'Teléfono', 'Email', 'Dirección']],
    body: tableData,
    startY: 40,
    theme: 'striped',
    headStyles: { fillColor: [99, 102, 241] },
    margin: { top: 40 }
  })
  
  doc.save(`clientes_${todayKey()}.pdf`)
}

// Exportar Citas (Appointments)
export function exportAppointmentsToExcel(appointments) {
  const data = appointments.map(a => [
    a.id || '',
    a.patientName || '',
    new Date(a.startTime).toLocaleString(),
    new Date(a.endTime).toLocaleString(),
    a.status || '',
    a.paid ? 'Pagado' : 'Pendiente',
    `$${a.price?.toLocaleString() || 0}`,
    a.productName || '',
    a.notes || ''
  ])
  
  const headers = [['ID', 'Cliente', 'Fecha Inicio', 'Fecha Fin', 'Estado', 'Pago', 'Precio', 'Producto', 'Notas']]
  const wsData = [...headers, ...data]
  
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Citas')
  XLSX.writeFile(wb, `citas_${todayKey()}.xlsx`)
}

export function exportAppointmentsToPDF(appointments) {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.setTextColor(99, 102, 241)
  doc.text('Listado de Citas', 14, 22)
  
  doc.setFontSize(10)
  doc.setTextColor(100, 100, 100)
  doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 32)
  
  // Citas del día de hoy
  const today = new Date().toDateString()
  const todayAppointments = appointments.filter(a => 
    new Date(a.startTime).toDateString() === today && a.status !== 'cancelled'
  )
  
  if (todayAppointments.length > 0) {
    doc.setFontSize(12)
    doc.setTextColor(0, 0, 0)
    doc.text('Citas de hoy:', 14, 50)
    
    const todayData = todayAppointments.map(a => [
      a.patientName || '-',
      new Date(a.startTime).toLocaleTimeString(),
      a.status || '-'
    ])
    
    autoTable(doc, {
      head: [['Cliente', 'Hora', 'Estado']],
      body: todayData,
      startY: 55,
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] }
    })
  }
  
  // Próximas citas
  const upcomingAppointments = appointments
    .filter(a => new Date(a.startTime) > new Date() && a.status !== 'cancelled')
    .slice(0, 15)
    .map(a => [
      a.patientName || '-',
      new Date(a.startTime).toLocaleDateString(),
      new Date(a.startTime).toLocaleTimeString(),
      a.status || '-'
    ])
  
  if (upcomingAppointments.length > 0) {
    const startY = todayAppointments.length > 0 ? doc.lastAutoTable.finalY + 15 : 55
    doc.text('Próximas citas:', 14, startY)
    
    autoTable(doc, {
      head: [['Cliente', 'Fecha', 'Hora', 'Estado']],
      body: upcomingAppointments,
      startY: startY + 5,
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] }
    })
  }
  
  // Resumen de estados
  const totalAppointments = appointments.length
  const completed = appointments.filter(a => a.status === 'completed' || a.status === 'delivered').length
  const pending = appointments.filter(a => a.status === 'pending' || a.status === 'scheduled').length
  const cancelled = appointments.filter(a => a.status === 'cancelled').length
  
  const finalY = (upcomingAppointments.length > 0 || todayAppointments.length > 0) 
    ? (doc.lastAutoTable?.finalY || 150) + 15 
    : 70
  
  doc.text('Resumen:', 14, finalY)
  doc.setFontSize(10)
  doc.text(`Total de citas: ${totalAppointments}`, 14, finalY + 10)
  doc.text(`Completadas: ${completed}`, 14, finalY + 18)
  doc.text(`Pendientes: ${pending}`, 14, finalY + 26)
  doc.text(`Canceladas: ${cancelled}`, 14, finalY + 34)
  
  doc.save(`citas_${todayKey()}.pdf`)
}

// Exportar Reporte Financiero
export function exportFinancialToPDF(appointments, stats) {
  const doc = new jsPDF()
  
  doc.setFontSize(20)
  doc.setTextColor(99, 102, 241)
  doc.text('Reporte Financiero', 14, 22)
  
  doc.setFontSize(10)
  doc.setTextColor(100, 100, 100)
  doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 32)
  
  doc.setFontSize(14)
  doc.setTextColor(0, 0, 0)
  doc.text('Resumen del día', 14, 50)
  
  doc.setFontSize(11)
  const statsData = [
    ['Total de citas:', stats?.todayTotal || 0],
    ['Citas completadas:', stats?.todayCompleted || 0],
    ['Citas pendientes:', stats?.todayPending || 0],
    ['Ingresos del día:', `$${(stats?.revenueToday || 0).toLocaleString()}`],
    ['Total clientes:', stats?.totalPatients || 0]
  ]
  
  autoTable(doc, {
    body: statsData,
    startY: 55,
    theme: 'plain',
    styles: { fontSize: 11 },
    columnStyles: { 0: { fontStyle: 'bold' } }
  })
  
  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()
  const monthlyIncome = appointments
    .filter(a => {
      const date = new Date(a.startTime)
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear && a.paid
    })
    .reduce((sum, a) => sum + (a.price || 0), 0)
  
  doc.text(`Ingresos del mes: $${monthlyIncome.toLocaleString()}`, 14, doc.lastAutoTable.finalY + 15)
  
  const upcomingAppointments = appointments
    .filter(a => new Date(a.startTime) >= new Date() && a.status !== 'cancelled')
    .slice(0, 10)
    .map(a => [
      a.patientName || '-',
      new Date(a.startTime).toLocaleDateString(),
      new Date(a.startTime).toLocaleTimeString(),
      a.status || '-'
    ])
  
  if (upcomingAppointments.length > 0) {
    doc.text('Próximas citas', 14, doc.lastAutoTable.finalY + 30)
    autoTable(doc, {
      head: [['Cliente', 'Fecha', 'Hora', 'Estado']],
      body: upcomingAppointments,
      startY: doc.lastAutoTable.finalY + 35,
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] }
    })
  }
  
  doc.save(`reporte_financiero_${todayKey()}.pdf`)
}

// ========== FUNCIONES PARA MANEJAR ARCHIVOS DE CLIENTES ==========

// ═══════════════════════════════════════════════════════════════════════════
//  ADJUNTOS DE CLIENTES
//
//  ANTES: cada archivo se guardaba como base64 dentro de localStorage.
//  base64 infla ~33% y localStorage tiene un tope de 5-10 MB COMPARTIDO con
//  pedidos, clientes y gastos. Dos PDFs de 2 MB y la app dejaba de guardar
//  TODO, en silencio.
//
//  AHORA: en Electron los archivos van al disco (electron/documentStore.cjs).
//  Fuera de Electron —el navegador, con `npm run dev`— se mantiene el esquema
//  viejo como respaldo, para que la app siga funcionando igual.
//
//  Las cuatro funciones pasaron a ser async. Los metadatos ya NO incluyen el
//  campo `data`: los bytes se leen recién cuando se abre o se descarga.
// ═══════════════════════════════════════════════════════════════════════════

const enElectron = () => typeof window !== 'undefined' && !!window.electronAPI?.docsList
const claveVieja = (patientId) => `client_documents_${patientId}`

function leerLocal(patientId) {
  try { return JSON.parse(localStorage.getItem(claveVieja(patientId)) || '[]') }
  catch { return [] }
}

/**
 * Migra a disco los adjuntos que hayan quedado en localStorage.
 * Sólo borra la clave si el proceso principal confirmó que TODOS los archivos
 * quedaron escritos y verificados. Ante cualquier falla, no se toca nada:
 * preferible seguir con la cuota apretada que perder el estudio de un paciente.
 */
export async function migrateClientDocuments(patientId) {
  if (!enElectron()) return { migrados: 0 }
  const viejos = leerLocal(patientId)
  if (viejos.length === 0) return { migrados: 0 }

  try {
    const res = await window.electronAPI.docsMigrate(patientId, viejos)
    if (res?.ok && res.puedeBorrarse) {
      localStorage.removeItem(claveVieja(patientId))
      console.log(`[Documentos] ${res.migrados} adjuntos de ${patientId} movidos al disco`)
    } else {
      console.warn(`[Documentos] Migración incompleta de ${patientId}: se conserva la copia local`)
    }
    return res || { migrados: 0 }
  } catch (err) {
    console.error('[Documentos] Error migrando:', err)
    return { migrados: 0, error: err.message }
  }
}

export async function getClientDocuments(patientId) {
  if (enElectron()) {
    await migrateClientDocuments(patientId)
    try { return await window.electronAPI.docsList(patientId) }
    catch (err) { console.error('[Documentos] Error listando:', err); return [] }
  }
  return leerLocal(patientId).map(({ data, ...meta }) => meta)
}

export async function deleteClientDocument(patientId, documentId) {
  if (enElectron()) {
    try {
      const res = await window.electronAPI.docsDelete(patientId, documentId)
      return res?.docs || []
    } catch (err) { console.error('[Documentos] Error borrando:', err); return [] }
  }
  const documents = leerLocal(patientId)
  const filtered = documents.filter(d => String(d.id) !== String(documentId))
  localStorage.setItem(claveVieja(patientId), JSON.stringify(filtered))
  return filtered.map(({ data, ...meta }) => meta)
}

/** Borra todos los adjuntos de un cliente. Se llama al eliminar el cliente. */
export async function deleteAllClientDocuments(patientId) {
  if (enElectron()) {
    try { await window.electronAPI.docsDeleteAll(patientId) } catch (err) { console.error(err) }
  }
  try { localStorage.removeItem(claveVieja(patientId)) } catch { /* ignorar */ }
}

/** Devuelve el data: URL de un adjunto. Se lee del disco recién acá. */
export async function readClientDocument(patientId, documentId) {
  if (enElectron()) {
    try {
      const res = await window.electronAPI.docsRead(patientId, documentId)
      return res?.ok ? res.dataUrl : null
    } catch (err) { console.error('[Documentos] Error leyendo:', err); return null }
  }
  const doc = leerLocal(patientId).find(d => String(d.id) === String(documentId))
  return doc?.data || null
}

export async function downloadClientDocument(doc, patientId) {
  if (typeof window === 'undefined' || !window.document) return

  const dataUrl = doc.data || (patientId ? await readClientDocument(patientId, doc.id) : null)
  if (!dataUrl) { console.error('[Documentos] No se pudo obtener el archivo'); return }

  const link = window.document.createElement('a')
  link.href = dataUrl
  link.download = doc.name
  window.document.body.appendChild(link)
  link.click()
  window.document.body.removeChild(link)
}

// ✅ CORREGIDO: El parámetro ya no se llama "document" para no sobreescribir el DOM global
export function saveClientDocument(patientId, file, documentType = 'generic') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (e) => {
      const meta = {
        id: newId(),
        name: file.name,
        type: documentType,
        size: file.size,
        mimeType: file.type,
        uploadDate: new Date().toISOString(),
      }

      // En Electron el archivo va al disco: no consume la cuota de localStorage.
      if (typeof window !== 'undefined' && window.electronAPI?.docsSave) {
        try {
          const res = await window.electronAPI.docsSave(patientId, meta, e.target.result)
          if (!res?.ok) return reject(new Error(res?.error || 'No se pudo guardar el archivo'))
          return resolve(res.doc)
        } catch (err) {
          return reject(new Error(err?.message || 'No se pudo guardar el archivo'))
        }
      }

      // Respaldo para el navegador (npm run dev): esquema viejo, con el aviso
      // de cuota que antes no existía.
      try {
        const key = `client_documents_${patientId}`
        let documents = []
        try { documents = JSON.parse(localStorage.getItem(key) || '[]') } catch { documents = [] }

        if (documents.some(d => d.name === file.name)) {
          return reject(new Error(`Ya existe un documento llamado "${file.name}"`))
        }

        const newDoc = { ...meta, data: e.target.result }
        documents.push(newDoc)

        try {
          localStorage.setItem(key, JSON.stringify(documents))
        } catch (err) {
          const cuota = err?.name === 'QuotaExceededError' || err?.code === 22
          return reject(new Error(cuota
            ? 'No hay espacio en el navegador para este archivo. En la app de escritorio los adjuntos van al disco y no tienen este límite.'
            : 'No se pudo guardar el archivo.'))
        }

        resolve(newDoc)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsDataURL(file)
  })
}

export async function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet)
        resolve(rows)
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

export async function readCSVFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const rows = text.split('\n').map(line => line.split(','))
        const headers = rows[0]
        const data = rows.slice(1).map(row => {
          const obj = {}
          headers.forEach((header, i) => {
            obj[header.trim()] = row[i]?.trim() || ''
          })
          return obj
        })
        resolve(data)
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = () => reject(new Error('Error al leer el archivo CSV'))
    reader.readAsText(file)
  })
}