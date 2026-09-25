'use strict';

/**
 * BUG-10: картинка фона дисплея едет по каналу только при СМЕНЕ.
 *
 * Панель слала весь фон (до ~13 М символов base64) в `display-settings-update`
 * на каждое нажатие клавиши в названии мероприятия и каждый шаг ползунка —
 * главному процессу, а он — дисплею и часам. Теперь ключ `bgLocalImage` есть
 * в payload, только когда картинка сменилась: отсутствие = «без изменений»,
 * пустая строка = «картинки нет». Главный процесс помнит последнюю
 * (tests/relay-payload.test.js, electron-main-load), дисплей — свою копию.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { codeOnly } = require('./helpers/source-scan');

const { attachChangedBgImage } = require('../panel-display.js');

const IMG = 'data:image/png;base64,AAAA';

test('BUG-10: первая посылка несёт картинку, повторная — нет', () => {
    const first = {};
    let sent = attachChangedBgImage(first, IMG, undefined);
    assert.equal(first.bgLocalImage, IMG);
    assert.equal(sent, IMG);

    const typed = {};
    sent = attachChangedBgImage(typed, IMG, sent);
    assert.ok(!('bgLocalImage' in typed), 'та же картинка ушла второй раз');
    assert.equal(sent, IMG);
});

test('BUG-10: смена картинки и её снятие — едут', () => {
    const next = {};
    let sent = attachChangedBgImage(next, 'data:image/png;base64,BBBB', IMG);
    assert.equal(next.bgLocalImage, 'data:image/png;base64,BBBB');

    const cleared = {};
    sent = attachChangedBgImage(cleared, '', sent);
    assert.equal(cleared.bgLocalImage, '', 'снятие картинки обязано дойти');
    assert.equal(sent, '');

    const still = {};
    attachChangedBgImage(still, '', sent);
    assert.ok(!('bgLocalImage' in still));
});

const read = (f) => codeOnly(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));

test('BUG-10: pushDisplaySettings не кладёт картинку в payload мимо attachChangedBgImage', () => {
    const src = read('panel-display.js');
    const body = src.slice(src.indexOf('pushDisplaySettings() {'), src.indexOf('bindDisplayBlockControls() {'));
    assert.ok(body.length > 100, 'тело pushDisplaySettings не найдено');
    assert.doesNotMatch(body, /bgLocalImage\s*:/, 'картинка снова в литерале payload — едет на каждое нажатие');
    assert.match(body, /attachChangedBgImage\(\s*settings,/);
    // Самопроверка регулярки на старом тексте.
    assert.match("bgLocalImage: this.currentBgMode === 'local' ? localBgImage : '',", /bgLocalImage\s*:/);
});

test('BUG-10: дисплей держит свою копию картинки и не декодирует её заново без смены', () => {
    const src = read('display-script.js');
    const apply = src.slice(src.indexOf('applyBackground(settings) {'), src.indexOf('applyBackgroundTone(settings, mode) {'));
    // Отсутствие ключа — «без изменений»: берётся запомненная копия.
    assert.match(apply, /hasOwnProperty\.call\(settings, 'bgLocalImage'\)/);
    assert.match(apply, /this\._bgLocalImage/);
    const local = src.slice(src.indexOf('applyLocalBackground(imageData, fit, overlay) {'), src.indexOf('removeLocalBackgroundOverlay() {'));
    assert.match(local, /this\._appliedBgImage\s*===\s*imageData/,
        'картинка ставится заново на каждую посылку — Chromium декодирует её снова');
});
