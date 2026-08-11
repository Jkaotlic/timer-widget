const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Вкладка «Звуки»: один вид контрола на один смысл, и мишень не меньше нормы.
 *
 * Включение каждого события звука было нативным чекбоксом 14×14, а точно такое
 * же по смыслу включение ВСЕХ звуков — переключателем 36×20 в шапке той же
 * группы. Один смысл, два разных контрола в одном ящике, и меньший из них
 * вчетверо мельче собственного порога мишени проекта (--tw-hit-min = 32px).
 *
 * Меряется настоящий кликабельный прямоугольник в открытом ящике, а не
 * присутствие класса в разметке: у чекбокса мишень задаётся его собственными
 * width/height, и осмотр разметки этого не показывает.
 */
const ROWS = [
    ['start', 'soundStartEnabled'],
    ['end', 'soundEndEnabled'],
    ['minute', 'soundMinuteEnabled'],
    ['overrun', 'soundOverrunEnabled']
];

test('включение звука события — тот же переключатель, что и общий, и не мельче мишени', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="sound"]');
        await control.waitForTimeout(700);

        const m = await control.evaluate((rows) => {
            const HIT_MIN = parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--tw-hit-min')
            ) || 32;

            const master = document.getElementById('soundMasterEnabled');
            const masterKind = master.closest('.toggle-switch') ? 'toggle' : 'checkbox';
            const mr = (master.closest('.toggle-switch') || master).getBoundingClientRect();
            const masterBox = { w: +mr.width.toFixed(1), h: +mr.height.toFixed(1) };

            const items = rows.map(([kind, id]) => {
                const input = document.getElementById(id);
                const box = input.closest('.toggle-switch') || input;
                const r = box.getBoundingClientRect();
                return {
                    kind,
                    control: input.closest('.toggle-switch') ? 'toggle' : 'checkbox',
                    w: +r.width.toFixed(1),
                    h: +r.height.toFixed(1),
                    // Доступное имя обязано пережить переезд подписи из <label>
                    // наружу: иначе контрол остаётся безымянным для скринридера.
                    name: input.getAttribute('aria-label') || (input.closest('label')?.textContent || '').trim()
                };
            });
            return { hitMin: HIT_MIN, masterKind, masterBox, items };
        }, ROWS);

        // Общий выключатель — из того же ящика и с тем же порогом: он был
        // 32×18, то есть ниже мишени, ради которой правились ряды.
        expect(m.masterBox.h, `общий выключатель ${m.masterBox.w}×${m.masterBox.h} при пороге ${m.hitMin}`)
            .toBeGreaterThanOrEqual(m.hitMin);

        for (const it of m.items) {
            expect(it.control, `ряд «${it.kind}»: контрол ${it.control}, а общий выключатель — ${m.masterKind}`)
                .toBe(m.masterKind);
            expect(it.h, `ряд «${it.kind}»: мишень ${it.w}×${it.h} при пороге ${m.hitMin}`)
                .toBeGreaterThanOrEqual(m.hitMin);
            expect(it.name.length, `ряд «${it.kind}» без доступного имени`).toBeGreaterThan(0);
        }
    } finally {
        await app.close();
    }
});
