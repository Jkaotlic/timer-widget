const globals = require('globals');
const js = require('@eslint/js');
const html = require('eslint-plugin-html');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
    },
  },
  {
    // Lint the inline <script> blocks inside the renderer HTML files via
    // eslint-plugin-html. eqeqeq/curly/no-case-declarations/no-useless-assignment
    // are at 'error' to mirror the .js block and prevent regressions. Two rules
    // stay relaxed for the inline-script context:
    //   - no-undef is off: separate <script> tags share window-scope globals,
    //     so cross-block references would flood false positives.
    //   - no-unused-vars stays at 'warn' for the same window-scope reason
    //     (a global defined in one block and read in another reads as unused);
    //     argsIgnorePattern '^_' allows intentionally-unused params.
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-undef': 'off',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'error',
      'no-useless-assignment': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.superpowers/**'],
  },
];
