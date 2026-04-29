// Minimal lint config: catches dead code and undefined references.
// Scoped to JS files we can lint cleanly — index.html's inline script
// would need extra plumbing and isn't worth it for this size of project.

import globals from 'globals';

export default [
  {
    files: ['tests/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**']
  }
];
