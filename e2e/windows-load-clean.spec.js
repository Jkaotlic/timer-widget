const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    openDisplay, waitForWidget, waitForClock, reloadPanel,
    waitForWidgetSnapshot, waitForClockSnapshot, waitForDisplaySnapshot
} = require('./window-ready');

/**
 * Ни одно из четырёх окон не падает при загрузке.
 *
 * Проверка выглядит тривиальной, а ловит целый класс: без сборщика КАЖДЫЙ файл
 * — classic <script>, и все они делят одну глобальную область. Второй
 * `const Layouts` в другом модуле роняет ВЕСЬ inline-скрипт окна
 * («Identifier 'Layouts' has already been declared»), после чего панель
 * существует как разметка, но не отвечает ни на одно действие.
 *
 * Поймано 01.09.2026 на собственной правке: расхождение проявлялось как
 * «ползунок не обновился», и на этот симптом можно было потратить час. Ни один
 * тест набора не смотрел на консоль окна, поэтому диагноз пришлось ставить
 * зондом.
 *
 * ЗОНД САМОПРОВЕРКИ ниже подсовывает окну заведомо падающий скрипт: без него
 * зелёный означал бы и «ошибок нет», и «мы их не видим».
 */

// `alive` — глобал, который ставит код страницы окна (control-app.js,
// widget-app.js, clock-widget-app.js; у дисплея — display-script.js). До
// 25.09.2026 это были инлайновые блоки под CSP на хешах; теперь CSP — `script-src
// 'self'`, и инлайн, вернувшийся в разметку, браузер не исполнит — окно останется
// разметкой без логики, а в консоли появится «Refused to execute inline
// script». Первое ловит `alive`, второе — наблюдатель консоли.
const WINDOWS = [
    { name: 'панель', get: async (app, control) => control, alive: 'timerController' },
    { name: 'виджет', open: 'open-widget', get: (app) => waitForWidget(app), alive: 'timerWidget', drop: true,
      settle: waitForWidgetSnapshot },
    { name: 'часы', open: 'open-clock-widget', get: (app) => waitForClock(app), alive: 'clockWidget', drop: true,
      settle: waitForClockSnapshot },
    { name: 'дисплей', get: (app, control) => openDisplay(app, control), alive: 'displayTimer', drop: true,
      settle: waitForDisplaySnapshot }
];

test('четыре окна загружаются без ошибок в консоли', async () => {
    const { app, control } = await launchApp();
    const errors = [];
    const watch = (page, name) => {
        page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
        page.on('console', (m) => {
            if (m.type() === 'error') { errors.push(`${name}: ${m.text()}`); }
        });
    };
    try {
        watch(control, 'панель');
        for (const w of WINDOWS) {
            if (w.open) { await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open); }
            const page = await w.get(app, control);
            if (page !== control) { watch(page, w.name); }
            // Загрузка окна ДОШЛА до конца (было 200 мс): `load` — модули
            // исполнены; снимок main обработан — его обработчики, где тоже
            // может упасть код окна, отработали. У панели — launchApp уже
            // дождался её стартовой рассылки.
            await page.waitForLoadState('load');
            if (w.settle) { await w.settle(app, page); }
            expect(await page.evaluate((g) => typeof window[g], w.alive), `${w.name}: код страницы окна не исполнился`)
                .toBe('object');
            // theme-init(-tone).js в <head> ставит тему — свидетель того, что
            // и он исполнился до первого кадра.
            expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
                `${w.name}: скрипт темы в <head> не исполнился`).not.toBeNull();
            if (w.drop) {
                expect(await page.evaluate(() => typeof window.DropGuard), `${w.name}: drop-guard.js не загружен`)
                    .toBe('object');
            }
        }
        // Перезагружаем панель ПОД наблюдением: слушатель повешен уже после
        // первой загрузки, и без этого её собственные ошибки прошли бы мимо.
        // Контроллер встал и стартовая рассылка (таймеры конструктора 100/200/
        // 600 мс) ушла — было 1500 мс. События консоли приходят по CDP раньше
        // ответов на вызовы, которые идут после них (evaluate в reloadPanel).
        const reloadedAt = Date.now();
        await reloadPanel(control);
        // Окно наблюдения — не короче прежних 1500 мс от перезагрузки (ревью
        // B7a, M6): reloadPanel кончается со стартовой рассылкой (≈ 600–700
        // мс), а ошибка из таймера ПОЗЖЕ неё (подсказка онбординга, проверка
        // обновлений) прошла бы мимо.
        const rest = 1500 - (Date.now() - reloadedAt);
        if (rest > 0) {
            // пауза законна: утверждается ОТСУТСТВИЕ ошибок за интервал после
            // загрузки — признака «отложенных задач больше нет» у панели нет
            await control.waitForTimeout(rest);
        }

        expect(errors, `ошибки при загрузке окон:\n${errors.join('\n')}`).toEqual([]);
        // Окно, чей скрипт упал, не доводит сборку до конца: контроллера нет.
        expect(await control.evaluate(() => typeof window.timerController)).toBe('object');
    } finally {
        await app.close();
    }
});

