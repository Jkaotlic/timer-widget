'use strict';

/**
 * Режимы центрального времени ПО КЛИКУ.
 *
 * Unit-тесты знают арифметику и проводку; здесь проверяется то, чего они
 * увидеть не могут: доезжает ли режим до НАСТОЯЩЕГО окна дисплея и тем ли
 * числом.
 *
 * Числа берутся ИЗ ОКНА (его системные часы, его вычисленные стили), а не с
 * монитора проверяющего. Профиль e2e общий, поэтому каждый тест возвращает
 * режим в «Таймер», а время мероприятия — в 10:00 / 12:00 — и делает это в
 * `finally`, а не последней строкой: Playwright обрывает тест на первом
 * упавшем `expect`, и код после него не выполняется. Без `finally` одна
 * реальная регрессия оставляла бы грязный профиль всем СЛЕДУЮЩИМ тестам (в
 * этом файле и в следующих файлах прогона) и осиротевший процесс Electron
 * (`workers: 1` в playwright.config.js существует именно потому, что второй
 * экземпляр падает на едином замке блокировки) — то есть настоящий дефект
 * тонул бы под лавиной вторичных падений. См.
 * docs/lessons.md#the-e2e-profile-is-shared-so-a-test-that-flips-global-state
 * и уже готовый образец — e2e/digits-style.spec.js, `try { … } finally { … }`.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay } = require('./window-ready');

/**
 * Открыть ящик настроек на вкладке «Дисплей» — там и живут кнопки режима,
 * заголовки и время мероприятия. Без этого шага `.hero-mode-btn` остаётся
 * скрытым (ящик закрыт по умолчанию), и клик виснет до таймаута теста, а не
 * падает с понятной причиной.
 */
async function openDisplayTab(control) {
    await control.click('.tab-btn[data-tab="display"]');
    await control.waitForSelector('#settingsDrawer.open');
}

async function pickMode(control, mode) {
    await control.locator(`.hero-mode-btn[data-mode="${mode}"]`).click();
    await expect(control.locator(`.hero-mode-btn[data-mode="${mode}"]`)).toHaveClass(/active/);
}

async function setEvent(control, start, end) {
    await control.locator('#eventTimeInput').fill(start);
    await control.locator('#endTimeInput').fill(end);
    await control.locator('#endTimeInput').blur();
}

/** Крупное число окна дисплея — текстом, без пробелов. */
async function heroText(display) {
    return display.evaluate(() => {
        const el = document.getElementById('timeDisplay');
        return (el.textContent || '').replace(/\s+/g, '');
    });
}

/**
 * ОДИН замер того, что НАРИСОВАНО: вычисленные цвета и вычисленная геометрия,
 * а не имена классов. Класс мог остаться от прошлого состояния, а мог и быть
 * снят правилом каскада, которого автор теста не знает; краска на экране — то
 * единственное, что видит зал.
 *
 * Имя класса на <body> в снимке всё же есть, но исключительно как ПОДПИСЬ к
 * упавшему замеру (в сообщении об ошибке видно, в каком режиме мерили) и как
 * доказательство того, что режим за время теста НЕ менялся. Ни одно
 * утверждение на нём не строится.
 */
async function readPaint(display) {
    return display.evaluate(() => {
        const hero = document.getElementById('timeDisplay');
        const fill = document.getElementById('displayProgressFill');
        const track = document.getElementById('displayProgress');
        return {
            bodyClass: document.body.className,
            heroText: (hero.textContent || '').replace(/\s+/g, ''),
            heroColor: getComputedStyle(hero).color,
            fillDisplay: getComputedStyle(fill).display,
            fillWidth: fill.getBoundingClientRect().width,
            trackBg: getComputedStyle(track).backgroundColor
        };
    });
}

/**
 * Красное ли это по ЧИСЛАМ, а не по имени токена.
 *
 * Цвет полосы следует тону окна (на светлом фоне красный затемняется — см.
 * разбор «полоса следует тону»), поэтому литерал вроде #ff453a проверял бы
 * тему, а не полосу. Порог в 40 единиц отделяет любой из красных палитры от
 * нейтрального текста и от плёнки `--tw-overlay-medium`, у которой все три
 * канала равны.
 */
function isRed(rgb) {
    const nums = String(rgb).match(/\d+/g);
    if (!nums || nums.length < 3) { return false; }
    const [r, g, b] = nums.map(Number);
    return r > g + 40 && r > b + 40;
}

