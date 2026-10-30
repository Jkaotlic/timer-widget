const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForClock, waitForClockSnapshot, waitForWindowSettled, resizeOwnWindow, armReceived, untilReceived
} = require('./window-ready');

const CLOCK_URL = 'electron-clock-widget.html';

/**
 * Шильдики даты и часового пояса в КРУГОВОМ стиле часов не должны налезать
 * друг на друга ни при каком размере окна.
 *
 * В круговом стиле оба шильдика позиционированы АБСОЛЮТНО от центра
 * `.center-content`, каждый на своём смещении: дата на `calc(50% + clamp(22px,
 * 10vh, 90px))`, пояс на `calc(50% + clamp(44px, 15vh, 150px))`. Расстояние
 * между ними растёт как 5vh, а высота даты — как ~8.4vh (font-size 4.5vh на
 * line-height ~1.2, плюс padding 1.5vh сверху и снизу, плюс рамка). Высота
 * обгоняет зазор, поэтому дата заезжает на пояс, и тем сильнее, чем крупнее
 * окно. Остальные три стиля держат шильдики в нормальном потоке и этого дефекта
 * не имеют — поэтому меряем именно круг.
 *
 * Снимками это поймать было нельзя: `clock-*` исключены из визуальной сверки,
 * потому что показывают живое время (см. isTimeDependent в visual-diff).
 *
 * Меряем ПРЯМОУГОЛЬНИКИ обоих шильдиков на трёх размерах окна — по концам
 * («при 220 не налезает») дефект не виден, он раскрывается с ростом окна.
 */

const SIZES = [220, 400, 600];

// Замеряем то, что видит пользователь: реальные прямоугольники на экране.
function measureBadges() {
    const date = document.getElementById('dateBadge');
    const tz = document.getElementById('timezoneBadge');
    const d = date.getBoundingClientRect();
    const t = tz.getBoundingClientRect();
    return {
        windowH: window.innerHeight,
        dateVisible: getComputedStyle(date).display !== 'none',
        tzVisible: getComputedStyle(tz).display !== 'none',
        dateTop: Math.round(d.top), dateBottom: Math.round(d.bottom), dateH: Math.round(d.height),
        tzTop: Math.round(t.top), tzBottom: Math.round(t.bottom), tzH: Math.round(t.height),
        // Положительный зазор = пояс начинается ниже, чем кончается дата.
        gap: Math.round(t.top - d.bottom)
    };
}

test('дата и часовой пояс в круговых часах не перекрываются ни на одном размере', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => { window.ipcRenderer.send('open-clock-widget'); });
    // Окно найдено пробой (бросает, если не открылось), получило снимок main
    // и ВСТАЛО — геометрия восстановлена и записана. Раньше пауза 2000 мс.
    const clock = await waitForClock(app);
    await waitForClockSnapshot(app, clock);
    await waitForWindowSettled(app, clock, CLOCK_URL);

    // Круговой стиль + оба шильдика — ЧЕРЕЗ РЕАЛЬНЫЕ КОНТРОЛЫ панели. Ждём,
    // что обе посылки дошли до часов и отработаны (было 900 мс).
    const styleSent = await armReceived(clock, 'set-clock-style');
    const settingsSent = await armReceived(clock, 'clock-settings');
    await control.evaluate(() => {
        const style = document.getElementById('clockStyle');
        style.value = 'circle';
        style.dispatchEvent(new Event('change'));
        for (const id of ['clockShowDate', 'clockShowTimezone']) {
            const el = document.getElementById(id);
            el.checked = true;
            el.dispatchEvent(new Event('change'));
        }
    });
    await styleSent({ match: 'circle' });
    await settingsSent({ match: { showDate: true, showTimezone: true } });

    for (const size of SIZES) {
        // Размер просит само окно тем же каналом (`clock-widget-resize` открыт
        // и панели, и часам — обработчик в main один): main применил его и
        // сообщил границы, окно ВСТАЛО (было 700 мс).
        await resizeOwnWindow(app, clock, { channel: 'clock-widget-resize', urlPart: CLOCK_URL, size });

        const m = await clock.evaluate(measureBadges);
        console.log(`размер ${size}:`, JSON.stringify(m));

        expect(m.dateVisible, `${size}: дата должна быть видима`).toBe(true);
        expect(m.tzVisible, `${size}: пояс должен быть видим`).toBe(true);
        expect(m.gap, `${size}: пояс должен начинаться НИЖЕ конца даты, а зазор = ${m.gap}px`)
            .toBeGreaterThanOrEqual(0);
        expect(m.tzBottom, `${size}: пояс не должен вылезать за нижний край окна`)
            .toBeLessThanOrEqual(m.windowH);
    }

    // Убираем за собой: профиль изолирован, но ОДИН на весь прогон — следующие
    // спеки видят всё, что этот записал. Размер окна часов персистится в
    // clockGeometry, шильдики и стиль — в displayExtSettings.
    //
    // Стиль откатываем явно, как в e2e/clock-style-hardening.spec.js:85-87:
    // выше мы дёрнули change на #clockStyle, а этот обработчик ПО ПОСТРОЕНИЮ
    // гасит «синхронизировать со стилем виджета» и записывает выбранный стиль —
    // то есть тест меняет настройки, которых не выбирал, и окно часов остаётся
    // на нём же после закрытия панели.
    await control.evaluate(() => {
        for (const id of ['clockShowDate', 'clockShowTimezone']) {
            const el = document.getElementById(id);
            el.checked = false;
            el.dispatchEvent(new Event('change'));
        }
    });
    await untilReceived(clock, 'set-clock-style',
        () => control.evaluate(() => window.ipcRenderer.send('clock-widget-set-style', 'circle')), { match: 'circle' });
    // Геометрию окно пишет отложенно (`saveSettled`): resizeOwnWindow ждёт и
    // эту запись — закрыть раньше значило бы оставить профилю прежний размер.
    await resizeOwnWindow(app, clock, { channel: 'clock-widget-resize', urlPart: CLOCK_URL, size: 220 });
    await app.close();
});
