'use strict';

/**
 * У каждого канала IPC должны быть ОБА конца.
 *
 * `channel-validator.test.js` проверяет, что белые списки в `preload.js` и
 * `channel-validator.js` совпадают между собой. Но совпадать они могут и на
 * канале, которого больше нет ни у кого: список — это разрешение, а не признак
 * жизни. В проекте нашлись сразу три таких места:
 *
 *   - `widget-set-opacity` — обработчик в главном процессе, оба белых списка,
 *     ноль отправителей: прозрачностью виджета не управляло ничто;
 *   - `close-window` — то же самое, окна закрываются адресными каналами;
 *   - `timer-recovery-available` — отправка была, приёмника не было НИ ОДНОГО,
 *     причём рядом с отправкой стоял комментарий «канал больше не мёртвый код».
 *
 * Каждое из трёх — расширение поверхности IPC ради несуществующей функции, а
 * третье вдобавок молча съедало сообщение пользователю после сбоя.
 *
 * Проверка идёт по исходникам, потому что каналы — это строки, и никакой
 * системы типов между процессами здесь нет. Косвенные отправители учитываются:
 * события таймера уходят через callback `onEvent(name)` из `timer-controller.js`,
 * а список экранов — через `event.sender.send`, поэтому «сторона главного
 * процесса» — это все её файлы, а не только `ipcMain.on(...)`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const { ALLOWED_CHANNELS } = require('../channel-validator.js');

// Рендереры: окна и их модули. Отправка и приём живут только здесь.
const RENDERER_FILES = [
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html',
    'display-script.js',
    'custom-sounds.js',
    'local-background.js',
    'color-picker.js',
    'shortcuts-help.js',
    'ui-theme.js',
    'flip-card.js',
    'settings-schema.js',
    'ipc-compat.js'
];

// Сторона главного процесса: сам процесс и модули, из которых он шлёт события.
const MAIN_FILES = ['electron-main.js', 'timer-controller.js', 'timer-engine.js', 'recovery.js'];

const rendererSrc = RENDERER_FILES.map((f) => `\n/* ${f} */\n` + read(f)).join('\n');
const mainSrc = MAIN_FILES.map((f) => `\n/* ${f} */\n` + read(f)).join('\n');

// Комментарии срезаем: объяснение, почему канала больше нет, само называет его
// имя — и без этого «удалённый» канал выглядел бы живым.
const codeOnly = (src) => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const rendererCode = codeOnly(rendererSrc);
const mainCode = codeOnly(mainSrc);

test('у каждого разрешённого send-канала есть отправитель в рендерере', () => {
    // Объект-отправитель не обязан называться ipcRenderer: ui-theme.js получает
    // его параметром (`bindThemeSync(ipc)`), потому что подключается ко всем
    // четырём окнам. Поэтому смотрим на вызов, а не на имя переменной — файлы
    // рендереров других `.send(` не содержат.
    const orphans = ALLOWED_CHANNELS.send.filter((channel) => {
        const re = new RegExp(`\\.send\\(\\s*['"\`]${channel}['"\`]`);
        return !re.test(rendererCode);
    });

    assert.deepEqual(
        orphans, [],
        'канал разрешён к отправке, но его никто не шлёт — это разрешение без функции: '
        + orphans.join(', ')
    );
});

test('у каждого разрешённого send-канала есть обработчик в главном процессе', () => {
    const unhandled = ALLOWED_CHANNELS.send.filter((channel) => {
        const re = new RegExp(`ipcMain\\.(?:on|handle)\\(\\s*['"\`]${channel}['"\`]`);
        return !re.test(mainCode);
    });

    assert.deepEqual(
        unhandled, [],
        'рендерер может слать канал, который главный процесс не слушает — команда уйдёт в пустоту: '
        + unhandled.join(', ')
    );
});

test('у каждого разрешённого receive-канала есть слушатель в рендерере', () => {
    // Именно на этом попался `timer-recovery-available`: отправка была, слушателя
    // не было, и сообщение о восстановлении после сбоя не доходило ни до кого.
    const unheard = ALLOWED_CHANNELS.receive.filter((channel) => {
        const re = new RegExp(`\\.on\\(\\s*['"\`]${channel}['"\`]`);
        return !re.test(rendererCode);
    });

    assert.deepEqual(
        unheard, [],
        'главный процесс может слать канал, который не слушает ни одно окно: ' + unheard.join(', ')
    );
});

test('у каждого разрешённого receive-канала есть отправитель на стороне главного процесса', () => {
    const unsent = ALLOWED_CHANNELS.receive.filter((channel) => !mainCode.includes(`'${channel}'`));

    assert.deepEqual(
        unsent, [],
        'окно слушает канал, которого никто не шлёт — мёртвый слушатель: ' + unsent.join(', ')
    );
});

test('удалённые каналы не вернулись', () => {
    // Три канала удалены осознанно (см. заголовок файла). Проверка отдельная,
    // потому что вернуть их можно и не через белый список — просто дописав
    // обработчик; тогда он опять будет висеть без единого отправителя.
    for (const channel of ['widget-set-opacity', 'close-window']) {
        assert.ok(
            !ALLOWED_CHANNELS.send.includes(channel) && !ALLOWED_CHANNELS.receive.includes(channel),
            `${channel} вернулся в белый список`
        );
        assert.doesNotMatch(
            mainCode, new RegExp(`ipcMain\\.(?:on|handle)\\(\\s*['"\`]${channel}['"\`]`),
            `${channel}: обработчик вернулся, а отправителя по-прежнему нет`
        );
    }
});

test('панель показывает, что время восстановлено после сбоя', () => {
    // Смысл канала: главный процесс возвращает время сам, а пользователю об этом
    // говорит панель. Без сообщения после сбоя на экране стоит время, взявшееся
    // ниоткуда.
    const control = read('electron-control.html');
    assert.match(control, /ipcRenderer\.on\('timer-recovery-available'/);
    const handler = control.match(/this\._onRecoveryAvailable = \([\s\S]*?\n {16}\};/);
    assert.ok(handler, 'обработчик восстановления должен существовать');
    assert.match(handler[0], /Toast\.show\(/, 'о восстановлении надо сказать пользователю');
    assert.match(handler[0], /formatTime/, 'в сообщении должно быть само время');
    // Слушатель обязан сниматься: панель пересоздаётся из трея и после падения
    // рендерера, а removeListener для остальных каналов здесь уже есть.
    assert.match(control, /removeListener\('timer-recovery-available'/);

    // И отправка на месте — иначе тест выше зелёный, а сообщать нечего.
    assert.match(read('electron-main.js'), /safelySendToWindow\(controlWindow, 'timer-recovery-available'/);
});

test('прозрачность часов больше не читается из ключа, которого никто не пишет', () => {
    const clock = codeOnly(read('electron-clock-widget.html'));
    assert.doesNotMatch(clock, /s\.opacity/, 'чтение без записи всегда возвращает undefined');
});