/** Только время НАЧАЛА: тесты полос двигают одну отметку, не обе. */
async function setStart(control, start) {
    await control.locator('#eventTimeInput').fill(start);
    await control.locator('#eventTimeInput').blur();
}

/** Секунды с начала суток — по часам САМОГО окна дисплея. */
async function nowSecondsIn(display) {
    return display.evaluate(() => {
        const d = new Date();
        return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    });
}

/** Секунды с начала суток → 'HH:MM' (вниз до минуты — точнее отметка не бывает). */
function clockOf(seconds) {
    const m = Math.floor(seconds / 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

async function sendCommand(control, cmd) {
    await control.evaluate((c) => { window.ipcRenderer.send('timer-command', c); }, cmd);
}

/**
 * Полоса `danger` у таймера ДОКЛАДА — 5 % остатка от пресета.
 *
 * `set` переписывает и total, и remaining разом, поэтому процент набирается
 * парой set+adjust (тот же приём, что enterDanger() в
 * e2e/color-band-reset.spec.js). Никаких системных часов: состояние
 * детерминировано в любой час прогона.
 */
async function enterTalkTimerDanger(control) {
    await sendCommand(control, { type: 'set', seconds: 100 });
    await sendCommand(control, { type: 'adjust', deltaSeconds: -95 });
}

// ---------------------------------------------------------------------------
// Сброс общего профиля — вызывается ТОЛЬКО из `finally`, поэтому каждый шаг
// специально «глотает» свою ошибку: если контрол уже закрыт или один из
// сбросов не удался, это не должно съесть ни оставшиеся сбросы, ни
// завершающий app.close(). Тот же приём, что resetDisplayStyle() в
// e2e/digits-style.spec.js.
// ---------------------------------------------------------------------------

async function resetHeroMode(control) {
    if (!control || control.isClosed()) { return; }
    await pickMode(control, 'timer').catch(() => {});
}

async function resetEventTimes(control) {
    if (!control || control.isClosed()) { return; }
    await setEvent(control, '10:00', '12:00').catch(() => {});
}

async function resetDisplayStyle(control) {
    if (!control || control.isClosed()) { return; }
    await control.click('#displayTimerStyle button[data-val="circle"]').catch(() => {});
}

// Все ТРИ поля, а не только то, которое трогает вызывающий тест: если завтра
// другой тест начнёт писать в #labelHeroCurrent или #labelHeroToStart, этот
// сброс останется честным без правки. Каждое поле — своя настройка
// (settings-schema.js, def: ''), пишется через panel-display.js в общий
// профиль, который global-setup.js стирает ОДИН РАЗ на весь прогон, а не
// перед каждым тестом — значит уцелевшая «Финиш» дожила бы до любого
// следующего теста/файла, который войдёт в режим «До конца» без своей
// подписи, и ждущего там assert'а на СТАНДАРТНОЕ слово.
//
// Через evaluate(), а НЕ через .locator().fill(): видно всегда только ОДНО
// из трёх полей (владелец режима — this.heroMode в панели, см.
// heroModeSection), два другие скрыты атрибутом `hidden`. Этот сброс обычно
// зовётся ПОСЛЕ resetHeroMode(), когда режим уже «Таймер» и скрыты ВСЕ ТРИ —
// .fill() у Playwright ждёт actionability (видимость) и висит до таймаута
// ДЕЙСТВИЯ на каждом скрытом поле по очереди, что и превращает try/finally
// в новый способ повесить тест на все отпущенные 30с. DOM-присваивание
// значения + событие 'input' (тот слушатель, что вешает panel-display.js)
// работает независимо от видимости.
async function resetHeroCaptions(control) {
    if (!control || control.isClosed()) { return; }
    await control.evaluate(() => {
        for (const id of ['labelHeroCurrent', 'labelHeroToStart', 'labelHeroToEnd']) {
            const el = document.getElementById(id);
            if (el && el.value !== '') {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }).catch(() => {});
}

test.describe('режимы центрального времени', () => {
    test('четыре режима дают на экране четыре разных числа', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            // Режим «Таймер» — как было до 08.09.2026.
            await pickMode(control, 'timer');
            await control.locator('.preset[data-minutes="5"]').click();
            await expect.poll(() => heroText(display)).toMatch(/^05:00$/);

            // Мероприятие с 00:01 до 23:59: начало заведомо прошло, конец заведомо
            // впереди — числа предсказуемы в любой час прогона.
            await setEvent(control, '00:01', '23:59');

            // «Текущее время» — сверяем с часами САМОГО ОКНА, а не проверяющего.
            await pickMode(control, 'current');
            await expect.poll(async () => {
                const shown = await heroText(display);
                const own = await display.evaluate(() => {
                    const d = new Date();
                    const p = (v) => String(v).padStart(2, '0');
                    return `${p(d.getHours())}:${p(d.getMinutes())}`;
                });
                return shown.startsWith(own);
            }).toBe(true);

            // «До начала» — начало прошло, значит минус.
            await pickMode(control, 'to-start');
            await expect.poll(() => heroText(display)).toMatch(/^[−-]/);

            // «До конца» — конец впереди, значит без минуса и не равно таймеру.
            await pickMode(control, 'to-end');
            await expect.poll(() => heroText(display)).not.toMatch(/^[−-]/);
            expect(await heroText(display)).not.toBe('05:00');
        } finally {
            // Пресет «5 минут» НЕ возвращается намеренно: нет канонического
            // «дефолта», к которому его возвращать (каждый следующий тест
            // запускает СВОЙ Electron-процесс и либо сам ставит нужную ему
            // длительность через timer-command, либо вообще не смотрит на
            // остаток таймера), и ни один тест этого файла или соседних не
            // читает стартовую длительность, не задав её явно первым делом.
            // Если это когда-нибудь перестанет быть верным — здесь нужен
            // resetTimerPreset(control), симметричный остальным reset*().
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('вне режима таймера плашка состояния скрыта при включённом тумблере', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const pillVisible = () => display.evaluate(() => {
                const el = document.getElementById('statusPill');
                return el ? getComputedStyle(el).display !== 'none' : false;
            });

            await pickMode(control, 'timer');
            expect(await pillVisible()).toBe(true);

            for (const mode of ['current', 'to-start', 'to-end']) {
                await pickMode(control, mode);
                await expect.poll(pillVisible, { message: `плашка видна в режиме ${mode}` }).toBe(false);
            }
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });

    test('«до конца» на прошедшем конце показывает минус и красный', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            await setEvent(control, '00:00', '00:01');
            await pickMode(control, 'to-end');

            await expect.poll(() => heroText(display)).toMatch(/^[−-]/);

            // Цвет ВЫЧИСЛЕННЫЙ, а не имя класса: класс мог остаться от прошлого
            // состояния, а краска — нет.
            const rgb = await display.evaluate(() => getComputedStyle(
                document.getElementById('timeDisplay')).color);
            const [r, g, b] = rgb.match(/\d+/g).map(Number);
            expect(r, `перерасход мероприятия не красный: ${rgb}`).toBeGreaterThan(g + 40);
            expect(r).toBeGreaterThan(b + 40);
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('своя подпись героя доезжает и стирается в стандартную', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const caption = () => display.locator('#heroLabelText').textContent();

            await pickMode(control, 'to-end');
            await expect.poll(caption).toBe('До конца мероприятия');

            await control.locator('#labelHeroToEnd').fill('Финиш');
            await expect.poll(caption).toBe('Финиш');

            await control.locator('#labelHeroToEnd').fill('');
            await expect.poll(caption).toBe('До конца мероприятия');

            // В режиме таймера подпись снова отчёт о состоянии.
            await pickMode(control, 'timer');
            await expect.poll(caption).toBe('Осталось');
        } finally {
            await resetHeroMode(control);
            await resetHeroCaptions(control);
            await app.close();
        }
    });

    test('режим переживает переоткрытие окна дисплея', async () => {
        const { app, control } = await launchApp();
        try {
            await openDisplay(app, control);
            await openDisplayTab(control);

            await pickMode(control, 'current');
            await control.evaluate(() => window.ipcRenderer.send('close-display'));
            const reopened = await openDisplay(app, control);

            await expect.poll(() => reopened.evaluate(
                () => document.body.className.includes('hero-mode-current'))).toBe(true);
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });

    test('аналоговая стрелка в режиме часов показывает ЧАС, а не долю от 12 часов', async () => {
        // Заложенный сюрприз: updateAnalogDisplay() раскладывает ДЛИТЕЛЬНОСТЬ
        // (час за 12 часов). Для настенных часов в 13:40 часовая стрелка
        // обязана встать по %12 — примерно на 50°, а не на 410°. Если замер
        // разойдётся, чинить арифметику стрелки, а не подгонять тест.
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            await control.click('#displayTimerStyle button[data-val="analog"]');
            // Стиль применяется в окне дисплея асинхронно (IPC), а сам блок
            // скрыт классом `.active` до прихода настроек — ждём УСЛОВИЯ, а не
            // сразу читаем transform: иначе замер попадает на кадр ДО первой
            // отрисовки стрелки и всегда возвращает `matrix(1,0,0,1,0,0)`.
            await display.waitForSelector('#timerAnalog.active');
            await pickMode(control, 'current');

            // «Отрисовалось» и «угол верный» — ДВА РАЗНЫХ вопроса, проверяемых
            // раздельно. До первого присваивания transform элемент даёт
            // computed matrix(1,0,0,1,0,0) — то же самое, что и НАСТОЯЩИЙ угол
            // 0°, который бывает у реальных часов дважды в сутки (00:00–00:12,
            // 12:00–12:12, при пороге 6°). Если бы «отрисовалось» проверялось
            // ТОЙ ЖЕ величиной (angle≈expected), settle-loop мог бы остановиться
            // на самой ПЕРВОЙ итерации ДО какой-либо реальной отрисовки — просто
            // потому что ожидаемый угол в этот момент тоже около нуля — и тест
            // прошёл бы зелёным, ничего не измерив. Поэтому «отрисовалось»
            // читается из INLINE `style.transform` (что реально написал JS), а
            // не из COMPUTED — computed совпадает с identity и у настоящего
            // rotate(0deg), а inline остаётся пустой строкой, пока
            // updateAnalogDisplay() ни разу не присвоил её.
            const readAngle = () => display.evaluate(() => {
                const hand = document.getElementById('analogHandHour');
                const inlineTransform = hand.style.transform;
                const rendered = inlineTransform !== '' && inlineTransform !== 'none';
                if (!rendered) { return { rendered: false, angle: null, expected: null }; }
                const m = getComputedStyle(hand).transform.match(/matrix\(([^)]+)\)/);
                if (!m) { return { rendered: false, angle: null, expected: null }; }
                const [a, b] = m[1].split(',').map(Number);
                const deg = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
                const d = new Date();
                return { rendered: true, angle: deg, expected: ((d.getHours() % 12) + d.getMinutes() / 60) * 30 };
            });

            // Ждём, пока рассылка timer-state долетит и стрелка встанет — та же
            // логика settle-loop, что в analog-hour-hand.spec.js. Условие
            // остановки требует ОБА признака разом: реальную отрисовку И
            // сходящийся угол.
            let last = { rendered: false, angle: null, expected: null };
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                last = await readAngle();
                if (last.rendered && Math.abs(last.angle - last.expected) < 6) { break; }
                await display.waitForTimeout(120);
            }

            // Раздельные утверждения с раздельными сообщениями: «не двигалась
            // вовсе» (updateAnalogDisplay() ничего не пишет) — это ДРУГОЙ дефект,
            // чем «двигалась, но не туда» (арифметика формулы).
            expect(last.rendered,
                'часовая стрелка ни разу не получила inline transform — updateAnalogDisplay() не пишет style.transform'
            ).toBe(true);
            expect(Math.abs(last.angle - last.expected),
                `часовая стрелка на ${last.angle.toFixed(1)}°, ожидалось ${last.expected.toFixed(1)}°`
            ).toBeLessThan(6);
        } finally {
            await resetHeroMode(control);
            await resetDisplayStyle(control);
            await app.close();
        }
    });

    test('«Цифры» с заведомо двузначным часом не вылезают за рамку', async () => {
        // updateDigitsScale() выбирает эталон подгонки по ЧИСЛУ ГЕРОЯ (задача
        // 4: `hasHours = Math.abs(Math.floor(this._heroSeconds())) >= 3600`),
        // но у самого эталона PROBE_HOURS = '8:88:88' — семь знаков,
        // ОДНОЗНАЧНАЯ цифра часа. formatTimeShort() для часа 10–23 не добавляет
        // padStart и даёт «HH:MM:SS» — восемь знаков, на разряд шире эталона;
        // для часа 0–9 даёт «H:MM:SS» — семь знаков, СОВПАДАЕТ с эталоном и
        // регресс не ловит вовсе.
        //
        // Никакого часа машины прогона не подставляем: время читается у
        // САМОГО ОКНА (`display.evaluate(() => new Date())`), а режим «До
        // конца» переводится на отметку «сейчас + 10ч11м (по часам окна)».
        // Арифметика ниже — БЕЗ переноса через полночь в исходном коде
        // (signedSecondsUntilClock — прямое вычитание секунд-с-полуночи), а
        // `endClock` собран по модулю суток, поэтому есть ровно два случая:
        //   – без переноса через полночь: |Δ| ≈ 36660с → час 10 (двузначный);
        //   – с переносом (после mod 86400 отметка «сегодня» оказалась РАНЬШЕ
        //     текущего момента): |Δ| ≈ 49740с → час 13 (тоже двузначный).
        // Оба случая дают ≥8 знаков ЛЮБОЙ момент суток, когда бы тест ни
        // запускался — детерминировано без подмены Date.
        //
        // Почему НЕ через знак минуса (казалось бы более простой путь):
        // digits-стиль знак и цифры рисует РАЗНЫМИ узлами — `digitsSign`
        // (position: absolute, вне потока) и `digitsValue`
        // (`Math.abs(secs)` — уже БЕЗ знака). Мой замер сравнивает именно
        // `digitsValue` с рамкой `#timerDigits`, поэтому знак к его ширине не
        // имеет отношения вообще: «До начала»/«До конца» на прошедшей минус-
        // отметке дают ТОТ ЖЕ текст в digitsValue, что и «Текущее время» в тот
        // же час, — определённость даёт не минус, а выбор ВЕЛИЧИНЫ смещения.
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const nowSeconds = await display.evaluate(() => {
                const d = new Date();
                return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
            });
            const targetSeconds = (nowSeconds + 10 * 3600 + 11 * 60) % 86400;
            const hh = String(Math.floor(targetSeconds / 3600)).padStart(2, '0');
            const mm = String(Math.floor((targetSeconds % 3600) / 60)).padStart(2, '0');
            await control.locator('#endTimeInput').fill(`${hh}:${mm}`);
            await control.locator('#endTimeInput').blur();

            await control.click('#displayTimerStyle button[data-val="digits"]');
            await pickMode(control, 'to-end');
            await display.waitForSelector('#timerDigits.active');

            const overflow = await display.evaluate(() => new Promise((resolve) => {
                // Кегль пересчитывается только когда меняется формат (часы
                // появляются/пропадают), а не на каждый тик — ждём кадра после
                // смены режима, а не фиксированную паузу.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const box = document.getElementById('timerDigits').getBoundingClientRect();
                    const ink = document.getElementById('digitsValue').getBoundingClientRect();
                    resolve({
                        overflowPx: ink.right - box.right,
                        boxWidth: box.width,
                        inkWidth: ink.width,
                        text: document.getElementById('digitsValue').textContent
                    });
                }));
            }));

            // Утверждение о РЕЖИМЕ отдельно от утверждения о вписывании: если
            // конструкция когда-нибудь перестанет давать двузначный час
            // (например, кто-то «упростит» вычисление targetSeconds), тест
            // обязан упасть здесь понятным сообщением, а не молча измерить
            // короткую строку и пройти без всякого покрытия регресса.
            expect(overflow.text.length,
                `ожидался двузначный час (≥8 знаков вида HH:MM:SS), измерено «${overflow.text}»`
            ).toBeGreaterThanOrEqual(8);

            expect(overflow.overflowPx,
                `«${overflow.text}» (${overflow.inkWidth.toFixed(1)}px) шире рамки ` +
                `${overflow.boxWidth.toFixed(1)}px на ${overflow.overflowPx.toFixed(1)}px`
            ).toBeLessThanOrEqual(1);
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await resetDisplayStyle(control);
            await app.close();
        }
    });

    // -----------------------------------------------------------------------
    // ПОЛОСА СРОЧНОСТИ В РЕЖИМАХ БЕЗ ТОТАЛА
    //
    // Четыре теста ниже заведены 08.09.2026 после того, как полный проход
    // ревью пропустил замерзающую краску. Пропустил закономерно: все прежние
    // проверки этой ветки утверждают о ФОРМЕ ИСХОДНИКА («такой-то метод читает
    // такое-то поле»), а замерзший кэш — свойство ВЫПОЛНЕНИЯ. Источник при нём
    // выглядит безупречно: и `_heroSeconds()`, и `_colorBand()` на своих
    // местах, просто вызывающий их метод перестаёт зваться.
    //
    // Отсюда правило для всего блока: тест меняет ТОЛЬКО СЕКУНДЫ (режим стоит
    // на месте, класс режима на <body> сверяется до и после) и утверждает о
    // ВЫЧИСЛЕННОЙ краске. Проверка на отсутствие обязана показать, что её
    // проба вообще способна что-то увидеть.
    // -----------------------------------------------------------------------

    test('отметка проходит САМА — и круг краснеет от одних секунд', async () => {
        // Единственный тест набора, который ждёт РЕАЛЬНОГО времени: отметка
        // часов задаётся с точностью до минуты, значит пересечение границы
        // «до отметки» → «после отметки» стоит до 60 с. Дешевле его не
        // сделать, а подменять здесь Date значило бы проверить не тот
        // драйвер: число в этом режиме двигает самокорректирующийся тик
        // startCurrentTimeClock(), а не приход timer-state.
        test.setTimeout(180000);

        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const t0 = await nowSecondsIn(display);
            // Приложение не умеет мероприятие через полночь (спека, раздел
            // «Чего в задаче НЕТ»), поэтому в последние минуты суток отметки
            // В БУДУЩЕМ не существует вовсе. Пропуск громкий и с причиной —
            // это честнее, чем тихо померить не тот переход.
            test.skip(t0 > 86400 - 180,
                'до полуночи меньше трёх минут: отметки в будущем в сутках не осталось');

            // Ближайшая граница минуты; если до неё меньше 8 с, берём
            // следующую — иначе не успеть замерить состояние ДО перехода.
            const boundary = (Math.floor(t0 / 60) + 1) * 60;
            const mark = (boundary - t0 < 8) ? boundary + 60 : boundary;

            await setStart(control, clockOf(mark));
            await pickMode(control, 'to-start');

            // ДО отметки: число без минуса, краски нет.
            await expect.poll(async () => (await readPaint(display)).heroText,
                { message: 'герой не перешёл на отсчёт до отметки' }).not.toMatch(/^[−-]/);
            const before = await readPaint(display);
            expect(before.bodyClass).toContain('hero-mode-to-start');
            expect(isRed(before.heroColor),
                `до отметки герой уже красный: ${before.heroColor} при «${before.heroText}»`
            ).toBe(false);

            // Ждём, пока отметка пройдёт САМА. Режим не трогаем, настройки не
            // шлём — меняются только секунды.
            await expect.poll(async () => (await readPaint(display)).heroText, {
                message: 'отметка не прошла: герой так и не показал минус',
                timeout: (mark - t0) * 1000 + 20000,
                intervals: [500]
            }).toMatch(/^[−-]/);

            // ПОСЛЕ отметки: краска обязана появиться на том же тике, но
            // опрашиваем — repaint и замер идут в разных процессах.
            await expect.poll(async () => isRed((await readPaint(display)).heroColor), {
                message: 'отметка прошла, а круг остался цветом темы'
            }).toBe(true);

            const after = await readPaint(display);
            // Доказательство того, что менялись ИМЕННО секунды: режим тот же.
            expect(after.bodyClass).toContain('hero-mode-to-start');
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('уход отметки в будущее СНИМАЕТ красное — оба стиля говорят одно', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const t0 = await nowSecondsIn(display);
            test.skip(t0 > 86400 - 180,
                'до полуночи меньше трёх минут: отметки в будущем в сутках не осталось');

            // Прошедшая отметка — минута назад по часам ОКНА, не по расписанию
            // проверяющего. Клампа в ноль тут нет (signedSecondsUntilClock —
            // прямое вычитание), поэтому «минута назад» в 00:00:30 даёт 00:00
            // и честный минус.
            await setStart(control, clockOf(Math.max(0, t0 - 60)));
            await pickMode(control, 'to-start');

            await expect.poll(async () => isRed((await readPaint(display)).heroColor), {
                message: 'прошедшая отметка не покрасила героя — мерить обратный переход нечем'
            }).toBe(true);
            const red = await readPaint(display);
            // Тот же замер видит и полосу состояния на <body>: жёлоб полосы
            // прогресса в перерасходе тонируется красным (display.css).
            expect(isRed(red.trackBg),
                `жёлоб полосы не покраснел в перерасходе: ${red.trackBg}`).toBe(true);

            // Двигаем ТОЛЬКО отметку: режим прежний, кэш перерисовки НЕ
            // сбрасывается (сброс живёт лишь в ветке смены режима).
            await setStart(control, clockOf(Math.min(86340, t0 + 3600)));

            await expect.poll(async () => isRed((await readPaint(display)).heroColor), {
                message: 'отметка ушла в будущее, а герой остался красным (замёрзшая полоса)'
            }).toBe(false);

            const clean = await readPaint(display);
            expect(clean.heroText, 'число не стало положительным').not.toMatch(/^[−-]/);
            expect(isRed(clean.trackBg),
                `жёлоб остался красным при положительном числе: ${clean.trackBg}`).toBe(false);
            expect(clean.bodyClass).toContain('hero-mode-to-start');
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('без тотала нижней полосы нет вовсе', async () => {
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const t0 = await nowSecondsIn(display);

            // ПРОБА ПРОВЕРЯЕТ СЕБЯ. Утверждение ниже — об ОТСУТСТВИИ, а
            // зелёный такой проверки одинаково означает и «полосы нет», и
            // «проба слепа». Поэтому сначала состояние, где полоса ОБЯЗАНА
            // быть: таймер доклада с пресетом, 5 % остатка — полоса занимает
            // 95 % ширины экрана. Тем же самым замером.
            await pickMode(control, 'timer');
            await enterTalkTimerDanger(control);
            await expect.poll(async () => (await readPaint(display)).fillWidth, {
                message: 'проба не увидела полосу там, где она есть — мерить отсутствие нечем'
            }).toBeGreaterThan(100);
            const withTotal = await readPaint(display);
            expect(withTotal.fillDisplay).not.toBe('none');

            // Теперь величина БЕЗ тотала: отметка «до начала» уже прошла.
            // Полоса перерасхода тянула сюда `width: 100% !important` и
            // рисовала залу «мероприятие пройдено на 100 %» для величины, у
            // которой доли не существует.
            await setStart(control, clockOf(Math.max(0, t0 - 60)));
            await pickMode(control, 'to-start');

            await expect.poll(async () => (await readPaint(display)).fillDisplay, {
                message: 'полоса прогресса осталась на экране в режиме без тотала'
            }).toBe('none');
            const noTotal = await readPaint(display);
            expect(noTotal.fillWidth,
                `полоса без тотала занимает ${noTotal.fillWidth}px при классах «${noTotal.bodyClass}»`
            ).toBe(0);
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('красный таймер доклада не остаётся на экране после ухода в «Текущее время»', async () => {
        // Гарантия, добытая раньше и обязанная пережить правку полосы:
        // оператор переключает экран на часы посреди перерасхода доклада, и
        // след таймера обязан быть СТЁРТ, а не просто перестать обновляться.
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            await pickMode(control, 'timer');
            await enterTalkTimerDanger(control);

            await expect.poll(async () => isRed((await readPaint(display)).heroColor), {
                message: 'таймер доклада не покраснел — стирать нечего, тест бессмыслен'
            }).toBe(true);
            // Ширина ОПРАШИВАЕТСЯ, а не читается разом: у заливки есть
            // переход `transition: width` (display.css), и первый кадр после
            // прихода состояния честно показывает 0px — замер одним чтением
            // ловил бы начало анимации и объявлял отсутствующей полосу,
            // которая просто ещё едет.
            await expect.poll(async () => (await readPaint(display)).fillWidth, {
                message: 'полоса доклада не появилась — стирать нечего, тест бессмыслен'
            }).toBeGreaterThan(100);

            await pickMode(control, 'current');

            await expect.poll(async () => isRed((await readPaint(display)).heroColor), {
                message: 'часы показывают красным след ушедшего доклада'
            }).toBe(false);

            const clock = await readPaint(display);
            for (const band of ['overtime', 'warning', 'danger']) {
                expect(clock.bodyClass,
                    `на <body> остался класс полосы «${band}»: «${clock.bodyClass}»`
                ).not.toContain(band);
            }
            expect(clock.fillWidth,
                `полоса ушедшего доклада шириной ${clock.fillWidth}px осталась на экране`
            ).toBe(0);
            expect(clock.fillDisplay).toBe('none');
            expect(isRed(clock.trackBg),
                `жёлоб полосы остался красным: ${clock.trackBg}`).toBe(false);
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });
});
