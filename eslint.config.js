// ESLint "flat config" for the whole monorepo.
//
// ESLint catches likely bugs (unused variables, undefined names, unreachable code).
// Prettier handles formatting, so `eslint-config-prettier` switches off every ESLint
// rule that would argue with Prettier about spaces and quotes.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  // Never lint generated or installed code.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**'] },

  // ESLint's recommended "these are almost always bugs" rules.
  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module', // we use `import`/`export` everywhere (ES modules)
      globals: { ...globals.node },
    },
    rules: {
      // Unused vars are usually leftovers; allow `_name` for "intentionally unused"
      // (e.g. Express needs all 4 args on an error handler even if we don't use `next`).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Use the logger, not console, so logs stay structured (see apps/api/src/lib/logger.js).
      'no-console': 'warn',
    },
  },

  prettier,
];
