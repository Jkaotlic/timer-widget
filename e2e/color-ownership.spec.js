const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * ХАРАКТЕРИЗАЦИЯ цвета: 5 стилей × 4 полосы × 2 окна.
 *
 * Написан ДО перевода цвета с инлайна на каскад
 * (docs/superpowers/plans/2026-08-11-color-ownership.md) и обязан пройти
 * неизменённым ПОСЛЕ. Ровно тот же приём, что в window-drag-geometry.spec.js и
 * display-timer-scale.spec.js: сначала запереть поведение, потом менять
 * механизм.
 *
 * Смотрим на getComputedStyle, а НЕ на инлайновый атрибут. Инлайн — это и есть
 * тот механизм, который правка убирает; тест по нему сломался бы от корректного
 * рефакторинга и заставил бы «чинить» рабочий код. Проверять надо то, что
 * реально отрисовано.
 *
 * Полосы задаются процентами из CONFIG, а не литералами 10/25: пороги там
 * однажды уже разъезжались с окнами (см. renderer-shared.timerColorBand), и
 * тест, повторяющий литерал, разъедется вместе с ними молча.
 *
 * Тест НИЧЕГО не утверждает про конкретные значения цветов — он утверждает, что
 * они не изменились. Поэтому эталон живёт прямо здесь, снятый с кода до правки.
 */

let app;
let control;
let widget;
let display;

// Пороги: warning ≤25% и >10%, danger ≤10%. Берём с запасом от границ, чтобы
// тест не зависел от того, строгое сравнение или нестрогое.
const BANDS = [
    { name: 'normal', total: 600, remaining: 600 },
    { name: 'warning', total: 100, remaining: 20 },
    { name: 'danger', total: 100, remaining: 5 },
    { name: 'overtime', total: 100, remaining: -10, allowNegative: true }
];

const STYLES = ['circle', 'flip', 'analog', 'digits'];

// Главный носитель времени в каждом стиле.
//
// Флип адресуется карточкой МИНУТ, а не первой попавшейся `.flip-digit`:
// первыми в DOM идут карточки ЧАСОВ (#wFlipHr1 / #flipHr1), они скрыты, пока
// таймер меньше часа, и полосу на себе не несут. Первая версия теста ловила
// именно их и отчиталась «danger не отличается от normal» — про элемент,
// которого пользователь в этот момент не видит.
const TARGET = {
    widget: {
        circle: '#timeDisplay',
        flip: '#wFlipMin1 .widget-flip-digit',
        analog: '#widgetAnalogDigital',
        digits: '#widgetDigitsTime'
    },
    display: {
        circle: '#timeDisplay',
        flip: '#flipMin1 .flip-digit',
        analog: '#analogDigitalTime',
        digits: '#digitsTime'
    }
};

/**
 * ЭТАЛОН, снятый с кода ДО перевода цвета на каскад (коммит c28e1d6).
 *
 * Смысл не в конкретных значениях — смысл в том, что после правки они обязаны
 * остаться теми же. Это единственное, что отличает «рефакторинг механизма» от
 * «заодно поменяли, как выглядит».
 *
 * visual:check эту роль выполнить не может: он недетерминирован (замер
 * 10.08.2026 — 8 → 0 → 5 → 0 регрессий на неизменённом main) и вдобавок имеет
 * порог в 8/255 на канал, то есть мелкую подмену цвета он просто не заметит.
 */
