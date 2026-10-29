'use strict';

/**
 * Память ретрансляторов главного процесса переживает перезапуск
 * (relay-store.js, userData/relay-state.json).
 *
 * Что здесь проверяется и почему не только юнитами. Юниты (tests/relay-store,
 * tests/electron-main-load) закрывают формат файла и досылку на подставке. Не
 * закрыто ими одно: что НАСТОЯЩЕЕ приложение после перезапуска ведёт себя по
 * файлу в те сотни миллисекунд, пока панель ещё не прислала своё (таймеры
 * 200/500/600 мс в control-app.js). Именно в этот зазор виджет вставал поверх
 * окон вопреки выключенной настройке, а выгрузка CSV шла без ставки и названия.
 *
 * Как поймать зазор, не ставя на скорость машины. Во втором запуске зонд в
 * главном процессе (`app.evaluate`) считает посылки панели и замеряет окно в
 * момент его СОЗДАНИЯ. Зонд проверяет сам себя: если посылка панели успела
 * раньше, замер ничего не доказывает — тест так и говорит, а не зеленеет.
 */

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { launchApp, waitForControlWindow, cleanEnv, MAIN, USER_DATA_DIR } = require('./launch');
const profileGuard = require('./profile-guard');

const RELAY_FILE = path.join(USER_DATA_DIR, 'relay-state.json');
const TITLE = 'Сохранённое мероприятие';

function readRelayFile() {
    try { return JSON.parse(fs.readFileSync(RELAY_FILE, 'utf8')); } catch { return null; }
}

/**
 * Второй запуск БЕЗ ожидания тишины: launchApp ждёт 900 мс, то есть как раз
 * досылки панели, а здесь нужен момент до неё.
 */
async function launchBeforePanelPushes(exportTarget) {
    const app = await electron.launch({
        args: [MAIN, `--user-data-dir=${USER_DATA_DIR}`],
        env: cleanEnv()
    });
    await app.evaluate(({ ipcMain, app: eapp, dialog }, target) => {
        const probe = { pushes: {}, created: [], exportSawPushes: null };
        globalThis.__relayProbe = probe;
        for (const channel of ['widget-style-update', 'display-settings-update']) {
            ipcMain.prependListener(channel, () => {
                probe.pushes[channel] = (probe.pushes[channel] || 0) + 1;
            });
        }
        ipcMain.prependListener('event-export', () => {
            probe.exportSawPushes = probe.pushes['display-settings-update'] || 0;
        });
        // Окно замеряется сразу после create-функции (она синхронна): уровень
        // «поверх» ставится в ней же, и через 600 мс его перезапишет панель.
        eapp.on('browser-window-created', (_e, win) => {
            setImmediate(() => {
                if (win.isDestroyed()) { return; }
                probe.created.push({
                    id: win.id,
                    onTop: win.isAlwaysOnTop(),
                    stylePushesBefore: probe.pushes['widget-style-update'] || 0
                });
            });
        });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, exportTarget);
    const control = await waitForControlWindow(app);
    await control.waitForLoadState('domcontentloaded');
    return { app, control };
}

test('после перезапуска виджет и выгрузка CSV следуют файлу ещё до посылок панели', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-relay-export-'));
    const target = path.join(dir, 'отчёт.csv');

    // --- 1. Первая жизнь: «поверх окон» выключено, название задано ---
    const first = await launchApp({ keepProfile: true });
    await first.control.evaluate((title) => {
        const box = document.getElementById('widgetAlwaysOnTop');
        box.checked = false;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        const input = document.getElementById('eventTitleInput');
        input.value = title;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TITLE);
    // Склейка записи — с задержкой; выход обязан дописать отложенное.
    await first.app.close();

    let second = null;
    try {
        const saved = readRelayFile();
        expect(saved, `после выхода нет ${RELAY_FILE}`).not.toBeNull();
        expect(saved.relay.lastWidgetStyle.alwaysOnTop).toBe(false);
        expect(saved.relay.lastDisplaySettings.eventTitle).toBe(TITLE);
        expect(JSON.stringify(saved), 'картинка фона в файл не пишется').not.toContain('bgLocalImage');

        // --- 2. Вторая жизнь: виджет и выгрузка — раньше посылок панели ---
        second = await launchBeforePanelPushes(target);
        await second.control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('event-export');
        });

        await expect.poll(async () => {
            const widgetId = await second.app.evaluate(({ BrowserWindow }) => {
                const w = BrowserWindow.getAllWindows()
                    .find((x) => x.webContents.getURL().includes('electron-widget.html'));
                return w ? w.id : null;
            });
            const probe = await second.app.evaluate(() => globalThis.__relayProbe);
            return widgetId !== null && probe.created.some((c) => c.id === widgetId);
        }, { message: 'окно виджета не появилось' }).toBe(true);

        const probe = await second.app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()
                .find((x) => x.webContents.getURL().includes('electron-widget.html'));
            const p = globalThis.__relayProbe;
            return { widget: p.created.find((c) => c.id === w.id), exportSawPushes: p.exportSawPushes };
        });
        console.log(`   зонд: ${JSON.stringify(probe)}`);

        expect(probe.widget.stylePushesBefore,
            'панель прислала стиль раньше, чем открылся виджет: замер ничего не доказывает').toBe(0);
        expect(probe.widget.onTop,
            'виджет открылся поверх окон, хотя в сохранённой настройке «поверх» выключено').toBe(false);

        await expect.poll(() => fs.existsSync(target), { message: 'файл отчёта не появился' }).toBe(true);
        expect(probe.exportSawPushes,
            'панель прислала настройки дисплея раньше выгрузки: замер ничего не доказывает').toBe(0);
        const csv = fs.readFileSync(target, 'utf8');
        console.log(`   отчёт:\n${csv.replace(/^/gm, '   | ')}`);
        expect(csv, 'название мероприятия — из файла').toContain(TITLE);
        // Ставка (по умолчанию 1000 ₽) видна колонкой стоимости: без ставки её нет.
        expect(csv, 'ставка — из файла').toContain('Стоимость');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        // Сторож профиля: «было» снято первым запуском этого теста. Упади тест
        // до второго запуска — профиль всё равно возвращается отдельным.
        if (second) {
            await profileGuard.watch(second.app);
            await second.app.close();
        } else {
            const fix = await launchApp();
            await fix.app.close();
        }
        // Профиль общий: следующий тест не должен стартовать с памятью этого.
        fs.rmSync(RELAY_FILE, { force: true });
    }
});