test('мост каждого окна открыт по СВОЕЙ роли: своё проходит, чужое режется', async () => {
    // preload.js берёт роль из process.argv (additionalArguments в
    // main-windows.js). Unit-тест проверяет это на подставке; здесь — что
    // настоящий Electron доносит аргумент до песочницы КАЖДОГО окна и окна не
    // делят процесс с чужой ролью. Каналы берутся из таблицы, а не руками.
    const { ROLES, RECEIVERS, SENDERS } = require('../ipc-senders');
    const PAGE_OF = { control: 0, widget: 1, clock: 2, display: 3 };
    const { app, control } = await launchApp();
    try {
        for (const role of ROLES) {
            const w = WINDOWS[PAGE_OF[role]];
            if (w.open) { await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open); }
            const page = await w.get(app, control);
            const errors = [];
            const onConsole = (m) => { if (m.type() === 'error') { errors.push(m.text()); } };
            page.on('console', onConsole);
            const own = Object.keys(RECEIVERS).find((ch) => RECEIVERS[ch].includes(role));
            const foreign = Object.keys(RECEIVERS).find((ch) => !RECEIVERS[ch].includes(role));
            // Необратимое вне панели: мост обязан отрезать его ещё в окне.
            const foreignSend = SENDERS['reset-and-relaunch'].includes(role) ? null : 'reset-and-relaunch';
            await page.evaluate(({ own, foreign, foreignSend }) => {
                const off = window.electronAPI.on(own, () => {});
                off();
                window.electronAPI.on(foreign, () => {});
                if (foreignSend) { window.electronAPI.send(foreignSend); }
            }, { own, foreign, foreignSend });
            // Отказы моста пишутся синхронно, по порядку вызовов (preload.js,
            // blocked): ждём ПОСЛЕДНИЙ ожидаемый — было 150 мс. Раз он пришёл,
            // отказ своему каналу (вызван раньше) пришёл бы тоже — утверждение
            // отсутствия ниже не холостое.
            const last = foreignSend ? `channel: ${foreignSend} (окно ${role})` : `channel: ${foreign} (окно ${role})`;
            await expect.poll(() => errors.some((t) => t.startsWith('Blocked attempt') && t.includes(last)),
                { message: `${role}: отказ моста «${last}» не пришёл в консоль:\n${errors.join('\n')}` }).toBe(true);
            page.off('console', onConsole);
            const blocked = errors.filter((t) => t.startsWith('Blocked attempt'));
            expect(blocked.some((t) => t.includes(`channel: ${foreign} (окно ${role})`)),
                `${role}: чужой канал ${foreign} не отрезан или роль не та:\n${errors.join('\n')}`).toBe(true);
            expect(blocked.some((t) => t.includes(`channel: ${own} `)), `${role}: свой канал ${own} отрезан`).toBe(false);
            if (foreignSend) {
                expect(blocked.some((t) => t.includes(`channel: ${foreignSend} (окно ${role})`)),
                    `${role}: ${foreignSend} прошёл через мост`).toBe(true);
            }
        }
    } finally {
        await app.close();
    }
});

test('зонд самопроверки: падение скрипта в окне ВИДНО', async () => {
    // Раньше зонд подсовывал окну инлайновый <script> с повторным `const
    // CONFIG`. Под CSP без 'unsafe-inline' (SEC-08) такой скрипт не исполняется
    // — поэтому падение здесь рождается в самой странице, из таймера: это тот
    // же путь «необработанное исключение в окне», которым падает и сломанный
    // модуль.
    const { app, control } = await launchApp();
    const errors = [];
    control.on('pageerror', (e) => errors.push(e.message));
    try {
        await control.evaluate(() => {
            setTimeout(() => { throw new Error('зонд: заведомое падение'); }, 0);
        });
        // Опрос, а не 300 мс: падение приходит событием из таймера окна.
        await expect.poll(() => errors.length, { message: 'наблюдатель не увидел заведомо падающий скрипт' })
            .toBeGreaterThan(0);
    } finally {
        await app.close();
    }
});

test('CSP не пускает внедрённый инлайновый скрипт', async () => {
    // Свидетель того, что политика ДЕЙСТВУЕТ, а не просто записана в meta:
    // `script-src 'self'` не пускает ни один инлайновый скрипт, и Chromium
    // называет причину в консоли. Будь CSP сломана (опечатка в meta отбрасывает
    // директиву целиком), глобал бы появился. То же для стиля: `style-src
    // 'self'` не применяет внедрённый <style>.
    const { app, control } = await launchApp();
    const consoleErrors = [];
    control.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); } });
    try {
        await control.evaluate(() => {
            const s = document.createElement('script');
            s.textContent = 'window.__cspProbe = 1;';
            document.head.appendChild(s);
            const st = document.createElement('style');
            st.textContent = ':root { --csp-probe: 1; }';
            document.head.appendChild(st);
        });
        // Отказ CSP — событием консоли; ждём его (было 300 мс). Скрипт и стиль
        // применились бы СИНХРОННО при вставке, так что проверки отсутствия
        // ниже после вставки уже не холостые.
        await expect.poll(() => consoleErrors.some((t) => /Content Security Policy/i.test(t)),
            { message: `отказ CSP не виден в консоли:\n${consoleErrors.join('\n')}` }).toBe(true);
        expect(await control.evaluate(() => typeof window.__cspProbe), 'внедрённый скрипт исполнился — CSP не действует')
            .toBe('undefined');
        expect(await control.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--csp-probe')),
            'внедрённый <style> применился — style-src не действует').toBe('');
        expect(consoleErrors.some((t) => /Content Security Policy/i.test(t)),
            `отказ CSP не виден в консоли:\n${consoleErrors.join('\n')}`).toBe(true);
    } finally {
        await app.close();
    }
});
