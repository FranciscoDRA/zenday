// src/utils/pdfReportGenerator.js
// Generador de reportes PDF profesionales para ZenDay
// Usa jsPDF + autoTable (ya instalados en el proyecto)

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── PALETA DE COLORES ────────────────────────────────────────────────────────
const COLORS = {
  primary:    [99,  102, 241],  // indigo
  secondary:  [16,  185, 129],  // emerald
  danger:     [239, 68,  68],   // red
  warning:    [245, 158, 11],   // amber
  dark:       [29,  29,  31],   // text-primary
  gray:       [134, 134, 139],  // text-tertiary
  lightGray:  [240, 240, 245],  // bg-tertiary
  white:      [255, 255, 255],
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatUYU(amount) {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency', currency: 'UYU', minimumFractionDigits: 0,
  }).format(amount || 0)
}

function formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function formatDateLong(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ─── HEADER DEL REPORTE ───────────────────────────────────────────────────────

function drawHeader(doc, { title, subtitle, startDate, endDate, businessName = 'ZenDay' }) {
  const pw = doc.internal.pageSize.getWidth()

  // Fondo del header
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, pw, 42, 'F')

  // Gradiente simulado con rectángulo secundario
  doc.setFillColor(...COLORS.secondary)
  doc.rect(pw - 60, 0, 60, 42, 'F')
  doc.setFillColor(...COLORS.primary)
  doc.rect(pw - 60, 0, 50, 42, 'F')

  // Logo / nombre del negocio
  doc.setTextColor(...COLORS.white)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text(businessName, 14, 16)

  // Subtítulo del negocio
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 200, 255)
  doc.text('Tu gestión inteligente', 14, 22)

  // Título del reporte
  doc.setTextColor(...COLORS.white)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 34)

  // Período
  if (startDate && endDate) {
    const periodo = `${formatDate(startDate)} — ${formatDate(endDate)}`
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 200, 255)
    const periodoWidth = doc.getTextWidth(periodo)
    doc.text(periodo, pw - periodoWidth - 14, 34)
  }

  // Fecha de generación
  doc.setFontSize(7)
  doc.setTextColor(180, 180, 220)
  const generated = `Generado: ${new Date().toLocaleString('es-ES')}`
  const genWidth = doc.getTextWidth(generated)
  doc.text(generated, pw - genWidth - 14, 39)

  return 50 // Y de inicio del contenido
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────

function drawFooter(doc) {
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const pages = doc.internal.getNumberOfPages()

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(...COLORS.lightGray)
    doc.setLineWidth(0.3)
    doc.line(14, ph - 14, pw - 14, ph - 14)
    doc.setFontSize(7)
    doc.setTextColor(...COLORS.gray)
    doc.text(`ZenDay — Reporte generado automáticamente`, 14, ph - 8)
    doc.text(`Página ${i} de ${pages}`, pw - 14, ph - 8, { align: 'right' })
  }
}

// ─── KPI CARDS ────────────────────────────────────────────────────────────────

function drawKPICards(doc, kpis, startY) {
  const pw     = doc.internal.pageSize.getWidth()
  const margin = 14
  const gap    = 6
  const cols   = Math.min(kpis.length, 4)
  const cardW  = (pw - margin * 2 - gap * (cols - 1)) / cols
  const cardH  = 24

  kpis.forEach((kpi, i) => {
    const x = margin + i * (cardW + gap)

    // Fondo card
    doc.setFillColor(...COLORS.lightGray)
    doc.roundedRect(x, startY, cardW, cardH, 3, 3, 'F')

    // Línea de acento superior
    doc.setFillColor(...(kpi.color || COLORS.primary))
    doc.rect(x, startY, cardW, 2, 'F')

    // Valor
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(kpi.color || COLORS.dark))
    doc.text(String(kpi.value), x + cardW / 2, startY + 12, { align: 'center' })

    // Label
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLORS.gray)
    doc.text(kpi.label, x + cardW / 2, startY + 20, { align: 'center' })
  })

  return startY + cardH + 10
}

