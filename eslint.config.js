const globals = require('globals');
const js = require('@eslint/js');
const html = require('eslint-plugin-html');
const { windowModuleFiles, moduleLintBlock } = require('./scripts/window-modules.js');

// Файлы окон, которые грузятся модулем (`type="module"` + граф import), —
// ВЫЧИСЛЯЮТСЯ из страниц, а не перечисляются: см. scripts/window-modules.js.
// Блок для них стоит ПОСЛЕ классических — более поздний блок flat-конфига
// перекрывает `sourceType` и `no-undef`. Пустой `files` ESLint не принимает,
// поэтому без модулей блока нет вовсе.
const WINDOW_MODULES = windowModuleFiles(__dirname);

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
    // Page scripts of the four windows — until 25.09.2026 their inline
    // <script> blocks (moved out for CSP `script-src 'self'`). They keep the
    // exact rules they had as inline HTML above: classic scripts, not
    // CommonJS, sharing window-scope globals with the other scripts of the
    // page, so no-undef stays off for the same reason.
    files: [
      'theme-init.js', 'theme-init-tone.js',
      'control-app.js', 'control-theme-sync.js',
      'widget-app.js', 'widget-theme-sync.js',
      'clock-widget-app.js', 'clock-widget-theme-sync.js',
      'display-theme-sync.js',
    ],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'error',
      'no-useless-assignment': 'error',
    },
  },
  ...(WINDOW_MODULES.length > 0 ? [moduleLintBlock(WINDOW_MODULES)] : []),
  {
    ignores: ['dist/**', 'node_modules/**', '.superpowers/**'],
  },
];
