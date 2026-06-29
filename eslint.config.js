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
    // eslint-plugin-html. These rules start at 'warn' (not 'error') because:
    //   - no-undef is off: separate <script> tags share window-scope globals,
    //     so cross-block references would flood false positives.
    //   - eqeqeq/curly/no-case-declarations/no-useless-assignment have
    //     pre-existing violations in the inline scripts that are tracked for a
    //     later cleanup pass; .js files keep them at 'error'.
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
      eqeqeq: 'warn',
      curly: 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.superpowers/**'],
  },
];
