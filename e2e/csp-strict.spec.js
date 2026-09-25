const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay, waitForWidget, waitForClock } = require('./window-ready');

/**
 * CSP окон без инлайна (`script-src 'self'; style-src 'self'`) — в ЖИВОМ окне.
 *
 * scripts/csp-guard.js проверяет разметку до запуска, но не видит того, что
 * рождается в рантайме: шаблон innerHTML со style="…", setAttribute('style'),
 * <style>, собранный скриптом. Такое браузер молча отказывается применять —
 * и элемент рисуется без стиля. Единственный честный свидетель — событие
 * `securitypolicyviolation` в самом окне, поэтому слушатель ставится ДО
 * загрузки каждого окна (init-скрипт контекста; CSP страницы его не касается)
 * и собирает нарушения, пока тест проходит по окнам, стилям, ящику и вкладкам.
 *
 * Второй тест — деления циферблатов: их углы были style="transform: rotate()"
 * на каждом из 157 элементов и стали CSS. Часы в visual:check не сверяются
 * (показывают живое время), поэтому углы меряются здесь, во всех окнах.
 */

// Слушатель — в каждое окно до его первого скрипта.
function installWatcher() {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push(
            `${e.violatedDirective} ${e.blockedURI || ''} ${(e.sourceFile || '').split('/').pop()}:${e.lineNumber} «${e.sample || ''}»`
        );
    }, true);
}

const STYLE_GROUPS = ['#timerStyle', '#clockStyle', '#displayTimerStyle'];
const BLOCKS = ['showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft'];

// Профиль e2e общий на прогон: всё, что тест переключает, он возвращает.
async function snapshotControls(control) {
    return control.evaluate(([groups, blocks]) => ({
        styles: groups.map((g) => document.querySelector(g).dataset.value),
        blocks: blocks.map((b) => document.getElementById(b).checked)
    }), [STYLE_GROUPS, BLOCKS]);
}

async function applyControls(control, { styles, blocks }) {
    await control.evaluate(([groups, blockIds, st, bl]) => {
        groups.forEach((g, i) => {
            const b = document.querySelector(`${g} button[data-val="${st[i]}"]`);
            if (b) { b.click(); }
        });
        blockIds.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el.checked !== bl[i]) {
                el.checked = bl[i];
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }, [STYLE_GROUPS, BLOCKS, styles, blocks]);
    await control.waitForTimeout(400);
}

async function violations(page) {
    return page.evaluate(() => window.__cspViolations || null);
}

test('ни одного нарушения CSP: четыре окна, все стили, ящик и вкладки', async () => {
    const { app, control } = await launchApp();
    const before = await snapshotControls(control);
    const consoleCsp = [];
    const watchConsole = (page, name) => page.on('console', (m) => {
        if (/Content Security Policy|Refused to (apply|execute|load)/.test(m.text())) {
            consoleCsp.push(`${name}: ${m.text()}`);
        }
    });
    try {
        await app.context().addInitScript(installWatcher);
        watchConsole(control, 'панель');
        // Панель уже загружена — перезагружаем её ПОД наблюдением.
        await control.reload();
        await control.waitForFunction(() => typeof window.timerController === 'object');
        // Не null — слушатель встал; пустой — загрузка панели чистая.
        expect(await violations(control), 'нарушения CSP при загрузке панели').toEqual([]);

        // Зонд самопроверки: слушатель обязан увидеть настоящее нарушение, иначе
        // пустой список значил бы и «чисто», и «не слышим».
        await control.evaluate(() => {
            const probe = document.createElement('div');
            probe.innerHTML = '<span style="color: red">зонд</span>';
            document.body.appendChild(probe);
            probe.remove();
        });
        await expect.poll(() => violations(control).then((v) => v.length), { message: 'зонд не пойман' }).toBeGreaterThan(0);
        // Тот же зонд обязан дойти и до консоли — второй канал наблюдения.
        await expect.poll(() => consoleCsp.length, { message: 'зонд не дошёл до консоли' }).toBeGreaterThan(0);
        await control.evaluate(() => { window.__cspViolations.length = 0; });
        consoleCsp.length = 0;

        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        watchConsole(widget, 'виджет');
        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        watchConsole(clock, 'часы');
        const display = await openDisplay(app, control);
        watchConsole(display, 'дисплей');

        // Ящик и КАЖДАЯ вкладка: в них рождаются ряды, списки звуков, превью.
        const tabs = await control.$$eval('.tab-btn[data-tab]', (els) => [...new Set(els.map((e) => e.dataset.tab))]);
        expect(tabs.length, 'вкладки ящика не найдены').toBeGreaterThanOrEqual(4);
        for (const tab of tabs) {
            await control.click(`.tab-btn[data-tab="${tab}"]`);
            await control.waitForTimeout(250);
        }
        // Все стили во всех трёх окнах — у каждого своя разметка и свои правила.
        await applyControls(control, { styles: before.styles, blocks: BLOCKS.map(() => true) });
        for (const style of ['circle', 'flip', 'analog', 'digits']) {
            for (const group of STYLE_GROUPS) {
                await control.evaluate(([g, s]) => {
                    const b = document.querySelector(`${g} button[data-val="${s}"]`);
                    if (b) { b.click(); }
                }, [group, style]);
            }
            await control.waitForTimeout(400);
        }
        // Индикатор загрузки и тост строят разметку шаблоном.
        await control.evaluate(() => {
            const o = window.LoadingIndicator.show('проверка');
            window.LoadingIndicator.hide(o);
            window.Toast.show('проверка', 'info', 50);
        });
        await control.click('#drawerClose').catch(() => {});

        const pages = { панель: control, виджет: widget, часы: clock, дисплей: display };
        const found = [];
        for (const [name, page] of Object.entries(pages)) {
            const v = await violations(page);
            expect(v, `${name}: слушатель CSP не установлен`).not.toBeNull();
            found.push(...v.map((x) => `${name}: ${x}`));
        }
        expect([...found, ...consoleCsp], `нарушения CSP:\n${[...found, ...consoleCsp].join('\n')}`).toEqual([]);
    } finally {
        await applyControls(control, before).catch(() => {});
        await app.close();
    }
});

