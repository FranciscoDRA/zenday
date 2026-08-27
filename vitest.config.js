import { defineConfig } from 'vitest/config'

// La zona horaria se fija a propósito.
//
// Media suite de fechas existe porque Uruguay está en UTC-3 y toISOString()
// corre el día. Si los tests corren en UTC, esos bugs NO se reproducen y los
// tests pasan sin probar nada — que es exactamente lo que pasó cuando cambió
// la zona de la máquina donde se corrían.
//
// Fijándola, los tests miden siempre el entorno real del usuario.
process.env.TZ = 'America/Montevideo'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
})
