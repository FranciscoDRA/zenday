import React from 'react'
import { ROLE_LABELS } from '../../utils/businessRoles'

/**
 * Lo que se ve si el rol actual no puede abrir esta pantalla — ver
 * puedeVerPantalla en utils/businessRoles.js. La barrera real es
 * firestore.rules (esto sólo evita mostrar una pantalla rota si alguien
 * llega acá por un link interno viejo o un rol que acaba de bajar).
 */
export function AccesoRestringido({ rol }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', minHeight: 320, gap: 10,
      padding: 32, textAlign: 'center', color: 'var(--text-secondary)',
    }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>No tenés acceso a esta sección</h3>
      <p style={{ margin: 0, maxWidth: 380 }}>
        Tu rol en este negocio es {ROLE_LABELS[rol] || rol}. Si necesitás ver
        esto, pedile al dueño del negocio que te cambie el rol en
        Configuración → Mi negocio → Miembros.
      </p>
    </div>
  )
}

export default AccesoRestringido