// Угол поворота элемента из вычисленной матрицы.
function tickAngles(selector) {
    return [...document.querySelectorAll(selector)].map((el) => {
        const t = getComputedStyle(el).transform;
        const m = /^matrix\(([^)]+)\)$/.exec(t);
        if (!m) { return { raw: t }; }
        const [a, b] = m[1].split(',').map(Number);
        return { deg: Math.round(((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 * 100) / 100 };
    });
}

function expectDial(angles, step, count, what) {
    expect(angles.length, `${what}: делений`).toBe(count);
    angles.forEach((a, k) => {
        expect(a.deg, `${what}: деление ${k + 1} без матрицы (${a.raw})`).not.toBeUndefined();
        expect(Math.abs(a.deg - ((k * step) % 360)), `${what}: деление ${k + 1} стоит на ${a.deg}°`).toBeLessThan(0.05);
    });
}

test('деления циферблатов стоят под своими углами во всех окнах', async () => {
    const { app, control } = await launchApp();
    const before = await snapshotControls(control);
    try {
        // Мини-часы блоков рисуются только у видимых блоков в стиле «Аналог».
        await applyControls(control, { styles: STYLE_GROUPS.map(() => 'analog'), blocks: BLOCKS.map(() => true) });
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        const display = await openDisplay(app, control);
        await display.waitForSelector('#timerAnalog.active');

        expectDial(await widget.evaluate(tickAngles, '.widget-analog-clock > .widget-clock-tick'), 30, 12, 'виджет');
        expectDial(await clock.evaluate(tickAngles, '.widget-analog-clock > .widget-analog-tick'), 30, 12, 'часы');
        // 61 деление: нулевое и 360° — два разных элемента (мелкое и крупное).
        expectDial(await display.evaluate(tickAngles, '.clock-face > .clock-tick'), 6, 61, 'дисплей');
        const minis = await display.evaluate(() => document.querySelectorAll('.mini-clock').length);
        expect(minis, 'мини-часы блоков').toBeGreaterThanOrEqual(3);
        for (let i = 0; i < minis; i++) {
            const angles = await display.evaluate((n) => {
                const box = document.querySelectorAll('.mini-clock')[n];
                return [...box.querySelectorAll(':scope > .mini-tick')].map((el) => {
                    const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(el).transform);
                    if (!m) { return { raw: getComputedStyle(el).transform }; }
                    const [a, b] = m[1].split(',').map(Number);
                    return { deg: Math.round(((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 * 100) / 100 };
                });
            }, i);
            expectDial(angles, 30, 12, `дисплей, мини-часы ${i + 1}`);
        }
    } finally {
        await applyControls(control, before).catch(() => {});
        await app.close();
    }
});

test('часовая группа флипа: скрыта без часов, видна с часами — без инлайнового «скрыто»', async () => {
    // Начальное «скрыто» было style="display:none" в разметке (дисплей и
    // виджет). Теперь у дисплея это класс has-hours на #timerFlip, у виджета —
    // правило widget.css; показ по-прежнему делает скрипт.
    const { app, control } = await launchApp();
    const before = await snapshotControls(control);
    const shown = (page, ids) => page.evaluate((list) => list.map((id) => getComputedStyle(document.getElementById(id)).display !== 'none'), ids);
    const set = (s) => control.evaluate((sec) => window.ipcRenderer.send('timer-command', { type: 'set', seconds: sec }), s);
    try {
        await applyControls(control, { styles: ['flip', before.styles[1], 'flip'], blocks: before.blocks });
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        const display = await openDisplay(app, control);
        await display.waitForSelector('#timerFlip.active');

        await set(300);
        await expect.poll(() => shown(display, ['flipHoursUnit', 'flipHoursSep'])).toEqual([false, false]);
        await expect.poll(() => shown(widget, ['wFlipHoursGroup', 'wFlipHoursSep'])).toEqual([false, false]);

        await set(5400);
        await expect.poll(() => shown(display, ['flipHoursUnit', 'flipHoursSep'])).toEqual([true, true]);
        await expect.poll(() => shown(widget, ['wFlipHoursGroup', 'wFlipHoursSep'])).toEqual([true, true]);
        // Показанная группа получает СВОЙ display, как при прежнем style.display = ''.
        expect(await display.evaluate(() => getComputedStyle(document.getElementById('flipHoursSep')).display)).toBe('flex');

        await set(300);
        await expect.poll(() => shown(display, ['flipHoursUnit', 'flipHoursSep'])).toEqual([false, false]);
    } finally {
        await set(300).catch(() => {});
        await applyControls(control, before).catch(() => {});
        await app.close();
    }
});
