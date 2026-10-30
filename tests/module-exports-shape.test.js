'use strict';

/**
 * Общий файл, ставший ES-модулем, отдаёт `require()` ТЕ ЖЕ ключи, что раньше
 * отдавал `module.exports`.
 *
 * Зачем. Окна переходят на нативные модули (план 2026-10-30-es-modules), а
 * главный процесс остаётся CommonJS и берёт общие файлы `require(esm)`: Node
 * 22 и Node внутри Electron 44 отдают на это namespace модуля. При ТОЛЬКО
 * именованных экспортах (без `default`) namespace имеет ту же форму, что
 * прежний объект `module.exports`, — но лишь пока каждое прежнее имя
 * экспортировано. Пропавший экспорт `require` не роняет: деструктуризация в
 * main даёт `undefined`, и падение случается при первом вызове — в главном
 * процессе, то есть у пользователя.
 *
 * Списки ниже ЗАПИСАНЫ ДО перевода (30.10.2026, `Object.keys(require(файл))`
 * на классическом `module.exports`) и руками не дополняются: добавить имя —
 * законно (⊇), потерять — нет.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { codeOnly } = require('./helpers/source-scan');

const ROOT = path.join(__dirname, '..');

// Ключи `module.exports` до перевода, отсортированы.
const RECORDED = Object.freeze({
    'constants.js': ['ALLOWED_AUDIO_TYPES', 'ALLOWED_IMAGE_TYPES', 'CLOCK_WIDGET_DEFAULT_SIZE', 'CLOCK_WIDGET_MIN_SIZE', 'CONTROL_BAR_MIN_WIDTH', 'CONTROL_WINDOW_HEIGHT', 'CONTROL_WINDOW_MAX_HEIGHT', 'CONTROL_WINDOW_MAX_HEIGHT_WITH_DRAWER', 'CONTROL_WINDOW_MAX_WIDTH', 'CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER', 'CONTROL_WINDOW_MIN_HEIGHT', 'CONTROL_WINDOW_MIN_WIDTH', 'CONTROL_WINDOW_WIDTH', 'CRASH_RELOAD_LIMIT', 'CRASH_RELOAD_WINDOW_MS', 'DANGER_PERCENTAGE', 'DEFAULT_SCALE', 'DEFAULT_TIMER_COLORS', 'FLASH_INTERVAL', 'LOCAL_START_SOUND_WINDOW_MS', 'MAX_FLASH_COUNT', 'MAX_IMAGE_FILE_SIZE', 'MAX_MOVE_DELTA', 'MAX_SOUND_FILE_SIZE', 'MAX_TIMER_SCALE', 'MIN_TIMER_SCALE', 'PRESET_DURATIONS', 'RESIZE_DEBOUNCE', 'SCALE_STEP', 'STORAGE_KEYS', 'TIMER_STYLES', 'TIMER_TICK_MARGIN_MS', 'WARNING_PERCENTAGE', 'WARNING_THRESHOLD', 'WIDGET_DEFAULT_HEIGHT', 'WIDGET_DEFAULT_WIDTH', 'WIDGET_MIN_HEIGHT', 'WIDGET_MIN_WIDTH', 'WINDOW_MIN_VISIBLE_PX'],
    'security.js': ['escapeHTML', 'isSafeColor', 'isValidDataURL', 'safeJSONParse', 'safeSetBackgroundImage', 'validateImageSource'],
    'color-utils.js': ['hexToHsv', 'hexToRgb', 'hsvToHex', 'hsvToRgb', 'rgbToHex'],
    'utils.js': ['calculateProgress', 'clamp', 'debounce', 'formatTime', 'formatTimeShort', 'getTimerStatus', 'isValidNumber', 'parseManualTime', 'safelySendToWindow'],
    'renderer-storage.js': ['getByteSize', 'safeGetJSON', 'safeSetJSON'],
    'renderer-shared.js': ['DEFAULT_BG_OVERLAY', 'LEGACY_COLORS_KEY', 'backgroundTone', 'bgOverlayPercent', 'breakdown', 'clampScale', 'clockToSeconds', 'endsAt', 'eventClockDistances', 'fitBlockScale', 'flipCells', 'heroFrameShrink', 'migrateDisplayBlocks', 'migrateTimerStyle', 'ownColors', 'pickOwnSetting', 'relativeLuminance', 'secondsUntilEventEnd', 'sideCardBand', 'signedSecondsUntilClock', 'storedColors', 'surfaceAlpha', 'surfacePaint', 'surfaceSolid', 'surfaceTone', 'timerColorBand', 'timerLifecycleStatus', 'topBandReserve'],
    'digits-style.js': ['DEFAULT_FONT_ID', 'DIGIT_FONTS', 'FRAME_PAD_X_EM', 'FRAME_PAD_Y_EM', 'PROBE_FIGURES', 'PROBE_FONT_SIZE', 'PROBE_HOURS', 'PROBE_MINUTES', 'PROBE_SIGN', 'SIGN_FONT_RATIO', 'SIGN_GAP_EM', 'applyFont', 'clearProbeCache', 'ensureFont', 'fitFontSize', 'fitScale', 'inkCenterOffset', 'isFontLoaded', 'measureDigits', 'measureSignShift', 'resolveFont', 'signShiftRatio', 'signWidthEm'],
    'display-layouts.js': ['DEFAULT_BLOCK_SCALE', 'DEFAULT_LABEL_SCALE', 'DISPLAY_ELEMENTS', 'EDGE_MARGIN', 'ELEMENT_IDS', 'LABELLED_ELEMENTS', 'LAYOUTS', 'LAYOUT_IDS', 'MAX_CAPTION', 'MAX_ELEMENT_SCALE', 'MIN_ELEMENT_SCALE', 'SECRET_ELEMENTS', 'TIMER_GAP', 'blockCaption', 'clampScale', 'defaultScale', 'fractionToPosition', 'layoutById', 'layoutScales', 'layoutToggles', 'normalizeScales', 'placeElements', 'positionToFraction', 'sanitizeCaption'],
    'hero-modes.js': ['DEFAULT_MODE', 'HERO_LABEL_KEYS', 'HERO_MODES', 'HERO_MODE_IDS', 'heroCaption', 'heroProgress', 'heroSeconds', 'heroTotal', 'isClockMode', 'modeById'],
    'settings-schema.js': ['DISPLAY_BLOCK_KEYS', 'DISPLAY_LABEL_KEYS', 'MANUAL_KEYS', 'SETTINGS_DESCRIPTORS', 'applyStoredSettings', 'collectSettings', 'overrunLimitFieldValue', 'resetKeys', 'resetOwnedSettings', 'settingValue'],
    'clock-settings-schema.js': ['CLOCK_SETTINGS', 'applyClockSettings', 'collectClockSettings'],
    'sound-bank.js': ['BUILT_IN_PRESETS', 'playBuiltInPreset'],
    'sound-presets.js': ['SOUND_EVENTS', 'SOUND_PRESETS', 'buildSoundSelects', 'presetsForEvent', 'repairSelection'],
    'money-meter.js': ['eventSummary', 'formatMoney', 'liveOverrun', 'overrunCost', 'overrunSeconds', 'totalCost', 'totalSeconds'],
    'flip-card.js': ['FLIP_CLASS', 'FLIP_DURATION_MS', 'FLIP_LAYERS_CLASS', 'cancelPending', 'flipCardTo'],
    'window-geometry.js': ['MAX_SCALE_PCT', 'MIN_SCALE_PCT', 'SAVE_SETTLE_MS', 'bindWindowDrag', 'createWindowGeometry', 'fitRestoredBounds', 'fitScaledBounds', 'isWindowDragTarget'],
    'event-report.js': ['BOM', 'DELIMITER', 'EOL', 'buildReportCSV', 'csvCell'],
    'presets.js': ['ACTIVE_SLOT_STORAGE_KEY', 'PRESETS_STORAGE_KEY', 'PRESET_KEYS', 'PRESET_SLOTS', 'activeSlot', 'applyPreset', 'capturePreset', 'hasPreset', 'matchesPreset', 'normalizeSlot', 'readPresets', 'writeActiveSlot', 'writePreset'],
    // Задача 5 — модули панели (записано с классики на 196ded8). Их требуют
    // только тесты, но тест, потерявший имя, молча проверял бы `undefined`.
    // panel-state.js здесь НЕТ намеренно: его module.exports БЫЛ самой
    // примесью (методы + windowRowSubtitle), а модуль экспортирует
    // `PanelStateMixin` и `windowRowSubtitle` — как остальные примеси.
    'font-select.js': ['attachFontSelect'],
    'ui-feedback.js': ['LoadingIndicator', 'Toast'],
    'scale-input.js': ['setupScaleValueEdit'],
    'scale-report.js': ['PROFILE_KEY', 'SCALE_TARGETS', 'applyScaleReport'],
    'color-picker.js': ['ColorPicker', 'addPickerToggle'],
    'modal-manager.js': ['closeModal', 'openModal'],
    'shortcuts-help.js': ['HOTKEY_OPEN_LAYERS', 'globalHotkeyBlocked', 'showKeyboardShortcuts', 'trackPointerControl'],
    'onboarding.js': ['bindReleasesLink', 'init', 'showFirstRunHint'],
    'mini-bar.js': ['BAR_HEIGHT', 'init'],
    'custom-sounds.js': ['CustomSoundsMixin', 'isPlayableSoundData', 'mergeCustomSound', 'sanitizeCustomSounds'],
    'local-background.js': ['LocalBackgroundMixin'],
    'theme-grid.js': ['ThemeGridMixin'],
    'panel-colors.js': ['COLOR_FIELDS', 'COLOR_TARGETS', 'PanelColorsMixin', 'SURFACE_TARGETS', 'mergeColors'],
    'panel-display.js': ['BLOCK_KEYS', 'DISPLAY_TOGGLE_KEYS', 'LABEL_KEYS', 'PanelDisplayMixin', 'attachChangedBgImage', 'collectBlockLabels', 'collectDisplayToggles', 'fillDisplaySelect'],
    'panel-drawer.js': ['SCREEN_MARGIN', 'columnFromWindow', 'drawerColumnWidth'],
    'panel-reset.js': ['PanelResetMixin', 'RESET_TARGETS'],
    'panel-clock.js': ['PanelClockMixin'],
    'panel-titlebar.js': ['LOCK_BUTTON_IDS', 'bindLockToggle', 'bindThemeToggle'],
    'panel-presets.js': ['SLOT_BUTTON_PREFIX', 'SLOT_BUTTON_PREFIXES', 'applyProfile', 'bindPresets', 'install', 'presetHotkeyHandler'],
    'panel-compact.js': ['bindCompactMode', 'createFlipBreaker', 'decideCompact', 'fits'],
});

/** `require('./x')` / `require('./x.js')` файла → плоские имена с `.js`. */
const REQUIRE_RE = /\brequire\(\s*['"]\.\/([A-Za-z0-9_-]+)(?:\.js)?['"]\s*\)/g;

/**
 * Что файл берёт из каждого требуемого общего модуля: имена деструктуризации
 * `const { a, b: c } = require('./x')` и обращения `require('./x').name`.
 * @returns {{dep: string, names: string[]}[]}
 */
function requiredShared(code) {
    const src = codeOnly(code);
    const out = [];
    for (const m of src.matchAll(REQUIRE_RE)) {
        const dep = `${m[1]}.js`;
        if (!Object.prototype.hasOwnProperty.call(RECORDED, dep)) { continue; }
        const names = [];
        const before = src.slice(0, m.index);
        const destructure = /\{([^{}]*)\}\s*=\s*$/.exec(before);
        if (destructure) {
            for (const part of destructure[1].split(',')) {
                const name = part.split(':')[0].trim();
                if (name) { names.push(name); }
            }
        }
        const member = /^\s*\.([A-Za-z_$][\w$]*)/.exec(src.slice(m.index + m[0].length));
        if (member) { names.push(member[1]); }
        out.push({ dep, names });
    }
    return out;
}

/**
 * Файлы главного процесса — `include` tsconfig.main.json. Общие файлы из
 * таблицы тоже сюда входят: ставший модулем зовёт `import` (его REQUIRE_RE не
 * видит), а оставшийся CommonJS (event-report.js) требует модули как main.
 */
function mainOnlyFiles() {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.main.json'), 'utf8'));
    const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'));
    const out = new Set();
    for (const pattern of cfg.include) {
        if (!pattern.endsWith('.js')) { continue; }
        const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);
        for (const f of all) {
            if (re.test(f)) { out.add(f); }
        }
    }
    return [...out].sort();
}

test('разбор require видит деструктуризацию, обращение к полю и пропускает комментарии', () => {
    const code = [
        "const { a, b: c } = require('./utils');",
        "const L = new Set(require('./display-layouts').LAYOUT_IDS);",
        "// const { zzz } = require('./security');",
        "const other = require('./not-shared');",
    ].join('\n');
    assert.deepEqual(requiredShared(code), [
        { dep: 'utils.js', names: ['a', 'b'] },
        { dep: 'display-layouts.js', names: ['LAYOUT_IDS'] },
    ]);
});

for (const [file, keys] of Object.entries(RECORDED)) {
    test(`${file}: require отдаёт все прежние ключи и не отдаёт default`, () => {
        const got = new Set(Object.keys(require(path.join(ROOT, file))));
        const lost = keys.filter((k) => !got.has(k));
        assert.deepEqual(lost, [], `${file}: пропали экспорты ${lost.join(', ')}`);
        // default превратил бы require(esm) в namespace с полем default —
        // форма объекта перестала бы совпадать с прежним module.exports.
        assert.ok(!got.has('default'), `${file}: экспорт default ломает форму require(esm)`);
    });
}

test('главный процесс: каждый требуемый общий файл отдаёт прежние ключи и то, что из него берут', () => {
    const files = mainOnlyFiles();
    const pairs = [];
    for (const file of files) {
        const req = createRequire(path.join(ROOT, file));
        for (const { dep, names } of requiredShared(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
            pairs.push(`${file} → ${dep}`);
            const got = new Set(Object.keys(req(`./${dep}`)));
            const lost = RECORDED[dep].concat(names).filter((k) => !got.has(k));
            assert.deepEqual(lost, [], `${file} требует ${dep}: нет ${lost.join(', ')}`);
        }
    }
    // Самопроверка: охрана, не нашедшая ни одной пары, зелёная впустую.
    for (const known of [
        'electron-main.js → constants.js', 'electron-main.js → utils.js',
        'main-geometry.js → window-geometry.js', 'main-event-overrun.js → money-meter.js',
        'main-relay-ipc.js → settings-schema.js', 'main-relay-ipc.js → display-layouts.js',
        'relay-store.js → clock-settings-schema.js', 'relay-payload.js → constants.js',
        'main-tray.js → utils.js', 'event-report.js → money-meter.js', 'event-report.js → utils.js',
    ]) {
        assert.ok(pairs.includes(known), `не найдена пара ${known}; найдены: ${pairs.join('; ')}`);
    }
});
