'use strict';

/**
 * У настроек и цветов часов ОДИН писатель — панель.
 *
 * До 29.10.2026 `clockWidgetSettings` и `clockColors` писали двое: панель и
 * само окно часов (цвета — на каждом применении, настройки — на каждой смене
 * стиля и на каждом пакете от панели). Отсюда «слияние, а не перезапись» в
 * обоих местах и стиль часов, который попадал в профиль только если окно часов
 * было в этот момент открыто: сменил стиль при закрытых часах — после
 * перезапуска часы открывались в прежнем (спека
 * docs/superpowers/specs/2026-10-29-one-key-one-owner-design.md, п. 3).
 *
 * Теперь окно часов эти ключи только ЧИТАЕТ. Тест на отсутствие проверяет сам
 * себя: сканер обязан найти запись на образце и на настоящей записи окна
 * (`clockHintShown`) — иначе зелёный значил бы и «чисто», и «сканер слеп».
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { codeOnly } = require('./helpers/source-scan');
const { readSource, readRaw } = require('./helpers/window-source');

const OWNED = ['clockWidgetSettings', 'clockColors'];
// Имена тех же ключей в реестре constants.js: запись через STORAGE_KEYS — тоже запись.
const OWNED_CONST = { CLOCK_WIDGET_SETTINGS: 'clockWidgetSettings', CLOCK_COLORS: 'clockColors' };

/**
 * Ключи, которые код ЗАПИСЫВАЕТ: `x.setItem('ключ', …)` литералом или через
 * `STORAGE_KEYS.ИМЯ`. Комментарии вырезаны до поиска — пояснение, цитирующее
 * старую запись, записью не считается.
 * @param {string} src
 * @returns {Set<string>}
 */
function writtenKeys(src) {
    const code = codeOnly(src);
    const out = new Set();
    for (const m of code.matchAll(/\.setItem\(\s*(['"`])([A-Za-z0-9_]+)\1/g)) { out.add(m[2]); }
    for (const m of code.matchAll(/\.setItem\(\s*[\w.]*STORAGE_KEYS\.([A-Z_]+)/g)) {
        out.add(OWNED_CONST[m[1]] || m[1]);
    }
    return out;
}

test('сканер видит запись — литералом и через реестр — и не видит комментарий', () => {
    const sample = [
        "localStorage.setItem('clockColors', JSON.stringify(colors));",
        'localStorage.setItem(CONFIG.STORAGE_KEYS.CLOCK_WIDGET_SETTINGS, raw);',
        "// localStorage.setItem('displayColors', x) — старая запись, процитирована",
        "/* storage.setItem('widgetColors', y) */"
    ].join('\n');
    const keys = writtenKeys(sample);
    assert.ok(keys.has('clockColors'), 'запись литералом не найдена — сканер слеп');
    assert.ok(keys.has('clockWidgetSettings'), 'запись через STORAGE_KEYS не найдена — сканер слеп');
    assert.ok(!keys.has('displayColors') && !keys.has('widgetColors'), 'комментарий принят за запись');
});

test('окно часов не пишет clockWidgetSettings и clockColors — только читает', () => {
    const keys = writtenKeys(readSource('electron-clock-widget.html'));
    // Самопроверка на НАСТОЯЩЕМ файле: окно часов пишет флаг подсказки, и
    // сканер обязан его увидеть — иначе он не видит этот исходник вовсе.
    assert.ok(keys.has('clockHintShown'), 'сканер не нашёл заведомую запись clockHintShown в окне часов');
    for (const key of OWNED) {
        assert.ok(!keys.has(key), `окно часов пишет ${key}: у ключа должен быть один писатель — панель`);
    }
});

test('писатель обоих ключей — панель', () => {
    // control-app.js — цвета (saveColors), panel-clock.js — настройки и стиль.
    const keys = writtenKeys(readRaw('control-app.js') + '\n' + readRaw('panel-clock.js'));
    for (const key of OWNED) {
        assert.ok(keys.has(key), `панель обязана писать ${key}`);
    }
    // Запись настроек и стиля — методы ПРИМЕСИ: без Object.assign их нет у
    // контроллера, и падение пришло бы не при загрузке, а при первом клике.
    assert.match(codeOnly(readRaw('control-app.js')),
        /Object\.assign\(TimerController\.prototype, window\.PanelClockMixin\)/);
});
