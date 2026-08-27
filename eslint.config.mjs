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
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
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
