'use strict';

/**
 * У события «окно открылось» должен быть ОДИН владелец — функция создания окна.
 *
 * Работа по открытию окна была размазана по двум местам: create-функция строила
 * окно, а объявление «я открылся» и досылка состояния жили в обработчике
 * `ipcMain.on('open-*')`. Пункты трея зовут create-функции НАПРЯМУЮ, поэтому
 * мимо них проходило всё: другие окна не узнавали, что окно открыто, и не
 * получали ни `timer-state`, ни сохранённых настроек с цветами.
 *
 * Воспроизводится руками: открыть виджет из трея → кнопка «Виджет» в панели
 * осталась неактивной → нажатие W шлёт `open-widget` → главный процесс видит
 * живое окно и делает только `focus()`, ничего не рассылая → переключатель мёртв,
 * пока окно не закроют (обработчик 'closed' восстанавливает синхронизацию).
 *
 * Тот же корень у панели: `bindTrayBehavior` вызывался один раз в `whenReady`,
 * поэтому панель, пересозданная из трея, из second-instance или по 'activate',
 * теряла поведение «закрытие = скрытие в трей».
 *
 * Проверяем структурой, а не текстом: тело функции вырезается балансировкой
 * скобок (tests/helpers/source-scan.js), поэтому отступ и вложенность значения
 * не имеют.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { functionBody, ipcHandlerBody } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'electron-main.js'), 'utf8');

const WINDOWS = [
    {
        create: 'createWidgetWindow',
        channel: 'widget-window-state',
        opener: 'open-widget',
        // Что окно обязано получить сразу после загрузки, кем бы оно ни было открыто.
        hydration: ['timer-state', 'display-settings-update', 'widget-colors-update', 'widget-style-update']
    },
    {
        create: 'createClockWidgetWindow',
        channel: 'clock-window-state',
        opener: 'open-clock-widget',
        hydration: ['display-settings-update', 'clock-colors-update']
    },
    {
        create: 'createDisplayWindow',
        channel: 'display-window-state',
        opener: 'open-display',
        hydration: ['timer-state', 'display-settings-update', 'display-colors-update']
    }
];

for (const win of WINDOWS) {
    test(`${win.create} сам объявляет, что окно открылось`, () => {
        const body = functionBody(source, win.create);
        assert.match(
            body,
            new RegExp(`announceWindowOpened\\([A-Za-z_$][\\w$]*,\\s*'${win.channel}'`),
            `${win.create} должна объявлять открытие сама — иначе путь через трей проходит мимо всех окон`
        );
    });

    test(`${win.create} сама гидратирует новое окно`, () => {
        const body = functionBody(source, win.create);
        for (const channel of win.hydration) {
            assert.ok(
                body.includes(`'${channel}'`),
                `${win.create} должна досылать ${channel} — иначе окно, открытое из трея, его не получит`
            );
        }
    });

    test(`обработчик ${win.opener} не дублирует работу create-функции`, () => {
        // Обработчик обязан остаться тонким: создать окно либо сфокусировать
        // существующее. Если досылка снова заведётся здесь, она снова разойдётся
        // с путём через трей — то есть вернётся ровно тот дефект.
        const body = ipcHandlerBody(source, win.opener);
        assert.doesNotMatch(
            body,
            /webContents\.on\('did-finish-load'/,
            `${win.opener}: гидратация принадлежит ${win.create}, а не обработчику канала`
        );
    });
}

test('announceWindowOpened рассылает открытие и переживает перезагрузку рендерера', () => {
    const body = functionBody(source, 'announceWindowOpened');

    assert.match(
        body,
        /broadcastWindowState\(stateChannel,\s*\{\s*isOpen:\s*true\s*\}\)/,
        'объявление открытия обязано быть рассылкой всем окнам, а не адресным сообщением панели'
    );
    // `once` здесь был бы тихой поломкой: краш-обработчик перезагружает рендерер
    // (bindRenderCrashHandler → win.reload()), и после перезагрузки окно осталось
    // бы без состояния таймера, цветов и настроек — ровно как окно, открытое из трея.
    assert.match(body, /webContents\.on\('did-finish-load'/);
    assert.doesNotMatch(body, /webContents\.once\('did-finish-load'/);
});

test('панель, пересозданная из трея, не теряет поведение сворачивания', () => {
    const body = functionBody(source, 'createControlWindow');
    assert.match(
        body,
        /bindTrayBehavior\(/,
        'createControlWindow должна привязывать поведение трея сама — панель пересоздаётся из трея, из second-instance и по activate'
    );
});

test('payload из рендерера нормализуется, а не деструктурируется вслепую', () => {
    // `payload = {}` спасает только от undefined: явный null доходит до
    // деструктуризации и роняет обработчик. Готовый isPayloadObject лежит в том
    // же файле и уже применён в moveWindowBy / resizeWindowClamped /
    // positionWindowClamped / report-scale / ui-theme-update.
    for (const channel of ['timer-command', 'open-display']) {
        const body = ipcHandlerBody(source, channel);
        assert.match(
            body,
            /isPayloadObject\(/,
            `${channel} должен проверять payload через isPayloadObject`
        );
    }

    // Отдельно: у open-display ОТСУТСТВИЕ payload — легальный случай. Виджет и
    // часы по клавише D шлют канал без аргументов, и это означает «взять
    // последний выбранный монитор» (electron-widget.html, electron-clock-widget.html).
    // Поэтому здесь нормализация к {}, а НЕ ранний выход, иначе клавиша D умрёт.
    const openDisplay = ipcHandlerBody(source, 'open-display');
    assert.doesNotMatch(
        openDisplay,
        /if\s*\(!isPayloadObject\([A-Za-z_$][\w$]*\)\)\s*\{\s*return/,
        'open-display без payload обязан работать — это клавиша D в виджете и часах'
    );
});
