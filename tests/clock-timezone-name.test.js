'use strict';

/**
 * Название часового пояса на плашке часов: ВСЕ подчёркивания — пробелы
 * (аудит 27.10.2026, RENDERERS-03).
 *
 * `replace('_', ' ')` со строковым образцом меняет только первое вхождение:
 * 'America/Port_of_Spain' показывался как «Port of_Spain».
 *
 * Метод вынимается из исходника и исполняется с подставным Intl.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { balancedBlockAt, maskNonCode } = require('./helpers/source-scan');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'clock-widget-app.js'), 'utf8');

function formatFor(timeZone) {
    const mask = maskNonCode(SRC);
    const m = /\n\s+formatTimezoneString\(\)\s*\{/.exec(mask);
    assert.ok(m, 'formatTimezoneString не найден');
    const block = balancedBlockAt(SRC, m.index, 'formatTimezoneString');
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    const fakeIntl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) };
     
    return new Function('Intl', body).call({}, fakeIntl);
}

test('пояс с несколькими подчёркиваниями: все стали пробелами', () => {
    assert.match(formatFor('America/Port_of_Spain'), / • Port of Spain$/);
    assert.match(formatFor('Africa/Dar_es_Salaam'), / • Dar es Salaam$/);
});

test('пояс с одним подчёркиванием и без него — как прежде', () => {
    assert.match(formatFor('America/New_York'), / • New York$/);
    assert.match(formatFor('Europe/Moscow'), / • Moscow$/);
});
