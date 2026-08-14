'use strict';

/**
 * У поля настроек должен быть ОДИН владелец.
 *
 * `timerStyle` и `timerScale` принадлежали двум окнам сразу:
 *   • в localStorage (`displayExtSettings`) это стиль/масштаб ВИДЖЕТА —
 *     settings-schema.js пишет их туда через `alsoWrite` ради отката на
 *     предыдущую версию приложения;
 *   • в IPC-пакете `display-settings-update` под теми же именами панель шлёт
 *     стиль/масштаб ДИСПЛЕЯ.
 *
 * Одна и та же функция `applyDisplaySettings` принимает и то, и другое: по IPC —
 * от панели, а на старте — из хранилища (`loadBackgroundSettings`). Поэтому
 * полноэкранное окно на первом кадре рисовало стиль виджета, а `_lastPushedTimerScale`
 * засевался чужим масштабом, из-за чего защита «первый пуш не затирает локальный
 * масштаб» уходила не в ту ветку и была фактически мертва.
 *
 * Лечится не подпоркой на приёме, а именем: у настоящего владельца есть СВОЁ имя
 * (`displayTimerStyle`), и оно главнее общего. Общее остаётся запасным — иначе
 * сломался бы откат версии и существующие e2e, которые шлют голый `timerStyle`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pickOwnSetting } = require('../renderer-shared');
const { codeOnly } = require('./helpers/source-scan');

// Локальное имя оставлено читаемым: во всех проверках ниже речь именно о выборе
// «своё имя против общего».
const pickDisplaySetting = pickOwnSetting;

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('своё имя главнее общего, когда в наборе есть оба', () => {
    // Случай хранилища: displayExtSettings несёт ОБА поля, и `timerStyle` там —
    // стиль виджета. Раньше дисплей брал именно его.
    const bag = { timerStyle: 'flip', displayTimerStyle: 'analog' };
    assert.equal(pickDisplaySetting(bag, 'displayTimerStyle', 'timerStyle'), 'analog');

    const scales = { timerScale: 250, displayTimerScale: 100 };
    assert.equal(pickDisplaySetting(scales, 'displayTimerScale', 'timerScale'), 100);
});

test('общее имя остаётся запасным, когда своего нет', () => {
    // Так выглядят пакеты от старой версии панели и от существующих e2e-спеков,
    // которые шлют голый timerStyle (e2e/flip-animation.spec.js, analog-hour-hand).
    assert.equal(pickDisplaySetting({ timerStyle: 'digital' }, 'displayTimerStyle', 'timerStyle'), 'digital');
    assert.equal(pickDisplaySetting({ timerScale: 175 }, 'displayTimerScale', 'timerScale'), 175);
});

test('отсутствие обоих имён — это undefined, а не подстановка умолчания', () => {
    // Вызывающий код обязан отличить «настройку не прислали» от «прислали
    // значение»: applyDisplaySettings не должен трогать стиль, если о нём молчат.
    assert.equal(pickDisplaySetting({}, 'displayTimerStyle', 'timerStyle'), undefined);
    assert.equal(pickDisplaySetting({ other: 1 }, 'displayTimerStyle', 'timerStyle'), undefined);
});

test('нулевые и ложные значения своего имени не проваливаются в запасное', () => {
    // Масштаб 0 бессмыслен, но проверка именно на undefined, а не на
    // истинность — иначе `displayTimerScale: 0` молча взяло бы масштаб виджета.
    assert.equal(pickDisplaySetting({ displayTimerScale: 0, timerScale: 300 }, 'displayTimerScale', 'timerScale'), 0);
    assert.equal(pickDisplaySetting({ displayTimerStyle: '', timerStyle: 'flip' }, 'displayTimerStyle', 'timerStyle'), '');
});

test('мусор вместо набора настроек не роняет выбор', () => {
    for (const junk of [null, undefined, 'строка', 42, true]) {
        assert.equal(pickDisplaySetting(junk, 'displayTimerStyle', 'timerStyle'), undefined);
    }
});

test('дисплей больше не читает общий timerStyle напрямую', () => {
    const code = codeOnly(read('display-script.js'));

    assert.match(
        code,
        /pickOwnSetting\(settings,\s*'displayTimerStyle',\s*'timerStyle'\)/,
        'стиль должен выбираться через владельца ключа'
    );
    assert.match(
        code,
        /pickOwnSetting\(settings,\s*'displayTimerScale',\s*'timerScale'\)/,
        'масштаб должен выбираться через владельца ключа'
    );
    // Прежнее прямое чтение не должно вернуться ни в одном из двух мест.
    assert.doesNotMatch(code, /if\s*\(settings\.timerStyle\)/);
    assert.doesNotMatch(code, /settings\.timerScale\s*!==\s*undefined/);
});

test('панель шлёт стиль и масштаб дисплея под собственными именами', () => {
    const code = codeOnly(read('electron-control.html'));

    assert.match(code, /displayTimerStyle:/, 'пакет display-settings-update должен нести displayTimerStyle');
    assert.match(code, /displayTimerScale:/, 'пакет display-settings-update должен нести displayTimerScale');
    // Общие имена остаются — на них опираются откат версии и существующие e2e.
    assert.match(code, /timerStyle:\s*this\.displayTimerStyleEl/);
});

test('виджет не применяет стиль из настроек полноэкранного режима', () => {
    // Зеркало уже исправленного места в часах (electron-clock-widget.html):
    // `timerStyle` в сообщении display-settings-update — стиль ПОЛНОЭКРАННОГО
    // режима, и виджет, применив его, молча получал чужой стиль в обход
    // адресного канала widget-style-update.
    const code = codeOnly(read('electron-widget.html'));

    assert.doesNotMatch(
        code,
        /settings\.timerStyle\s*&&\s*!this\._hasWidgetStyle/,
        'виджет должен брать свой стиль только из widget-style-update'
    );

    // Обработчик display-settings-update не должен трогать стиль вообще.
    const handler = code.slice(code.indexOf('displaySettingsUpdateHandler'));
    const handlerEnd = handler.indexOf('widgetStyleUpdateHandler');
    assert.ok(handlerEnd > 0, 'оба обработчика должны существовать');
    assert.doesNotMatch(
        handler.slice(0, handlerEnd),
        /setTimerStyle\(/,
        'display-settings-update не владеет стилем виджета'
    );

    // А самозагрузка из localStorage обязана спрашивать СВОЁ имя первым.
    assert.match(
        code,
        /pickOwnSetting\(settings,\s*'widgetTimerStyle',\s*'timerStyle'\)/,
        'виджет должен читать свой ключ, а не общий'
    );
});

test('полноэкранное окно не показывает два стиля одновременно на первом кадре', () => {
    // initDefaultStyle безусловно вешает style-circle и .active на кольцо, ничего
    // не снимая. Стоя ПОСЛЕ loadColors (который через loadBackgroundSettings уже
    // вызвал setTimerStyle), он добавлял второй класс стиля поверх выбранного.
    const code = codeOnly(read('display-script.js'));
    const initAt = code.indexOf('this.initDefaultStyle();');
    const loadAt = code.indexOf('this.loadColors();');

    assert.ok(initAt !== -1 && loadAt !== -1, 'оба вызова должны существовать в конструкторе');
    assert.ok(
        initAt < loadAt,
        'initDefaultStyle обязан идти ДО loadColors: иначе он затирает уже применённый стиль'
    );
});

test('у делений циферблата один владелец в хранилище', () => {
    // showTicks существовал в ДВУХ местах хранилища: собственный ключ
    // `clockShowTicks`, из которого часы восстанавливают деления при
    // инициализации, и поле внутри `clockWidgetSettings`, которое панель писала,
    // а не читал никто. Вторая копия настройки — это будущее расхождение.
    // По IPC поле идёт по-прежнему: там его ждёт обработчик clock-widget-settings.
    const control = codeOnly(read('electron-control.html'));
    const clock = codeOnly(read('electron-clock-widget.html'));

    const push = control.slice(control.indexOf('pushClockSettings()'));
    const body = push.slice(0, push.indexOf('loadClockSettings()'));

    // Тумблер переехал во вкладку ЧАСОВ вместе с самой настройкой: у виджета
    // таймера делений больше нет, там кольцо обратного отсчёта.
    assert.match(body, /showTicks: this\.clockShowTicksEl/, 'в IPC-пакете showTicks обязан остаться');
    assert.match(
        body,
        /JSON\.stringify\(\{ \.\.\.prevClock, \.\.\.persisted \}\)/,
        'в хранилище уходит НАБОР ИЗ ТАБЛИЦЫ, без делений — у них свой ключ'
    );
    assert.doesNotMatch(
        body,
        /JSON\.stringify\(\{ \.\.\.prevClock, \.\.\.settings \}\)/,
        'в хранилище уходит весь пакет вместе с showTicks'
    );

    // А владелец на месте: часы восстанавливают деления из своего ключа.
    assert.match(clock, /localStorage\.getItem\('clockShowTicks'\)/);
});
