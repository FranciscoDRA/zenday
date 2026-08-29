import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist_electron*/**', 'node_modules', 'functions/**', 'scripts/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // __APP_VERSION__: inyectada por `define` en vite.config.js (reemplazo
      // de texto en build, no una variable real) — mobileShim.js la usa como
      // último recurso si Capacitor's App.getInfo() no está disponible.
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ignoreRestSiblings: el patrón `const { data, ...meta } = x` para
      // excluir un campo del objeto que se devuelve deja `data` sin usar a
      // propósito — no es una variable olvidada.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
    },
  },
  {
    // Tests y archivos de config corren bajo Node (vitest/vite), no en el
    // navegador: sin esto, `Buffer` y `process` salen como "no definidos".
    files: ['test/**/*.{js,jsx}', '*.config.js', '*.config.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
