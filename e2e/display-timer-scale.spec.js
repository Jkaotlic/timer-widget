const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay } = require('./window-ready');

/**
 * Характеризация: масштаб полноэкранного таймера применяется ко всем блокам
 * стилей из всех трёх точек входа.
 *
 * Написан ДО сворачивания четырёх строк (метод, названный по кольцу, плюс три
 * присваивания style.transform) в applyTimerScale() и обязан пройти ПОСЛЕ него
 * без единого изменения — ровно так проверялось извлечение window-geometry.js.
 *
 * Почему это вообще стоит теста: блок был написан ТРИЖДЫ, и пятый стиль
 * означал бы пятую строку в трёх местах. Пропуск в одной из копий даёт
 * «масштаб работает, пока не тронешь колесо» — молча.
 *
 * Точка входа 3 (восстановление из localStorage) намеренно живёт в СВОЕЙ,
 * отдельной сессии приложения (см. второй test() ниже), а не продолжает
 * сессию точек 1-2. Причина — не стиль, а необходимость: applyDisplaySettings()
 * безусловно перевызывает applyTimerScale() в конце КАЖДОГО пуша настроек, в
 * том числе хидрейта при пересоздании окна. Если в этой же сессии уже был
 * реальный пуш (точки 1-2), main-процесс держит непустой lastDisplaySettings,
 * и повторное открытие окна почти сразу получает хидрейт, который сам
 * перевызывает applyTimerScale() и тем самым МАСКИРУЕТ поломку именно в
 * restoreBlockPositions() — конечное состояние совпадает с ожидаемым, даже
 * если восстановление при загрузке сломано. lastDisplaySettings — переменная
 * В ПАМЯТИ main-процесса, не персистится на диск, и в СВЕЖЕМ процессе она
 * равна null, пока что-то её не выставит; открывая дисплей сразу после
 * запуска (до автопуша панели через ~200мс) и проверяя состояние без единой
 * паузы, мы гарантированно ловим кадр, в котором применить масштаб мог
 * ТОЛЬКО restoreBlockPositions(). Это и обнажил mutation-тест ревьюера:
 * вырезанный вызов внутри restoreBlockPositions() не был виден тестом,
 * читавшим лишь факт записи в localStorage.
 */

// Блок LED (#timerDigital) ушёл вместе со стилем: он слит с «Цифрами».
const BLOCK_IDS = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits'];
// Значения ниже ПОТОЛКА по свободному месту (17.08.2026): масштаб, который не
// помещается между подписью и плашкой статуса, теперь обрезается — см.
// отдельный тест ниже и RendererShared.fitBlockScale. Здесь проверяется не
// потолок, а доставка значения во все четыре блока, поэтому величины взяты
// заведомо влезающие. Прежние 150/200 сюда больше не годятся: на кольце они
// обрезаются до ~142 %, и тест мерил бы потолок, а не доставку.
const PUSH_SCALE_PCT = 120;
const RESTORE_SCALE_PCT = 130;
const DEFAULT_SCALE_PCT = 100;

function readScales(ids) {
    const out = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? el.style.transform : null;
    }
    return out;
}

async function findDisplay(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(() => !!document.getElementById('timerRing')).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Общий сброс для обеих сессий: localStorage в этом приложении ОБЩИЙ для
// всех окон (все они file:// — один источник хранилища), а профиль e2e
// ОДИН на весь прогон (см. e2e/launch.js). Возвращаем оба представления
// масштаба к дефолту — выделенный ключ displayTimerScale (который читает
// restoreBlockPositions() на каждом окне) и поле displayTimerScale ВНУТРИ
// блока displayExtSettings (который читает bootstrap-вызов
// loadBackgroundSettings() при ЛЮБОМ будущем открытии ЛЮБОГО окна). Не
// вернуть оба — значит оставить соседнему спеку чужой масштаб уже на первом
// кадре, молча.
async function resetDisplayScale(page, pct) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate((value) => {
        localStorage.setItem('displayTimerScale', String(value));
        try {
            const prev = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            prev.displayTimerScale = value;
            localStorage.setItem('displayExtSettings', JSON.stringify(prev));
        } catch { /* профиль грязный, но не по вине этого блока — не маскируем ошибку теста */ }
    }, pct).catch(() => {});
}