// ─── SECCIÓN CON TÍTULO ───────────────────────────────────────────────────────

function drawSectionTitle(doc, title, y) {
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLORS.dark)
  doc.text(title, 14, y)

  doc.setDrawColor(...COLORS.primary)
  doc.setLineWidth(0.5)
  doc.line(14, y + 2, 14 + doc.getTextWidth(title), y + 2)

  return y + 8
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE DE VENTAS
// ═══════════════════════════════════════════════════════════════════════════════

export function generateSalesReport({ appointments, startDate, endDate, businessName }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw  = doc.internal.pageSize.getWidth()

  // Filtrar por rango
  const start = new Date(startDate)
  const end   = new Date(endDate); end.setHours(23, 59, 59)

  const filtered = appointments.filter(a => {
    const d = new Date(a.startTime)
    return d >= start && d <= end
  })

  const PAID_STATUSES = new Set(['completed', 'delivered', 'picked'])
  const completed = filtered.filter(a => PAID_STATUSES.has(a.status))
  const paid      = completed.filter(a => a.paid)
  const pending   = completed.filter(a => !a.paid)

  const totalSales   = paid.reduce((s, a) => s + (a.price || 0), 0)
  const totalPending = pending.reduce((s, a) => s + (a.price || 0), 0)
  const totalRevenue = completed.reduce((s, a) => s + (a.price || 0), 0)

  // Header
  let y = drawHeader(doc, {
    title: 'Reporte de Ventas',
    startDate, endDate, businessName,
  })

  // KPIs
  y = drawKPICards(doc, [
    { label: 'Ingresos totales',    value: formatUYU(totalRevenue), color: COLORS.primary },
    { label: 'Cobrado',             value: formatUYU(totalSales),   color: COLORS.secondary },
    { label: 'Pendiente de cobro',  value: formatUYU(totalPending), color: COLORS.warning },
    { label: 'Pedidos completados', value: completed.length,        color: COLORS.dark },
  ], y)

  // Resumen ejecutivo
  y = drawSectionTitle(doc, 'Resumen ejecutivo', y)

  autoTable(doc, {
    startY: y,
    body: [
      ['Total facturado',         formatUYU(totalRevenue)],
      ['Total cobrado',           formatUYU(totalSales)],
      ['Pendiente de cobro',      formatUYU(totalPending)],
      ['Pedidos completados',     completed.length.toString()],
      ['Pedidos pagados',         paid.length.toString()],
      ['Pedidos sin cobrar',      pending.length.toString()],
      ['Ticket promedio',         completed.length > 0 ? formatUYU(totalRevenue / completed.length) : '$0'],
      ['% Cobrado',               totalRevenue > 0 ? `${((totalSales / totalRevenue) * 100).toFixed(1)}%` : '0%'],
    ],
    theme: 'grid',
    styles:       { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: COLORS.lightGray }, 1: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 255] },
    margin: { left: 14, right: 14 },
  })

  y = doc.lastAutoTable.finalY + 10

  // Detalle de pedidos
  if (completed.length > 0) {
    y = drawSectionTitle(doc, 'Detalle de pedidos', y)

    autoTable(doc, {
      startY: y,
      head: [['Cliente', 'Producto/Servicio', 'Fecha', 'Monto', 'Estado']],
      body: completed
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        .map(a => [
          a.patientName || '—',
          a.productName || a.serviceName || '—',
          formatDate(a.startTime),
          formatUYU(a.price || 0),
          a.paid ? '✓ Pagado' : '⏳ Pendiente',
        ]),
      theme: 'striped',
      styles:       { fontSize: 8, cellPadding: 2.5 },
      headStyles:   { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 50 },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 30, halign: 'right' },
        4: { cellWidth: 30, halign: 'center' },
      },
      didParseCell: (data) => {
        if (data.column.index === 4 && data.section === 'body') {
          if (data.cell.raw === '✓ Pagado') {
            data.cell.styles.textColor = COLORS.secondary
            data.cell.styles.fontStyle = 'bold'
          } else {
            data.cell.styles.textColor = COLORS.warning
          }
        }
      },
      margin: { left: 14, right: 14 },
    })

    y = doc.lastAutoTable.finalY + 10
  }

  // Top productos
  const productMap = {}
  completed.forEach(a => {
    const name = a.productName || a.serviceName || 'Sin nombre'
    if (!productMap[name]) productMap[name] = { qty: 0, revenue: 0 }
    productMap[name].qty++
    productMap[name].revenue += a.price || 0
  })

  const topProducts = Object.entries(productMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  if (topProducts.length > 0) {
    // Nueva página si queda poco espacio
    if (y > 220) { doc.addPage(); y = 20 }

    y = drawSectionTitle(doc, 'Top productos / servicios', y)

    autoTable(doc, {
      startY: y,
      head: [['#', 'Producto / Servicio', 'Cantidad', 'Ingresos']],
      body: topProducts.map((p, i) => [
        `#${i + 1}`,
        p.name,
        p.qty.toString(),
        formatUYU(p.revenue),
      ]),
      theme: 'striped',
      styles:       { fontSize: 8, cellPadding: 2.5 },
      headStyles:   { fillColor: COLORS.secondary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 35, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    })
  }

  drawFooter(doc)
  doc.save(`reporte-ventas-${startDate}-al-${endDate}.pdf`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE DE CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

export function generateCustomersReport({ appointments, patients, startDate, endDate, businessName }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const start = new Date(startDate)
  const end   = new Date(endDate); end.setHours(23, 59, 59)

  const filtered = appointments.filter(a => {
    const d = new Date(a.startTime)
    return d >= start && d <= end
  })

  // Agrupar por cliente
  const byClient = {}
  filtered.forEach(a => {
    const name = a.patientName || 'Sin nombre'
    if (!byClient[name]) byClient[name] = { name, orders: 0, spent: 0, paid: 0, lastOrder: null }
    byClient[name].orders++
    byClient[name].spent += a.price || 0
    if (a.paid) byClient[name].paid += a.price || 0
    if (!byClient[name].lastOrder || new Date(a.startTime) > new Date(byClient[name].lastOrder)) {
      byClient[name].lastOrder = a.startTime
    }
  })

  const clientList = Object.values(byClient).sort((a, b) => b.spent - a.spent)
  const totalClients  = clientList.length
  const totalRevenue  = clientList.reduce((s, c) => s + c.spent, 0)
  const avgPerClient  = totalClients > 0 ? totalRevenue / totalClients : 0
  const topClient     = clientList[0]

  let y = drawHeader(doc, { title: 'Reporte de Clientes', startDate, endDate, businessName })

  y = drawKPICards(doc, [
    { label: 'Clientes activos',  value: totalClients,          color: COLORS.primary },
    { label: 'Facturado total',   value: formatUYU(totalRevenue), color: COLORS.secondary },
    { label: 'Ticket promedio',   value: formatUYU(avgPerClient), color: COLORS.warning },
    { label: 'Top cliente',       value: topClient?.name?.split(' ')[0] || '—', color: COLORS.dark },
  ], y)

  y = drawSectionTitle(doc, 'Ranking de clientes', y)

  autoTable(doc, {
    startY: y,
    head: [['#', 'Cliente', 'Pedidos', 'Facturado', 'Cobrado', 'Último pedido']],
    body: clientList.map((c, i) => [
      `#${i + 1}`,
      c.name,
      c.orders.toString(),
      formatUYU(c.spent),
      formatUYU(c.paid),
      formatDate(c.lastOrder),
    ]),
    theme: 'striped',
    styles:       { fontSize: 8, cellPadding: 2.5 },
    headStyles:   { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 50 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 28, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  })

  drawFooter(doc)
  doc.save(`reporte-clientes-${startDate}-al-${endDate}.pdf`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE DE INVENTARIO
// ═══════════════════════════════════════════════════════════════════════════════

export function generateInventoryReport({ products, businessName }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const today = new Date().toISOString().split('T')[0]

  const lowStock   = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 5)
  const outOfStock = products.filter(p => (p.stock || 0) === 0)
  const inStock    = products.filter(p => (p.stock || 0) >= 5)
  const totalValue = products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0)

  let y = drawHeader(doc, {
    title:     'Reporte de Inventario',
    startDate: today,
    endDate:   today,
    businessName,
  })

  y = drawKPICards(doc, [
    { label: 'Total artículos',  value: products.length,       color: COLORS.primary },
    { label: 'Valor inventario', value: formatUYU(totalValue), color: COLORS.secondary },
    { label: 'Stock bajo',       value: lowStock.length,       color: COLORS.warning },
    { label: 'Agotados',         value: outOfStock.length,     color: COLORS.danger },
  ], y)

  // Artículos agotados
  if (outOfStock.length > 0) {
    y = drawSectionTitle(doc, '🚨 Artículos agotados', y)
    autoTable(doc, {
      startY: y,
      head: [['Artículo', 'Código', 'Precio']],
      body: outOfStock.map(p => [p.name, p.code || '—', formatUYU(p.price || 0)]),
      theme: 'grid',
      styles:     { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: COLORS.danger, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      margin:     { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10
  }

  // Stock bajo
  if (lowStock.length > 0) {
    if (y > 220) { doc.addPage(); y = 20 }
    y = drawSectionTitle(doc, '⚠️ Stock bajo (menos de 5 unidades)', y)
    autoTable(doc, {
      startY: y,
      head: [['Artículo', 'Código', 'Stock', 'Precio', 'Valor']],
      body: lowStock
        .sort((a, b) => (a.stock || 0) - (b.stock || 0))
        .map(p => [
          p.name,
          p.code || '—',
          (p.stock || 0).toString(),
          formatUYU(p.price || 0),
          formatUYU((p.price || 0) * (p.stock || 0)),
        ]),
      theme: 'grid',
      styles:     { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: COLORS.warning, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        2: { halign: 'center', textColor: COLORS.warning, fontStyle: 'bold' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10
  }

  // Inventario completo
  if (y > 220) { doc.addPage(); y = 20 }
  y = drawSectionTitle(doc, 'Inventario completo', y)

  autoTable(doc, {
    startY: y,
    head: [['Artículo', 'Código', 'Stock', 'Precio unit.', 'Valor total', 'Estado']],
    body: products
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(p => {
        const stock  = p.stock || 0
        const status = stock === 0 ? 'AGOTADO' : stock < 5 ? 'STOCK BAJO' : 'OK'
        return [
          p.name,
          p.code || '—',
          stock.toString(),
          formatUYU(p.price || 0),
          formatUYU((p.price || 0) * stock),
          status,
        ]
      }),
    theme: 'striped',
    styles:     { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.column.index === 5 && data.section === 'body') {
        if (data.cell.raw === 'AGOTADO')   data.cell.styles.textColor = COLORS.danger
        if (data.cell.raw === 'STOCK BAJO') data.cell.styles.textColor = COLORS.warning
        if (data.cell.raw === 'OK')         data.cell.styles.textColor = COLORS.secondary
      }
    },
    foot: [[
      { content: 'TOTAL', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right' } },
      { content: formatUYU(totalValue), styles: { fontStyle: 'bold', halign: 'right', textColor: COLORS.primary } },
      '',
    ]],
    footStyles: { fillColor: COLORS.lightGray, textColor: COLORS.dark },
    margin: { left: 14, right: 14 },
  })

  drawFooter(doc)
  doc.save(`reporte-inventario-${today}.pdf`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE FINANCIERO COMPLETO (ventas + gastos + ganancia)
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFinancialReport({ appointments, expenses = [], startDate, endDate, businessName }) {
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const start = new Date(startDate)
  const end   = new Date(endDate); end.setHours(23, 59, 59)

  const PAID_STATUSES = new Set(['completed', 'delivered', 'picked'])

  const filteredApts = appointments.filter(a => {
    const d = new Date(a.startTime)
    return d >= start && d <= end && PAID_STATUSES.has(a.status)
  })

  const filteredExp = expenses.filter(e => {
    const d = new Date(e.date)
    return d >= start && d <= end
  })

  const totalRevenue  = filteredApts.reduce((s, a) => s + (a.price || 0), 0)
  const totalPaid     = filteredApts.filter(a => a.paid).reduce((s, a) => s + (a.price || 0), 0)
  const totalExpenses = filteredExp.reduce((s, e) => s + (e.amount || 0), 0)
  const netProfit     = totalRevenue - totalExpenses
  const margin        = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  let y = drawHeader(doc, { title: 'Reporte Financiero', startDate, endDate, businessName })

  y = drawKPICards(doc, [
    { label: 'Ingresos',     value: formatUYU(totalRevenue),  color: COLORS.primary },
    { label: 'Gastos',       value: formatUYU(totalExpenses), color: COLORS.danger },
    { label: 'Ganancia neta',value: formatUYU(netProfit),     color: netProfit >= 0 ? COLORS.secondary : COLORS.danger },
    { label: 'Margen',       value: `${margin.toFixed(1)}%`,  color: COLORS.warning },
  ], y)

  // Estado de resultados
  y = drawSectionTitle(doc, 'Estado de resultados', y)

  autoTable(doc, {
    startY: y,
    body: [
      [{ content: 'INGRESOS', styles: { fontStyle: 'bold', fillColor: [235, 245, 255] } }, ''],
      ['  Total facturado',                  formatUYU(totalRevenue)],
      ['  Cobrado',                          formatUYU(totalPaid)],
      ['  Pendiente de cobro',               formatUYU(totalRevenue - totalPaid)],
      [{ content: 'GASTOS', styles: { fontStyle: 'bold', fillColor: [255, 240, 240] } }, ''],
      ['  Total gastos',                     formatUYU(totalExpenses)],
      [{ content: 'RESULTADO', styles: { fontStyle: 'bold', fillColor: [240, 255, 245] } }, ''],
      [{ content: '  Ganancia neta', styles: { fontStyle: 'bold' } },
       { content: formatUYU(netProfit), styles: { fontStyle: 'bold', textColor: netProfit >= 0 ? COLORS.secondary : COLORS.danger } }],
      ['  Margen de ganancia',               `${margin.toFixed(1)}%`],
    ],
    theme: 'grid',
    styles:       { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  y = doc.lastAutoTable.finalY + 10

  // Detalle de gastos por categoría
  if (filteredExp.length > 0) {
    if (y > 200) { doc.addPage(); y = 20 }
    y = drawSectionTitle(doc, 'Gastos por categoría', y)

    const byCategory = filteredExp.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + (e.amount || 0)
      return acc
    }, {})

    autoTable(doc, {
      startY: y,
      head: [['Categoría', 'Total', '% del gasto']],
      body: Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amount]) => [
          cat,
          formatUYU(amount),
          `${((amount / totalExpenses) * 100).toFixed(1)}%`,
        ]),
      theme: 'striped',
      styles:       { fontSize: 8, cellPadding: 2.5 },
      headStyles:   { fillColor: COLORS.danger, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'center' } },
      foot: [[
        { content: 'TOTAL', styles: { fontStyle: 'bold' } },
        { content: formatUYU(totalExpenses), styles: { fontStyle: 'bold', halign: 'right' } },
        { content: '100%', styles: { fontStyle: 'bold', halign: 'center' } },
      ]],
      footStyles: { fillColor: COLORS.lightGray },
      margin: { left: 14, right: 14 },
    })

    y = doc.lastAutoTable.finalY + 10

    // Lista de gastos
    if (y > 180) { doc.addPage(); y = 20 }
    y = drawSectionTitle(doc, 'Detalle de gastos', y)

    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Categoría', 'Descripción', 'Monto']],
      body: filteredExp
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(e => [
          formatDate(e.date),
          e.category || '—',
          e.description || 'Sin descripción',
          formatUYU(e.amount || 0),
        ]),
      theme: 'striped',
      styles:       { fontSize: 8, cellPadding: 2.5 },
      headStyles:   { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 30 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 28, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    })
  }

  drawFooter(doc)
  doc.save(`reporte-financiero-${startDate}-al-${endDate}.pdf`)
}