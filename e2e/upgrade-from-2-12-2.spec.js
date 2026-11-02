'use strict';

/**
 * Обновление поверх выпущенной 2.12.2: настройки пользователя переживают новую
 * версию и окна поднимаются на них без ошибок.
 *
 * Жалобы не раз упирались в ПРОФИЛЬ, а не в код: тесты идут на чистом, а у
 * пользователя — настройки, записанные старой версией. Поэтому снимок
 * fixtures/profile-2.12.2.json не сочинён, а снят: код тега v2.12.2 поднят в
 * Electron, настройки выставлены по её же плану (settings-roundtrip), окна
 * открыты, цвета, замок и ячейка вида записаны. Снимок замороженный: выпущенная
 * версия не меняется, и править его под новый код — значит отменить проверку.
 *
 * Профиль свой на тест: общий e2e-профиль уже видел новую версию.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('./fixtures');
const { _electron: electron } = require('playwright');
const { track } = require('./failure-artifacts');
const { MAIN, cleanEnv, waitForControlWindow, waitForStartupPush } = require('./launch');
const { waitForWindow, reloadPanel, openDisplay, closeDisplay } = require('./window-ready');

const SNAPSHOT = require('./fixtures/profile-2.12.2.json');

// Что 2.12.2 записала в контролы: те же значения обязана показать новая панель.
const EXPECTED_CONTROLS = {
    eventTitleInput: 'Оперативное совещание',
    eventTimeInput: '09:15',
    endTimeInput: '18:45',
    overrunLimit: '05:30',
    bgSolidColor: '#123456',
    soundEndPreset: 'gong',
    overrunIntervalMinutes: '5'
};
const EXPECTED_CHECKS = {
    allowNegative: true,
    soundMasterEnabled: false,
    showCurrentTime: false,
    showEndTime: true,
    clockFormat24h: false,
    clockShowTicks: true
};
const EXPECTED_SEGMENTS = { timerStyle: 'flip', clockStyle: 'digits', displayTimerStyle: 'analog' };

async function start(dir) {
    const app = track(await electron.launch({ args: [MAIN, `--user-data-dir=${dir}`], env: cleanEnv() }));
    const control = await waitForControlWindow(app);
    await control.waitForLoadState('domcontentloaded');
    await waitForStartupPush(control);
    return { app, control };
}

// Первый запуск только кладёт снимок в origin app:// и выходит, как вышла бы
// старая версия: панель при этом не успевает ничего записать поверх.
async function seedProfile(dir) {
    const { app, control } = await start(dir);
    await control.evaluate((snapshot) => {
        localStorage.clear();
        for (const [key, value] of Object.entries(snapshot)) { localStorage.setItem(key, value); }
    }, SNAPSHOT);
    await app.close();
}

function collectErrors(app, errors) {
    const watch = (page) => {
        const name = () => page.url().split('/').pop();
        page.on('pageerror', (e) => errors.push(`${name()}: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') { errors.push(`${name()}: ${m.text()}`); } });
    };
    app.windows().forEach(watch);
    app.on('window', watch);
}

test('профиль 2.12.2: настройки на месте, окна встают без ошибок, таймер идёт', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-upgrade-'));
    try {
        await seedProfile(dir);

        const { app, control } = await start(dir);
        const errors = [];
        collectErrors(app, errors);
        try {
            // Первая загрузка панели прошла до подписки на ошибки: перезагрузка
            // повторяет её уже под наблюдением.
            await reloadPanel(control);

            // Хранилище: ни один ключ не потерян и не сброшен запуском.
            const stored = await control.evaluate(() => Object.fromEntries(
                Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])
            ));
            for (const key of Object.keys(SNAPSHOT)) {
                expect(stored[key], `ключ ${key} потерян`).toBeDefined();
            }

            // Панель: значения дошли до контролов, а не только лежат в хранилище.
            const read = await control.evaluate(({ inputs, checks, segments }) => ({
                inputs: Object.fromEntries(inputs.map((id) => [id, document.getElementById(id)?.value])),
                checks: Object.fromEntries(checks.map((id) => [id, document.getElementById(id)?.checked])),
                segments: Object.fromEntries(segments.map((id) => [id, document.getElementById(id)?.getAttribute('data-value')]))
            }), {
                inputs: Object.keys(EXPECTED_CONTROLS),
                checks: Object.keys(EXPECTED_CHECKS),
                segments: Object.keys(EXPECTED_SEGMENTS)
            });
            expect(read.inputs).toEqual(EXPECTED_CONTROLS);
            expect(read.checks).toEqual(EXPECTED_CHECKS);
            expect(read.segments).toEqual(EXPECTED_SEGMENTS);
            expect(await control.evaluate(() => document.documentElement.classList.contains('ui-locked'))).toBe(true);

            // Окна: каждое открывается на старых настройках и берёт свой стиль.
            await control.evaluate(() => document.getElementById('openWidgetBtn').click());
            const widget = await waitForWindow(app, () => location.href.includes('electron-widget.html'));
            await widget.waitForLoadState('load');
            await expect.poll(() => widget.evaluate(() => document.getElementById('wFlipSec2').offsetWidth > 0)).toBe(true);

            await control.evaluate(() => document.getElementById('openClockBtn').click());
            const clock = await waitForWindow(app, () => location.href.includes('electron-clock-widget.html'));
            await clock.waitForLoadState('load');

            const display = await openDisplay(app, control);
            await expect.poll(() => display.evaluate(() => document.body.innerText.includes('Оперативное совещание'))).toBe(true);
            await closeDisplay(app, control);

            // Ячейка вида из старой версии применяется и не роняет панель.
            await control.evaluate(() => document.getElementById('presetSlot1').click());

            // Таймер идёт и доходит до окна на этих настройках.
            await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 120 }));
            await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
            await expect.poll(() => control.evaluate(() => window.timerController.isRunning === true
                || document.body.classList.contains('state-running'))).toBe(true);
            await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));

            expect(errors, 'ошибки в окнах на профиле старой версии').toEqual([]);
        } finally {
            await app.close();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