test('масштаб дисплея применяется ко всем блокам стилей (пуш настроек и Ctrl+колесо)', async () => {
    const { app, control } = await launchApp();
    let display = null;
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await waitForDisplay(app);
        await control.waitForTimeout(1500);

        display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        // Точка входа 1: приход настроек от панели.
        await display.evaluate(() => window.ipcRenderer.send('get-timer-state'));
        await control.evaluate((pct) => {
            window.ipcRenderer.send('display-settings-update', { displayTimerScale: pct });
        }, PUSH_SCALE_PCT);
        await display.waitForTimeout(500);

        const afterPush = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(afterPush[id], `${id} должен быть отмасштабирован приходом настроек`)
                .toContain(`scale(${PUSH_SCALE_PCT / 100})`);
        }

        // Точка входа 2: Ctrl+колесо.
        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);

        const afterWheel = await display.evaluate(readScales, BLOCK_IDS);
        const wheelValues = new Set(Object.values(afterWheel));
        expect(wheelValues.size, 'все четыре блока должны получить ОДИН и тот же масштаб').toBe(1);
        expect(afterWheel.timerRing).not.toBe(afterPush.timerRing);

        const stored = await display.evaluate(() => localStorage.getItem('displayTimerScale'));
        expect(Number(stored), 'колесо обязано сохранить масштаб').toBeGreaterThan(0);
    } finally {
        await resetDisplayScale(display, DEFAULT_SCALE_PCT);
        await app.close();
    }
});

test('масштаб дисплея применяется ко всем блокам стилей (восстановление при загрузке окна)', async () => {
    // Своя, изолированная сессия — см. комментарий в шапке файла про то,
    // почему точка входа 3 не может продолжать сессию первого теста.
    const { app, control } = await launchApp({ settleMs: 0 });
    let display = null;
    try {
        // Кладём целевой масштаб в общее хранилище ДО открытия окна и без
        // единой лишней паузы: у нас есть запас до автопуша панели (setTimeout
        // в её конструкторе), а мы тут же открываем дисплей и читаем его
        // состояние сразу на domcontentloaded.
        //
        // displayExtSettings ОБЯЗАН быть пустым здесь: loadBackgroundSettings()
        // читает этот блок в конструкторе СИНХРОННО, ДО restoreBlockPositions(),
        // и — если блок непустой — сам вызывает applyDisplaySettings(), у
        // которой ЕСТЬ своя, отдельная логика «первый пуш всегда берёт
        // масштаб из localStorage» и собственный вызов applyTimerScale() в
        // конце. На обычном, уже пожившем профиле (а он тут именно такой —
        // общий на весь e2e-прогон) это разряжает восстановление ДО
        // restoreBlockPositions(), и её собственный вызов applyTimerScale()
        // становится ненаблюдаемым снаружи: тест видит верный масштаб, даже
        // если конкретно этот вызов вырезан, — то, на чём и споткнулась
        // предыдущая версия этой проверки при mutation-тесте ревьюера.
        await control.evaluate((pct) => {
            localStorage.removeItem('displayExtSettings');
            localStorage.setItem('displayTimerScale', String(pct));
        }, RESTORE_SCALE_PCT);

        const displayPromise = app.waitForEvent('window');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        display = await displayPromise;
        await display.waitForLoadState('domcontentloaded');

        // Проверяем СРАЗУ. restoreBlockPositions() — часть синхронного
        // конструктора, отрабатывающего на domcontentloaded. lastDisplaySettings
        // на main-процессе — переменная в памяти, null в свежем процессе, пока
        // что-то её не выставит; здесь этого не произошло (реальных пушей от
        // панели ещё не было), поэтому createDisplayWindow() не шлёт хидрейт
        // вовсе (`if (lastDisplaySettings)` в электрон-main.js). Значит на этом
        // кадре масштаб мог применить ТОЛЬКО restoreBlockPositions() — ровно
        // то звено, которое сворачивалось в Task 3.
        const immediatelyAfterLoad = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(
                immediatelyAfterLoad[id],
                `${id} должен быть отмасштабирован restoreBlockPositions() сразу на domcontentloaded`
            ).toContain(`scale(${RESTORE_SCALE_PCT / 100})`);
        }

        // И финальное, устоявшееся состояние — тем же значением, для общей
        // характеризации (панель могла позже прислать свой автопуш, но он
        // несёт то же значение, что уже восстановлено, так что расхождения
        // здесь не будет).
        await display.waitForTimeout(500);
        const settled = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(settled[id], `${id} должен остаться отмасштабированным после полной загрузки`)
                .toContain(`scale(${RESTORE_SCALE_PCT / 100})`);
        }
    } finally {
        await resetDisplayScale(display, DEFAULT_SCALE_PCT);
        await app.close();
    }
});

