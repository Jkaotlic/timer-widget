'use strict';

/**
 * PANEL-006 (аудит 27.10.2026): метка «старт нажат здесь» залипала.
 *
 * start() ставил _localStartTriggered = true БЕЗУСЛОВНО, а снимала его только
 * ветка холодного старта в _onTimerState (`!wasRunning && !wasPaused &&
 * isRunning`). «Продолжить» из паузы — не холодный старт: метка оставалась, и
 * следующий холодный старт ИЗ ДРУГОГО ОКНА (виджет, часы) проходил без звука.
 * Так же — если главный процесс команду отклонил и состояние не сменилось.
 *
 * Правка: метка ставится только когда ждём холодный старт, и живёт ограниченное
 * время (CONFIG.LOCAL_START_SOUND_WINDOW_MS) — отклонённая команда её не
 * оставляет навсегда.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { codeOnly } = require('./helpers/source-scan');
const { readSource } = require('./helpers/window-source');

const SRC = codeOnly(readSource('control-app.js'));
const CONFIG = require('../constants.js');

function methodBody(name) {
    const at = SRC.indexOf(`\n            ${name}() {`);
    assert.notEqual(at, -1, `метод ${name} не найден`);
    return SRC.slice(at, SRC.indexOf('\n            }', at + 1));
}

test('PANEL-006: start() метит только холодный старт', () => {
    const body = methodBody('start');
    assert.doesNotMatch(body, /_localStartTriggered\s*=\s*true/, 'старая безусловная метка вернулась');
    assert.match(body, /if \(!this\.isPaused && !this\.isRunning\)\s*\{?\s*this\._localStartAt = Date\.now\(\)/,
        'метка ставится и на «Продолжить» из паузы — залипнет');
});

test('PANEL-006: метка гаснет по времени и снимается при КАЖДОМ холодном старте', () => {
    const at = SRC.indexOf('this._onTimerState = ');
    const handler = SRC.slice(at, SRC.indexOf('ipcRenderer.on(\'timer-state\'', at));
    assert.match(handler, /Date\.now\(\) - this\._localStartAt\) < (?<![\w.])CONFIG\.LOCAL_START_SOUND_WINDOW_MS/,
        'метка не ограничена временем: отклонённая команда оставит её навсегда');
    assert.match(handler, /this\._localStartAt = 0/, 'метка не снимается');
    assert.doesNotMatch(handler, /_localStartTriggered/, 'старая метка осталась в обработчике');
    const cfg = CONFIG.CONFIG || CONFIG;
    assert.ok(Number.isFinite(cfg.LOCAL_START_SOUND_WINDOW_MS) && cfg.LOCAL_START_SOUND_WINDOW_MS > 0,
        'окно метки не объявлено в constants.js');
});
