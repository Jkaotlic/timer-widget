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
        // `clock-settings` (дата, пояс, секунды, 24 ч, цифры циферблата)
        // досылается с 09.09.2026. До этого главный процесс канал только
        // РЕТРАНСЛИРОВАЛ и ничего о нём не помнил: окно, открытое после того
        // как панель прислала настройки, знало о них лишь потому, что читает
        // тот же localStorage. Ровно там, где эта подпорка не работает —
        // гонка старта в режиме съёмки, когда окна успевают прочитать
        // хранилище раньше, чем панель туда пишет, — снапшот и нужен.
        hydration: ['display-settings-update', 'clock-colors-update', 'clock-settings']
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

test('главный процесс ПОМНИТ настройки часов, а не только ретранслирует их', () => {
    // Досылать нечего, если обработчик канала ничего не сохраняет. Это вторая
    // половина того же снапшота, и без неё первая зелёная и бесполезная.
    const body = ipcHandlerBody(source, 'clock-widget-settings');
    assert.match(
        body,
        /lastClockSettings\s*=/,
        'clock-widget-settings обязан запоминать настройки — иначе новому окну нечего досылать'
    );
    // Панель шлёт и ЧАСТИЧНЫЕ наборы (тест e2e digits-style шлёт три поля из
    // девяти). Снимок обязан накапливаться, иначе досылка стирает всё, чего
    // не было в последнем сообщении.
    assert.match(
        body,
        /(\.\.\.\s*\(?\s*lastClockSettings|Object\.assign\(\s*\{\s*\}\s*,\s*lastClockSettings)/,
        'снимок настроек часов обязан НАКАПЛИВАТЬСЯ: панель шлёт и частичные наборы. '
        + 'Годится и спред, и Object.assign — проверяется накопление, а не синтаксис'
    );
});
