'use strict';

/**
 * Клавиша звука (просьба 24.08.2026: «и для звуков тогда отдельную кнопульку»).
 *
 * Три окна и панель уже умеют открывать и закрывать окна буквами W / C / D, и
 * строка «Звуки» стояла в том же списке БЕЗ клавиши — то есть выглядела как
 * такая же строка, а вела себя иначе. Клавиша — `Z`: «звук» по-русски, а `S`
 * давно занята паузой, `M` — свёрткой панели в полосу.
 *
 * Главное здесь не сама клавиша, а ЧИСЛО ВЛАДЕЛЬЦЕВ. У мастер-звука их было
 * два: чекбокс `#soundMasterEnabled` в ящике (он сохраняется таблицей настроек)
 * и тумблер строки `#soundMasterToggle` (он писал свой `soundEnabled` в
 * localStorage и красил сам себя). Они не сообщались: выключенный в ящике звук
 * оставлял строку зелёной, а `playSound` спрашивал ОБА флага — то есть тумблер
 * строки мог показывать «включено» и молчать. Третий вход (клавиша и посылка из
 * чужого окна) обязан был идти тем же путём, а не добавить третью копию.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const read = (name) => codeOnly(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));

test('строка «Звуки» называет клавишу и что она делает', () => {
    const src = read('electron-control.html');
    const at = src.indexOf('id="soundMasterToggle"');
    assert.ok(at > 0, 'в панели нет тумблера звука');
    const from = src.lastIndexOf('<div class="wrow">', at);
    const chunk = src.slice(from, at);
    assert.match(chunk, /<kbd>Z<\/kbd>/, 'в строке «Звуки» не названа клавиша Z');
    assert.match(chunk, /вкл\/выкл/, 'клавиша названа, но не сказано, что она делает');
});

test('у мастер-звука ОДИН путь переключения — его зовут все три входа', () => {
    const panel = read('electron-control.html');
    const state = read('panel-state.js');

    assert.match(state, /toggleSoundMaster\(\)\s*\{/, 'нет единственного пути переключения звука');

    // 1. Клик по тумблеру строки.
    assert.match(
        state, /soundMaster\?\.addEventListener\('click', \(\) => this\.toggleSoundMaster\(\)\)/,
        'тумблер строки снова переключает звук в обход общего пути'
    );
    // 2. Клавиша в самой панели.
    assert.match(
        panel, /event\.code === 'KeyZ'[\s\S]{0,200}?toggleSoundMaster\(\)/,
        'клавиша Z в панели не ведёт к общему пути'
    );
    // 3. Посылка из чужого окна.
    assert.match(
        state, /'sound-toggle'[\s\S]{0,200}?toggleSoundMaster\(\)/,
        'канал sound-toggle не ведёт к общему пути'
    );
});

test('вид тумблера строки выводится из чекбокса, а не хранится вторым флагом', () => {
    const state = read('panel-state.js');
    assert.match(state, /renderSoundRow\(\)\s*\{/, 'нет отрисовки строки звука из чекбокса');

    // Единственное место, где красится тумблер строки.
    const painters = (state.match(/soundMasterToggle/g) || []).length
        + (read('electron-control.html').match(/getElementById\('soundMasterToggle'\)/g) || []).length;
    assert.ok(
        painters <= 2,
        `тумблер строки звука упоминается ${painters} раз — вторая копия его состояния вернулась`
    );
});

test('все три окна шлют sound-toggle по клавише Z', () => {
    for (const file of ['electron-widget.html', 'electron-clock-widget.html', 'display-script.js']) {
        const src = read(file);
        assert.match(
            src, /case 'KeyZ':[\s\S]{0,200}?send\('sound-toggle'\)/,
            `${file}: клавиша Z не просит панель переключить звук`
        );
    }
});

test('канал объявлен в обоих списках — и в валидаторе, и в мосте', () => {
    // Оба конца проверяет tests/ipc-liveness.test.js; здесь — что канал вообще
    // объявлен, иначе preload молча отбросит посылку.
    for (const file of ['channel-validator.js', 'preload.js']) {
        const src = read(file);
        const hits = (src.match(/'sound-toggle'/g) || []).length;
        assert.equal(hits, 2, `${file}: канал sound-toggle объявлен ${hits} раз вместо двух (send + receive)`);
    }
});
