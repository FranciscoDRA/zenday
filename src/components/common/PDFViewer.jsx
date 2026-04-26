import React, { useEffect } from 'react'

export default function PDFViewer({ file, onClose, fileName }) {
  const displayName = fileName || 'documento.pdf'

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleDownload = () => {
    if (window.electronAPI?.saveFile) {
      window.electronAPI.saveFile(file, displayName)
      return
    }
    const a = document.createElement('a')
    a.href = file
    a.download = displayName
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 150)
  }

  const handleOpenExternal = () => {
    if (window.electronAPI?.openFile) {
      window.electronAPI.openFile(file, displayName)
      onClose?.()
    } else {
      window.open(file, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      className="pdf-viewer-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor: ${displayName}`}
    >
      <div className="pdf-viewer-content" onClick={e => e.stopPropagation()}>
        <div className="pdf-viewer-header">
          <h3>📄 {displayName}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="pdf-viewer-body">
          <div className="pdf-preview-message">
            <span style={{ fontSize: 56, opacity: .4 }}>📄</span>
            <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, color: 'var(--text-primary)' }}>
              {displayName}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn-primary" onClick={handleOpenExternal}>
                🔗 Abrir con visor del sistema
              </button>
              <button className="btn-secondary" onClick={handleDownload}>
                📥 Descargar
              </button>
            </div>
          </div>
        </div>
        <div className="pdf-viewer-footer">
          <button className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}