/**
 * Потолок масштаба: увеличенный таймер остаётся ВНУТРИ окна и не наезжает на
 * подпись «Осталось» и плашку статуса.
 *
 * Жалоба 17.08.2026: «при увеличении масштаба круг наезжает на осталось и
 * готов к запуску и может уехать за пределы окна». Так и было: рост задаётся
 * `transform: scale`, а трансформация в раскладке не участвует — соседи о новом
 * размере не знают. Замер до правки на окне 3440×1320: 150 % — перекрытие
 * подписи на 148px и плашки на 22px, 200 % — вылет за окно на 66px, 300 % — на
 * 429px.
 *
 * Меряются ПРЯМОУГОЛЬНИКИ, а не значение transform: величина масштаба сама по
 * себе ничего не обещает, а обещание тут геометрическое.
 */
test('масштаб дисплея не выпускает таймер за окно и не кладёт его на подпись', async () => {
    const { app, control } = await launchApp();
    let display = null;
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await waitForDisplay(app);
        await control.waitForTimeout(1500);
        display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        const measure = () => {
            const active = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits']
                .map((id) => document.getElementById(id))
                .find((el) => el && el.classList.contains('active'));
            // Меряется ВИДИМОЕ, а не рама вокруг него. У «Круга», «Аналога» и
            // «Флипа» блок и есть содержимое. У «Цифр» блок — квадрат
            // `--timer-box` (55vh), к строке времени отношения не имеющий:
            // замер 31.08.2026 на 3380×1313 — чернил 883×487 в раме 1120×722.
            // Пока субъектом была рама, потолок упирался в воздух вокруг цифр
            // (169 % вместо 249 %), окно писало «Таймер уже во всю высоту» и
            // показывало цифры в треть экрана — жалоба «не могу менять ширину
            // таймера». Обещание тут про то, что ВИДНО: пустая рама ни на
            // подпись, ни на плашку не наезжает, потому что она прозрачна, а в
            // hit-тесте плашка её обыгрывает (см. e2e/display-timer-width).
            const visible = active.id === 'timerDigits'
                ? document.getElementById('digitsTime')
                : active;
            const box = visible.getBoundingClientRect();
            const label = document.getElementById('heroLabel').getBoundingClientRect();
            const pill = document.querySelector('.status-pill').getBoundingClientRect();
            return {
                style: active.id,
                transform: getComputedStyle(active).transform,
                gapTop: Math.round(box.top - label.bottom),
                gapBottom: Math.round(pill.top - box.bottom),
                outTop: Math.round(-box.top),
                outBottom: Math.round(box.bottom - window.innerHeight)
            };
        };

        for (const style of ['circle', 'analog', 'digits', 'flip']) {
            await control.evaluate(([s, pct]) => {
                window.ipcRenderer.send('display-settings-update', { timerStyle: s, displayTimerScale: pct });
            }, [style, 300]);
            await display.waitForTimeout(700);

            const m = await display.evaluate(measure);
            console.log(`${style} при запрошенных 300% →`, JSON.stringify(m));

            expect(m.gapTop, `${style}: таймер лёг на подпись «Осталось»`).toBeGreaterThanOrEqual(0);
            expect(m.gapBottom, `${style}: таймер лёг на плашку статуса`).toBeGreaterThanOrEqual(0);
            expect(m.outTop, `${style}: таймер вышел за верхний край окна`).toBeLessThanOrEqual(0);
            expect(m.outBottom, `${style}: таймер вышел за нижний край окна`).toBeLessThanOrEqual(0);
            // Проверка проверки: масштаб ВООБЩЕ применился. Без этого зелёный
            // цвет значил бы и «обрезали правильно», и «масштаб не работает».
            expect(m.transform, `${style}: масштаб не применился вовсе`).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
        }

        // И ползунок панели узнаёт РЕАЛЬНОЕ значение, а не запрошенное:
        // два источника правды здесь уже расходились.
        //
        // Сверяется КРУГ, и отдельным пушем: потолок у каждого стиля свой (у
        // флипа блок низкий, ему 300 % помещаются целиком), поэтому сравнивать
        // ползунок с хранилищем имеет смысл только после посылки, относящейся к
        // одному стилю. Цикл выше гонял стили подряд напрямую по IPC, минуя
        // ползунок, — там расхождение означает лишь «панель показывает ответ
        // про предыдущий стиль».
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'circle', displayTimerScale: 300 });
        });
        await display.waitForTimeout(800);

        const shown = await control.evaluate(() => Number(document.getElementById('displayTimerScale').value));
        const applied = await display.evaluate(() => Number(localStorage.getItem('displayTimerScale')));
        console.log(`ползунок ${shown} %, применено ${applied} %`);
        expect(shown, 'ползунок обязан показывать применённый масштаб').toBe(applied);
    } finally {
        await resetDisplayScale(display, DEFAULT_SCALE_PCT);
        await app.close();
    }
});
