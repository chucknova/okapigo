// ESLint "flat config" for the whole monorepo.
//
// ESLint catches likely bugs (unused variables, undefined names, unreachable code).
// Prettier handles formatting, so `eslint-config-prettier` switches off every ESLint
// rule that would argue with Prettier about spaces and quotes.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // Never lint generated or installed code.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**'] },

  // ESLint's recommended "these are almost always bugs" rules.
  js.configs.recommended,

  {
    files: ['**/*.js'],
    ignores: ['apps/web/src/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module', // we use `import`/`export` everywhere (ES modules)
      globals: { ...globals.node },
    },
    rules: {
      // Unused vars are usually leftovers; allow `_name` for "intentionally unused"
      // (e.g. Express needs all 4 args on an error handler even if we don't use `next`, or
      // `const { secret: _secret, ...safe } = obj` to copy an object minus one field).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Use the logger, not console, so logs stay structured (see apps/api/src/lib/logger.js).
      'no-console': 'warn',
    },
  },

  // The guest web (React, runs in browsers).
  {
    files: ['apps/web/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The Rules of Hooks: hooks only at the top level of components, and effects list
      // what they depend on. Breaking these causes bugs that are hard to see.
      ...reactHooks.configs.recommended.rules,
      // ESLint's own rule doesn't see a component used only inside JSX (<Button />) and
      // would call its import unused. Components always start with a capital letter, so
      // those are skipped. (eslint-plugin-react fixes this properly but doesn't support
      // ESLint 10 yet.)
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|[A-Z])' }],
    },
  },
  // The web app's build and test config runs in Node.
  {
    files: ['apps/web/vite.config.js', 'apps/web/scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
];
