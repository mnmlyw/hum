// Minimal lint config: catches dead code and undefined references.
// index.html's inline scripts are linted as one shared-scope program — the
// same way the browser runs its classic <script> blocks.

import globals from 'globals';
import html from 'eslint-plugin-html';

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }]
};

export default [
  {
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules
  },
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser }
    },
    rules
  },
  {
    // tutorial.html inlines all of hum-core/hum-engine but only calls part of
    // it; those blocks are already checked for dead code in index.html. Keep
    // no-undef so the play controller can't call an engine API that's gone.
    files: ['tutorial.html'],
    rules: { 'no-unused-vars': 'off' }
  },
  {
    // Linted through its output, tutorial.html.
    ignores: ['node_modules/**', 'tools/tutorial.template.html']
  }
];
