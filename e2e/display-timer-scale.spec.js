const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

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
const RESTORE_SCALE_PCT = 200;
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
        await control.waitForTimeout(1500);

        display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        // Точка входа 1: приход настроек от панели.
        await display.evaluate(() => window.ipcRenderer.send('get-timer-state'));
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { displayTimerScale: 150 });
        });
        await display.waitForTimeout(500);

        const afterPush = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(afterPush[id], `${id} должен быть отмасштабирован приходом настроек`).toContain('scale(1.5)');
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
