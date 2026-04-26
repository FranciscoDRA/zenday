import { formatTime, formatDateTime, formatCurrency } from './helpers'

export class NotificationService {
  // ========== NOTIFICACIÓN DE PEDIDO/CITA PRÓXIMA ==========
  static async showAppointmentReminder(appointment) {
    const title = `⏰ ${appointment.patientName}`
    const body = `${appointment.productName || 'Pedido'} - ${formatTime(appointment.startTime)}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon.png' })
    }
  }

  // ========== NOTIFICACIÓN DE STOCK BAJO ==========
  static async showLowStockAlert(product) {
    const title = `📦 Stock bajo: ${product.name}`
    const body = `Quedan ${product.stock} unidades. Precio: ${formatCurrency(product.price, 'UYU')}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE STOCK AGOTADO ==========
  static async showOutOfStockAlert(product) {
    const title = `⚠️ SIN STOCK: ${product.name}`
    const body = `El producto se ha agotado completamente. Precio: ${formatCurrency(product.price, 'UYU')}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE PAGO PENDIENTE ==========
  static async showPendingPaymentAlert(patientName, total, count) {
    const title = `💰 Pago pendiente: ${patientName}`
    const body = `${count} pedido(s) por un total de ${formatCurrency(total, 'UYU')}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE PEDIDO COMPLETADO ==========
  static async showOrderCompletedAlert(appointment) {
    const title = `✅ Pedido completado: ${appointment.patientName}`
    const body = `${appointment.productName || 'Pedido'} - ${formatCurrency(appointment.price, 'UYU')}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE NUEVO CLIENTE ==========
  static async showNewPatientAlert(patient) {
    const title = `👤 Nuevo cliente: ${patient.name}`
    const body = patient.phone ? `Tel: ${patient.phone}` : 'Cliente registrado exitosamente'
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE NUEVO ARTÍCULO ==========
  static async showNewProductAlert(product) {
    const title = `📦 Nuevo artículo: ${product.name}`
    const body = `Precio: ${formatCurrency(product.price, 'UYU')} | Stock inicial: ${product.stock || 0}`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE RESPALDO COMPLETADO ==========
  static async showBackupCompletedAlert() {
    const title = `💾 Respaldo completado`
    const body = `Todos los datos han sido guardados correctamente.`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: true })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== NOTIFICACIÓN DE BIENVENIDA ==========
  static async showWelcomeAlert(userName = 'Usuario') {
    const title = `👋 ¡Bienvenido a ZenDay!`
    const body = `Hola ${userName}, tu consultorio está listo.`
    
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({ title, body, silent: false })
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  // ========== VERIFICAR STOCK DE MÚLTIPLES PRODUCTOS ==========
  static checkLowStock(products) {
    if (!products || products.length === 0) return
    
    const lowStockProducts = []
    const outOfStockProducts = []
    
    products.forEach(p => {
      const stock = p.stock || 0
      if (stock === 0) {
        outOfStockProducts.push(p)
      } else if (stock < 5) {
        lowStockProducts.push(p)
      }
    })
    
    // Notificar productos agotados (máximo 3 para no saturar)
    outOfStockProducts.slice(0, 3).forEach(p => {
      this.showOutOfStockAlert(p)
    })
    
    // Notificar stock bajo (máximo 3)
    lowStockProducts.slice(0, 3).forEach(p => {
      this.showLowStockAlert(p)
    })
    
    // Resumen en consola
    if (outOfStockProducts.length > 3) {
      console.warn(`⚠️ ${outOfStockProducts.length - 3} productos más sin stock`)
    }
    if (lowStockProducts.length > 3) {
      console.warn(`📦 ${lowStockProducts.length - 3} productos más con stock bajo`)
    }
  }

  // ========== VERIFICAR PAGOS PENDIENTES ==========
  static checkPendingPayments(appointments) {
    if (!appointments || appointments.length === 0) return
    
    const pending = appointments.filter(a => 
      (a.status === 'completed' || a.status === 'delivered' || a.status === 'picked') && 
      !a.paid
    )
    
    if (pending.length === 0) return
    
    // Agrupar por cliente
    const byClient = {}
    pending.forEach(a => {
      if (!byClient[a.patientName]) {
        byClient[a.patientName] = { total: 0, count: 0 }
      }
      byClient[a.patientName].total += a.price || 0
      byClient[a.patientName].count += 1
    })
    
    // Notificar clientes con deuda (máximo 3)
    Object.entries(byClient).slice(0, 3).forEach(([name, data]) => {
      this.showPendingPaymentAlert(name, data.total, data.count)
    })
  }

  // ========== SOLICITAR PERMISO DE NOTIFICACIONES ==========
  static async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        console.log('✅ Permiso de notificaciones concedido')
        return true
      }
    }
    return Notification.permission === 'granted'
  }

  // ========== VERIFICAR SI HAY PERMISO ==========
  static hasPermission() {
    return 'Notification' in window && Notification.permission === 'granted'
  }
}