// Эталон пересобран 18.08.2026: ТЕНЬ стала одна на все пять стилей в обоих
// окнах. До этого их было три — 0.45/12px в виджете, 0.4/8px в дисплее,
// 0.6/8px у флипа, — и различия не были ничьим решением: это три копии одного
// намерения «мягкая тень под цифрами», написанные в разное время. Теперь она
// приезжает токеном --style-ink-shadow, потому что на СВЕТЛОМ тоне тень
// обязана стать светлым ореолом, а три литерала перевернуть нечем.
// ЦВЕТА не двинулись ни в одной из 40 ячеек — это и проверяется.
//
// Эталон пересобран ВТОРОЙ раз 18.08.2026 — и снова осознанно. Изменился один
// цвет из сорока ячеек: красный полосы, #ff4444 → #ff453a. Это сведение трёх
// параллельных красных к одному акценту палитры (полоса, `--tw-red`,
// `--tw-led-danger`), ради которого полоса стала ССЫЛКОЙ и заодно научилась
// следовать тону окна. Сама таблица это и показывает: строка
// `widget.analog.danger` уже стояла на `rgba(255, 69, 58, 0.7)` — то есть в
// одном кадре жили два разных красных, и характеризация это честно фиксировала.
// Жёлтый не двинулся ни в одной ячейке: он был ссылкой с самого начала.
//
// Эталон пересобран 12.08.2026 вместе с редизайном. Изменились ТОЛЬКО тени:
// цветные ореолы сняты во всех окнах, осталась одна нейтральная тень на все
// пять стилей. ЦВЕТА не двинулись ни в одной из 40 ячеек — и это ровно то,
// что здесь и проверяется: снятие ореола обязано быть снятием ореола, а не
// «заодно поменяли палитру». Два расхождения по цвету, всплывшие по дороге,
// были настоящими дефектами страж-яркости и починены, а не вписаны в эталон.
const BASELINE = {
    'widget.circle.normal': { color: 'rgb(255, 255, 255)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.circle.normal': { color: 'rgb(255, 255, 255)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.circle.warning': { color: 'rgb(255, 193, 7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.circle.warning': { color: 'rgb(255, 193, 7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.circle.danger': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.circle.danger': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.circle.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.circle.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.flip.normal': { color: 'rgb(255, 255, 255)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.flip.normal': { color: 'rgb(255, 255, 255)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.flip.warning': { color: 'rgb(255, 193, 7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.flip.warning': { color: 'rgb(255, 193, 7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.flip.danger': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.flip.danger': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.flip.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.flip.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.analog.normal': { color: 'rgba(255, 255, 255, 0.58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.analog.normal': { color: 'rgba(255, 255, 255, 0.78)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.analog.warning': { color: 'rgba(255, 255, 255, 0.58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.analog.warning': { color: 'rgb(255, 193, 7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.analog.danger': { color: 'rgba(255, 69, 58, 0.7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.analog.danger': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.analog.overtime': { color: 'rgba(255, 69, 58, 0.7)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'display.analog.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'rgba(0, 0, 0, 0.5) 0px 2px 8px' },
    'widget.digits.normal': { color: 'rgb(255, 255, 255)', textShadow: 'none' },
    'display.digits.normal': { color: 'rgb(255, 255, 255)', textShadow: 'none' },
    'widget.digits.warning': { color: 'rgb(255, 193, 7)', textShadow: 'none' },
    'display.digits.warning': { color: 'rgb(255, 193, 7)', textShadow: 'none' },
    'widget.digits.danger': { color: 'rgb(255, 69, 58)', textShadow: 'none' },
    'display.digits.danger': { color: 'rgb(255, 69, 58)', textShadow: 'none' },
    'widget.digits.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'none' },
    'display.digits.overtime': { color: 'rgb(255, 69, 58)', textShadow: 'none' }
};

async function sendCommand(cmd) {
    await control.evaluate((c) => { window.ipcRenderer.send('timer-command', c); }, cmd);
    await control.waitForTimeout(350);
}

// Полоса считается от ОСТАТКА к ОБЩЕМУ, поэтому нужно и то и другое: `set`
// ставит оба разом, `adjust` двигает только остаток.
async function setBand(band) {
    await sendCommand({ type: 'set', seconds: band.total, allowNegative: !!band.allowNegative });
    await sendCommand({ type: 'adjust', deltaSeconds: band.remaining - band.total, allowNegative: !!band.allowNegative });
}

async function setWidgetStyle(style) {
    await control.evaluate((s) => {
        window.ipcRenderer.send('widget-style-update', { timerStyle: s, timerScale: 100 });
    }, style);
    await control.waitForTimeout(300);
}

async function setDisplayStyle(style) {
    await control.evaluate((s) => {
        window.ipcRenderer.send('display-settings-update', { displayTimerStyle: s, timerStyle: s });
    }, style);
    await control.waitForTimeout(300);
}

// Возвращает вычисленные цвет и тень. null — элемента в разметке нет (стиль
// его не рисует); это тоже факт, который надо запереть.
function readPaint(selector) {
    const el = document.querySelector(selector);
    if (!el) { return null; }
    const cs = getComputedStyle(el);
    return { color: cs.color, textShadow: cs.textShadow };
}

/**
 * Приводит запись цвета к одному виду перед сравнением.
 *
 * Зачем: один и тот же цвет браузер сериализует по-разному в зависимости от
 * того, откуда он взялся. Инлайновый литерал `#ffcc0066` печатается как
 * `rgba(255, 204, 0, 0.4)`, а ровно тот же цвет, посчитанный правилом CSS через
 * `color-mix(in srgb, currentColor 40%, transparent)` — как
 * `color(srgb 1 0.8 0 / 0.4)`. Пиксель идентичен, строка разная.
 *
 * Без нормализации перевод стиля с инлайна на CSS выглядел бы как регрессия
 * окраски, хотя не меняет ни одного пикселя, — и тест заставил бы «чинить»
 * правильный код. Сравнивать надо цвет, а не то, как его напечатали.
 */
function canonicalColor(value) {
    if (typeof value !== 'string') { return value; }
    return value.replace(
        /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g,
        (_m, r, g, b, a) => {
            const to255 = (x) => Math.round(parseFloat(x) * 255);
            const alpha = a === undefined ? 1 : parseFloat(a);
            return alpha === 1
                ? `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`
                : `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${alpha})`;
        }
    );
}

test.beforeAll(async () => {
    ({ app, control } = await launchApp());
    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-display');
    });
    await control.waitForTimeout(2500);
    for (const page of app.windows()) {
        const url = await page.url();
        if (url.includes('electron-widget')) { widget = page; }
        if (url.includes('display.html')) { display = page; }
    }
    expect(widget, 'виджет должен открыться').toBeTruthy();
    // Эталон снят в ТЁМНОМ тоне, и меряться обязан он же. С 18.08.2026 у окон
    // два тона (surface-tones.css), а умолчание приложения — светлая тема:
    // без этой строки спека сверяла бы светлую палитру с тёмным эталоном и
    // рапортовала «окраска изменилась» о правке, которая её и вводила.
    // Светлый тон меряет e2e/style-tone.spec.js — отдельно и по своим числам.
    // Тема шлётся по IPC, а не кликом: клик пишет её в общий профиль прогона.
    await control.evaluate(() => window.ipcRenderer.send('ui-theme-update', { theme: 'dark' }));
    await control.waitForTimeout(600);
    expect(display, 'полноэкранное окно должно открыться').toBeTruthy();
});

test.afterAll(async () => {
    // Профиль e2e ОДИН на весь прогон, поэтому спека обязана вернуть всё, что
    // трогала. Эта перебирает пять стилей в двух окнах и оставляла последний
    // («Цифры») — следующие спеки открывали окна не в том стиле, который
    // ожидали, и падали по таймауту, проходя при этом в одиночку.
    // Ровно тот же класс поломки, что описан в CLAUDE.md про #contrastToggle.
    await setWidgetStyle('circle').catch(() => {});
    await setDisplayStyle('circle').catch(() => {});
    await sendCommand({ type: 'set', seconds: 300, allowNegative: false }).catch(() => {});
    // Тема — тоже глобальное состояние прогона, и умолчание приложения светлое.
    await control.evaluate(() => window.ipcRenderer.send('ui-theme-update', { theme: 'light' })).catch(() => {});
    await app.close();
});

test('снимок окраски: 5 стилей × 4 полосы в виджете и дисплее', async () => {
    const snapshot = {};

    for (const style of STYLES) {
        await setWidgetStyle(style);
        await setDisplayStyle(style);

        for (const band of BANDS) {
            await setBand(band);

            const w = await widget.evaluate(readPaint, TARGET.widget[style]);
            const d = await display.evaluate(readPaint, TARGET.display[style]);
            snapshot[`widget.${style}.${band.name}`] = w;
            snapshot[`display.${style}.${band.name}`] = d;
        }
    }

    // Печатаем целиком: при падении сразу видно, ЧТО именно уехало, без
    // повторного прогона с отладкой.
    console.log(JSON.stringify(snapshot, null, 2));

    // Инварианты, которые обязаны держаться независимо от конкретных значений.
    // Они и есть содержание теста: «покрасилось хоть как-то» ловит мёртвый
    // элемент, «danger ≠ normal» ловит полосу, которая перестала применяться.
    const problems = [];
    for (const style of STYLES) {
        for (const win of ['widget', 'display']) {
            const normal = snapshot[`${win}.${style}.normal`];
            const danger = snapshot[`${win}.${style}.danger`];
            const overtime = snapshot[`${win}.${style}.overtime`];
            if (!normal) {
                problems.push(`${win}.${style}: элемент времени не найден в разметке`);
                continue;
            }
            if (normal.color === 'rgba(0, 0, 0, 0)') {
                problems.push(`${win}.${style}.normal: цвет прозрачный — элемент не покрашен`);
            }
            if (danger && danger.color === normal.color) {
                problems.push(`${win}.${style}: danger не отличается от normal (${danger.color})`);
            }
            if (overtime && overtime.color === normal.color) {
                problems.push(`${win}.${style}: overtime не отличается от normal (${overtime.color})`);
            }
        }
    }
    expect(problems, problems.join('\n')).toEqual([]);

    // Главная проверка: НИ ОДНО значение не изменилось.
    //
    // Сравниваем по ячейкам, а не объект целиком: при падении нужен список
    // «что именно уехало», а не дифф на 40 записей, в котором сломанную одну
    // придётся искать глазами.
    const drift = [];
    for (const key of Object.keys(BASELINE)) {
        const was = BASELINE[key];
        const now = snapshot[key];
        if (!was && !now) { continue; }
        if (!was || !now) {
            drift.push(`${key}: было ${JSON.stringify(was)}, стало ${JSON.stringify(now)}`);
            continue;
        }
        if (canonicalColor(was.color) !== canonicalColor(now.color)) {
            drift.push(`${key} color: было ${was.color}, стало ${now.color}`);
        }
        if (canonicalColor(was.textShadow) !== canonicalColor(now.textShadow)) {
            drift.push(`${key} textShadow:\n    было  ${was.textShadow}\n    стало ${now.textShadow}`);
        }
    }
    expect(drift, `окраска изменилась:\n${drift.join('\n')}`).toEqual([]);

    // Эталон и снимок должны покрывать одно и то же множество ячеек — иначе
    // новый стиль или новая полоса добавится, не попав ни под одну проверку,
    // и тест останется зелёным про то, чего он не смотрит.
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(BASELINE).sort());
});
