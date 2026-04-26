import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
    if (p.code) existingCodes.add(p.code.toLowerCase())
    if (p.name) existingNames.add(p.name.toLowerCase())
  })
  
  importedProducts.forEach(product => {
    // 👈 PRIMERO VERIFICAR POR ID
    const idDuplicate = product.id && existingIds.has(String(product.id))
    const codeDuplicate = !idDuplicate && product.code && existingCodes.has(product.code.toLowerCase())
    const nameDuplicate = !idDuplicate && !codeDuplicate && product.name && existingNames.has(product.name.toLowerCase())
    
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
            name: row['nombre'] || row['Nombre'] || row['NOMBRE'] || row['name'] || row['Name'] || '',
            code: row['codigo'] || row['Código'] || row['CODIGO'] || row['code'] || row['Code'] || '',
            price: parseFloat(row['precio'] || row['Precio'] || row['PRECIO'] || row['price'] || row['Price'] || 0),
            stock: parseInt(row['stock'] || row['Stock'] || row['STOCK'] || 0),
            description: row['descripcion'] || row['Descripción'] || row['DESCRIPCION'] || row['description'] || row['Description'] || '',
            createdAt: new Date().toISOString()
          }
          
          // Validar que tenga al menos nombre
          if (product.name && product.name.trim() !== '') {
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
            name: row['Nombre'] || row['nombre'] || row['NAME'] || '',
            phone: row['Teléfono'] || row['telefono'] || row['PHONE'] || '',
            email: row['Email'] || row['email'] || row['EMAIL'] || '',
            address: row['Dirección'] || row['direccion'] || row['ADDRESS'] || '',
            birthDate: row['Fecha Nacimiento'] || row['fecha_nacimiento'] || '',
            observations: row['Observaciones'] || row['observaciones'] || '',
            createdAt: new Date().toISOString()
          }
          
          if (patient.name && patient.name.trim() !== '') {
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
  XLSX.writeFile(wb, `productos_${new Date().toISOString().split('T')[0]}.xlsx`)
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
  
  doc.save(`productos_${new Date().toISOString().split('T')[0]}.pdf`)
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
  XLSX.writeFile(wb, `clientes_${new Date().toISOString().split('T')[0]}.xlsx`)
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
  
  doc.save(`clientes_${new Date().toISOString().split('T')[0]}.pdf`)
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
  XLSX.writeFile(wb, `citas_${new Date().toISOString().split('T')[0]}.xlsx`)
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
  
  doc.save(`citas_${new Date().toISOString().split('T')[0]}.pdf`)
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
  
  doc.save(`reporte_financiero_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ========== FUNCIONES PARA MANEJAR ARCHIVOS DE CLIENTES ==========

export function getClientDocuments(patientId) {
  return JSON.parse(localStorage.getItem(`client_documents_${patientId}`) || '[]')
}

export function deleteClientDocument(patientId, documentId) {
  const documents = JSON.parse(localStorage.getItem(`client_documents_${patientId}`) || '[]')
  const filtered = documents.filter(d => d.id !== documentId)
  localStorage.setItem(`client_documents_${patientId}`, JSON.stringify(filtered))
  return filtered
}

// ✅ CORREGIDO: El parámetro ya no se llama "document" para no sobreescribir el DOM global
export function downloadClientDocument(doc) {
  if (typeof window === 'undefined' || !window.document) {
    console.error('No se puede descargar: entorno no válido')
    return
  }
  const link = window.document.createElement('a')
  link.href = doc.data
  link.download = doc.name
  window.document.body.appendChild(link)
  link.click()
  window.document.body.removeChild(link)
}

export function saveClientDocument(patientId, file, documentType = 'generic') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const documents = JSON.parse(localStorage.getItem(`client_documents_${patientId}`) || '[]')
        
        const exists = documents.some(d => d.name === file.name)
        if (exists) {
          reject(new Error(`Ya existe un documento llamado "${file.name}"`))
          return
        }
        
        const newDoc = {
          id: Date.now(),
          name: file.name,
          type: documentType,
          size: file.size,
          mimeType: file.type,
          data: e.target.result,
          uploadDate: new Date().toISOString()
        }
        
        documents.push(newDoc)
        localStorage.setItem(`client_documents_${patientId}`, JSON.stringify(documents))
        
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