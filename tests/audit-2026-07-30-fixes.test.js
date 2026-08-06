'use strict';

/**
 * Регрессии прохода 30.07.2026.
 *
 * Проход шёл по трём окнам-рендерерам и мелким модулям панели. Каждый тест ниже
 * фиксирует И наличие правильного поведения, И отсутствие прежнего сломанного —
 * иначе регресс возвращается незамеченным (см. CLAUDE.md, раздел Testing).
 *
 * Часть логики живёт внутри inline-<script> в HTML и не импортируется, поэтому
 * такие тесты читают исходник и проверяют его текст. Это осознанный компромисс,
 * принятый в проекте, а не лень: альтернатива — тащить весь Electron в unit-тесты.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// ---------------------------------------------------------------------------
// BUG-1 — разделитель flip в виджете таймера
// ---------------------------------------------------------------------------

test('виджет flip: в режиме с часами разделитель НЕ показывает текстовое двоеточие', () => {
    const src = read('electron-widget.html');

    // Базовое правило гасит глиф: точки рисуются через ::before/::after.
    assert.match(
        src,
        /\.widget-flip-separator \{[^}]*font-size: 0;/s,
        'базовое правило обязано держать font-size: 0 — иначе глиф ":" рисуется поверх точек'
    );

    // Правило адаптива для 6 цифр не имеет права возвращать шрифт.
    const hasHoursRule = src.match(/\.widget-flip\.has-hours \.widget-flip-separator \{([^}]*)\}/s);
    assert.ok(hasHoursRule, 'правило .widget-flip.has-hours .widget-flip-separator не найдено');
    assert.doesNotMatch(
        hasHoursRule[1],
        /font-size/,
        'font-size в has-hours возвращал глиф ":" к жизни — разделитель показывал и двоеточие, и точки'
    );

    // Вместо шрифта под карточку 44×64 подгоняются сами точки.
    assert.match(
        src,
        /\.widget-flip\.has-hours \.widget-flip-separator::before,\s*\.widget-flip\.has-hours \.widget-flip-separator::after \{[^}]*width: 4px/s,
        'в режиме с часами точки разделителя должны уменьшаться'
    );
});

// ---------------------------------------------------------------------------
// BUG-2 — вспышка завершения на полноэкранном дисплее
// ---------------------------------------------------------------------------

test('дисплей: вспышка завершения запускается один раз на завершение', () => {
    const src = read('display-script.js');

    // Прежнее условие перезапускало серию миганий на каждом обновлении
    // состояния, пока finished залатчен.
    assert.doesNotMatch(
        src,
        /if \(this\.finished && !this\.flashInterval\) \{/,
        'условие без защёлки перезапускало мигание после каждого доигранного цикла'
    );
    assert.match(
        src,
        /if \(this\.finished && !this\._finishEffectShown && !this\.flashInterval\)/,
        'нужна защёлка _finishEffectShown'
    );
    // И защёлка обязана сниматься, иначе второе завершение не мигнёт вообще.
    assert.match(
        src,
        /if \(!this\.finished\) \{ this\._finishEffectShown = false; \}/,
        'без снятия защёлки следующее завершение останется без вспышки'
    );
});

// ---------------------------------------------------------------------------
// BUG-3 — масштаб часов, выставленный ползунком панели
// ---------------------------------------------------------------------------

test('часы: изменение размера окна сохраняет геометрию (ползунок панели тоже)', () => {
    const src = read('electron-clock-widget.html');
    const handler = src.match(/onResizeScalePct = \(\) => \{(.*?)\n {16}\};/s);
    assert.ok(handler, 'обработчик resize в часах не найден');
    assert.match(
        handler[1],
        /if \(clockScalePct !== this\._geometry\.scalePct\) \{\s*this\.saveGeometry\(clockScalePct\);/s,
        'resize обязан сохранять геометрию — иначе масштаб из панели терялся при переоткрытии'
    );
});

test('виджет: изменение размера окна тоже сохраняет геометрию', () => {
    const src = read('electron-widget.html');
    const handler = src.match(/onResizeScalePct = \(\) => \{(.*?)\n {16}\};/s);
    assert.ok(handler, 'обработчик resize в виджете не найден');
    assert.match(
        handler[1],
        /if \(widgetScalePct !== this\._geometry\.scalePct\) \{\s*this\.saveGeometry\(widgetScalePct\);/s,
        'нативный ресайз за край окна не сохранялся'
    );
});

test('панель: ползунок масштаба часов восстанавливается из clockGeometry', () => {
    const src = read('electron-control.html');
    assert.match(
        src,
        /localStorage\.getItem\('clockGeometry'\)/,
        'панель обязана читать clockGeometry — своего значения масштаба часов у неё нет'
    );
    // Восстановление идёт присваиванием .value, которое НЕ порождает 'input',
    // иначе загрузка панели переслала бы масштаб в часы и затерла их размер.
    const block = src.match(/clockScaleSliderEl\.value = pct;/);
    assert.ok(block, 'значение ползунка часов не выставляется');
    assert.doesNotMatch(
        src,
        /clockScaleSliderEl\.dispatchEvent/,
        'ползунок часов нельзя дёргать событием: это отправило бы масштаб обратно в окно'
    );
});

// ---------------------------------------------------------------------------
// BUG-4 — модификаторы в горячих клавишах панели
// ---------------------------------------------------------------------------

test('панель: горячие клавиши игнорируют Ctrl/Alt/Cmd в одном месте', () => {
    const src = read('electron-control.html');
    const handler = src.match(/const _onGlobalShortcutsKeydown = \(event\) => \{(.*?)\n {8}\};/s);
    assert.ok(handler, 'глобальный обработчик горячих клавиш не найден');

    assert.match(
        handler[1],
        /if \(event\.ctrlKey \|\| event\.altKey \|\| event\.metaKey\) \{ return; \}/,
        'нужен единый guard модификаторов, как в остальных трёх окнах'
    );

    // Guard обязан стоять ДО первой ветки, иначе Space проскочит.
    const guardIdx = handler[1].indexOf('event.altKey || event.metaKey');
    const spaceIdx = handler[1].indexOf("event.code === 'Space'");
    assert.ok(guardIdx > -1 && spaceIdx > -1);
    assert.ok(guardIdx < spaceIdx, 'guard модификаторов должен стоять до ветки Space');

    // Прежние точечные проверки убраны — с единым guard они мертвы.
    assert.doesNotMatch(
        handler[1],
        /&& !event\.ctrlKey && !event\.metaKey/,
        'точечные проверки ctrl/meta теперь мертвы и только маскируют отсутствие altKey'
    );
});

// ---------------------------------------------------------------------------
// BUG-5 — таймеры перекидывания карточек
// ---------------------------------------------------------------------------

test('flip-card: сработавший таймер вычёркивается сам', async () => {
    const FlipCard = require('../flip-card');
    FlipCard.cancelPending(); // изолируем от других тестов файла

    const card = {
        classes: new Set(),
        digit: { textContent: '0' },
        querySelector() { return this.digit; },
        classList: {
            add(c) { card.classes.add(c); },
            remove(c) { card.classes.delete(c); },
            contains(c) { return card.classes.has(c); }
        }
    };

    flipTwice(FlipCard, card);
    await new Promise((r) => setTimeout(r, FlipCard.FLIP_DURATION_MS + 60));

    assert.equal(
        FlipCard.cancelPending(), 0,
        'после срабатывания таймеры обязаны исчезать из набора, иначе он растёт вечно'
    );
});

function flipTwice(FlipCard, card) {
    FlipCard.flipCardTo(card, '.digit', '1');
    FlipCard.flipCardTo(card, '.digit', '2');
}

test('flip-card: cancelPending гасит незавершённые таймеры и сообщает их число', () => {
    const FlipCard = require('../flip-card');
    FlipCard.cancelPending();

    const mk = (start) => {
        const classes = new Set();
        const digit = { textContent: start };
        return {
            querySelector: () => digit,
            classList: {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                contains: (c) => classes.has(c)
            }
        };
    };

    FlipCard.flipCardTo(mk('0'), '.digit', '1');
    FlipCard.flipCardTo(mk('0'), '.digit', '2');

    assert.equal(FlipCard.cancelPending(), 2);
    assert.equal(FlipCard.cancelPending(), 0, 'повторный вызов не должен ничего находить');
});

test('окна не ведут собственных списков таймеров перекидывания', () => {
    // Внешний учёт рос неограниченно: секунды тикают ежесекундно, а массив
    // очищался только при закрытии окна.
    for (const file of ['display-script.js', 'electron-widget.html', 'electron-clock-widget.html']) {
        const src = read(file);
        assert.doesNotMatch(src, /_flipTimeouts/, `${file}: внешний список таймеров flip вернулся`);
        assert.match(
            src,
            /FlipCard\.cancelPending\(\)/,
            `${file}: закрытие окна обязано гасить незавершённые таймеры через cancelPending()`
        );
    }
    assert.doesNotMatch(
        read('display-script.js'),
        /this\._timeouts/,
        'display-script: массив _timeouts копил уже сработавшие id'
    );
});

// ---------------------------------------------------------------------------
// BUG-11 — снимок состояния окон для окна, загрузившегося позже
// ---------------------------------------------------------------------------

test('главный процесс досылает состояние окон каждому окну после загрузки', () => {
    const src = read('electron-main.js');

    assert.match(
        src,
        /function sendWindowStatesTo\(win\) \{[\s\S]*?'widget-window-state'[\s\S]*?'clock-window-state'[\s\S]*?'display-window-state'/,
        'нужен снимок всех трёх состояний одному адресату'
    );

    // Слушатель обязан быть `on`, а не `once`: перезагрузка рендерера
    // краш-обработчиком должна получить снимок заново.
    assert.match(
        src,
        /function bindWindowStateSnapshot\(win\) \{[\s\S]*?webContents\.on\('did-finish-load'/,
        'once() не сработает после win.reload() из bindRenderCrashHandler'
    );

    // Подключено ко всем четырём окнам.
    const wired = [...src.matchAll(/^ {4}bindWindowStateSnapshot\((\w+)\);/gm)].map((m) => m[1]);
    assert.deepEqual(
        wired.sort(),
        ['clockWidgetWindow', 'controlWindow', 'displayWindow', 'widgetWindow'],
        'снимок должен подключаться ко всем четырём окнам'
    );
});

// ---------------------------------------------------------------------------
// BUG-6 — удаление пользовательского звука
// ---------------------------------------------------------------------------

test('удаление своего звука снимает его со всех событий', () => {
    const src = read('custom-sounds.js');
    const fn = src.match(/deleteCustomSound\(name\) \{(.*?)\n {4}\}/s);
    assert.ok(fn, 'deleteCustomSound не найдена');

    assert.match(fn[1], /const dead = `custom:\$\{name\}`/, 'нужно вычислить удаляемое значение');
    assert.match(
        fn[1],
        /select\.value === dead\) \{\s*select\.value = 'none'/s,
        'событие с удалённым звуком обязано вернуться к «— без звука —»'
    );
    assert.match(
        fn[1],
        /saveExtSettings\(\)/,
        'без сохранения в displayExtSettings остаётся мёртвый custom:<имя>'
    );
});

// ---------------------------------------------------------------------------
// BUG-7 — повторный F1
// ---------------------------------------------------------------------------

test('справка F1: повторный вызов снимает и узел, и слушатель Escape', () => {
    const src = read('shortcuts-help.js');
    assert.match(
        src,
        /overlay\._closeOverlay = closeOverlay;/,
        'закрытие обязано быть доступно снаружи'
    );
    assert.match(
        src,
        /if \(typeof existing\._closeOverlay === 'function'\) \{ existing\._closeOverlay\(\); \}/,
        'повторный F1 должен звать полное закрытие, а не голый remove()'
    );
});

// ---------------------------------------------------------------------------
// BUG-8 — Escape в поле ручного ввода масштаба
// ---------------------------------------------------------------------------

test('поле масштаба: Escape отменяет ввод окончательно', () => {
    const src = read('scale-input.js');
    assert.match(src, /let settled = false;/, 'нужен флаг однократного закрытия');
    assert.match(
        src,
        /const applyValue = \(\) => \{\s*if \(settled\) \{ return; \}\s*settled = true;/s,
        'applyValue обязан быть идемпотентным'
    );
    assert.match(
        src,
        /ev\.key === 'Escape'\) \{\s*ev\.preventDefault\(\);\s*settled = true;/s,
        'Escape обязан помечать ввод отменённым, иначе долетевший blur применит значение'
    );
});

// ---------------------------------------------------------------------------
// BUG-9 — часы «Текущее время» на дисплее
// ---------------------------------------------------------------------------

test('дисплей: часы текущего времени идут по самокорректирующемуся таймеру', () => {
    const src = read('display-script.js');
    const fn = src.match(/startCurrentTimeClock\(\) \{(.*?)\n {4}\}/s);
    assert.ok(fn, 'startCurrentTimeClock не найдена');

    assert.doesNotMatch(
        fn[1],
        /setInterval\(updateClock, 1000\)/,
        'ровный setInterval дрейфует от границы секунды — секунда начинает прыгать через одну'
    );
    assert.match(
        fn[1],
        /1000 - \(Date\.now\(\) % 1000\)/,
        'нужен пересчёт до следующей границы секунды, как в виджете часов'
    );
    // И таймер обязан гаситься при закрытии окна.
    assert.match(
        src,
        /clearTimeout\(this\._currentTimeTimeout\)/,
        'самокорректирующийся таймер должен очищаться в cleanup()'
    );
});

// ---------------------------------------------------------------------------
// BUG-10 — стиль часов не берётся от полноэкранного режима
// ---------------------------------------------------------------------------

test('часы: стиль применяется только из clockStyle, не из timerStyle дисплея', () => {
    const src = read('electron-clock-widget.html');
    const handler = src.match(/_onDisplaySettingsUpdate = \(event, settings\) => \{(.*?)\n {16}\};/s);
    assert.ok(handler, 'обработчик display-settings-update в часах не найден');

    assert.match(handler[1], /if \(settings\.clockStyle\) \{\s*this\.setClockStyle\(settings\.clockStyle\);/s);

    // Сравниваем только КОД: комментарий рядом намеренно цитирует удалённую
    // ветку, чтобы правка не вернулась «по незнанию», и без вырезания
    // комментариев тест ловил бы сам себя.
    const code = handler[1].replace(/^[ \t]*\/\/.*$/gm, '');
    assert.doesNotMatch(
        code,
        /settings\.timerStyle/,
        'timerStyle в этом сообщении — стиль ПОЛНОЭКРАННОГО режима; часам он не принадлежит'
    );
});
