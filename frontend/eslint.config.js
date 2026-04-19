import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Server responses and tool payloads are untyped JSON — enforcing
      // a typed shape at every boundary would explode the codebase for
      // marginal value. We keep this as a *warning* so reviewers still
      // see it, but it doesn't block CI lint.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Widget-registry and shared-table files intentionally mix
      // components with small helper exports. Hot-reload behaves fine
      // in practice; demote the rule to a warning.
      'react-refresh/only-export-components': 'warn',
      // Missing-dep warnings are already audited explicitly where we
      // diverge from the default; keep the rule visible but non-fatal.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
])
