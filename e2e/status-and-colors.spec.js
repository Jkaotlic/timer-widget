const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Поведенческие проверки статуса и цветовых полос.
 *
 * Эти же вещи покрыты в tests/audit-2026-07-fixes.test.js регулярками по
 * исходнику — там иначе никак, логика живёт в inline-скриптах. Но регулярка
 * проверяет ТЕКСТ кода, а не поведение: при рефакторинге она ломается, даже
 * когда поведение верное (так и случилось при выносе логики в renderer-shared).
 * Здесь всё наоборот — гоняем настоящее приложение, шлём настоящие IPC-команды и
 * читаем то, что реально отрисовалось. Регулярки остаются как быстрая страховка,
 * эти тесты — как источник правды о поведении.
 */

let app;
let control;

// Прогоняет команду таймера через настоящий IPC и ждёт перерисовки.
async function sendCommand(payload) {
    await control.evaluate((cmd) => {
        window.ipcRenderer.send('timer-command', cmd);
    }, payload);
    // Состояние возвращается броадкастом timer-state; даём кругу пройти.
    await control.waitForTimeout(250);
}

// textContent, а не innerText: innerText отдаёт текст уже после CSS-трансформаций,
// а заголовок и статус в панели подняты в верхний регистр через text-transform.
const timeText = () => control.locator('#controlTimeDigits').textContent();
const statusText = () => control.locator('#statusText').textContent();
// Подпись состояния живёт в своём span: в #controlHeroLabel рядом с ней
// стоит точка состояния, и её textContent тянул бы за собой пустую строку.

// Вход в состояние ввода: редизайн 2026-08-12 сделал ручной ввод ЧЕТВЁРТЫМ
// состоянием панели, а не полем сбоку. Идемпотентен — соседний тест мог
// оставить панель уже в нём, и клик по спрятанному времени истёк бы по таймауту.
const enterInputMode = async () => {
    const already = await control.evaluate(
        () => document.body.classList.contains('state-input')
    );
    if (already) { return; }
    await control.click('#controlTime');
    await control.waitForTimeout(300);
};

const heroLabel = () => control.locator('#statusText').textContent();
const timeClasses = () => control.locator('#controlTime').getAttribute('class');

test.beforeAll(async () => {
    ({ app, control } = await launchApp());
});

test.afterAll(async () => {
    if (app) { await app.close(); }
});

test.describe('цветовые полосы', () => {
    test('ровно на нуле время красное (danger), а не жёлтое (warning)', async () => {
        // Регрессия: условие danger было `percentLeft <= 10 && percentLeft > 0`,
        // поэтому 0% проваливался в жёлтую полосу и 00:00 показывалось жёлтым.
        await sendCommand({ type: 'set', seconds: 60, allowNegative: false });
        await sendCommand({ type: 'adjust', deltaSeconds: -60, allowNegative: false });

        expect(await timeText()).toBe('00:00');
        const cls = await timeClasses();
        expect(cls).toContain('danger');
        expect(cls).not.toContain('warning');
    });

    test('много времени — без предупреждающих классов', async () => {
        await sendCommand({ type: 'set', seconds: 600, allowNegative: false });
        const cls = await timeClasses();
        expect(cls).not.toContain('danger');
        expect(cls).not.toContain('warning');
    });

    test('в перерасходе время красное и заголовок меняется', async () => {
        await sendCommand({ type: 'set', seconds: 60, allowNegative: true });
        await sendCommand({ type: 'adjust', deltaSeconds: -120, allowNegative: true });

        expect(await timeText()).toBe('01:00');
        expect(await timeClasses()).toContain('danger');
        // Заголовок «Осталось» над отрицательным временем читался неверно.
        expect(await heroLabel()).toBe('Перерасход');
    });

    test('после нового пресета цвет возвращается в норму', async () => {
        // Тот самый баг: инлайновый красный не снимался, и время оставалось
        // красным даже когда до конца снова далеко.
        await sendCommand({ type: 'set', seconds: 600, allowNegative: false });
        const cls = await timeClasses();
        expect(cls).not.toContain('danger');
        expect(cls).not.toContain('warning');
        // В покое подпись называет ДЛИТЕЛЬНОСТЬ: остатка ещё нет, отсчёт не идёт.
        expect(await heroLabel()).toBe('Длительность');
    });
});

test.describe('приоритеты статуса', () => {
    test('пауза в перерасходе показывается как «Пауза», а не «Завершено»', async () => {
        // Ветка isPaused была недостижима при remainingSeconds <= 0, поэтому
        // докладчик, выбившийся из времени и нажавший паузу, видел «Завершено».
        await sendCommand({ type: 'set', seconds: 60, allowNegative: true });
        await sendCommand({ type: 'start', allowNegative: true });
        await sendCommand({ type: 'adjust', deltaSeconds: -120, allowNegative: true });
        await sendCommand({ type: 'pause', allowNegative: true });

        expect(await statusText()).toBe('Пауза');
    });

    test('перерасход на ходу показывается как «Перерасход»', async () => {
        await sendCommand({ type: 'set', seconds: 60, allowNegative: true });
        await sendCommand({ type: 'start', allowNegative: true });
        await sendCommand({ type: 'adjust', deltaSeconds: -120, allowNegative: true });

        expect(await statusText()).toBe('Перерасход');
        await sendCommand({ type: 'pause', allowNegative: true });
    });

    test('досчёт до нуля показывается как «Завершено»', async () => {
        await sendCommand({ type: 'set', seconds: 60, allowNegative: false });
        await sendCommand({ type: 'adjust', deltaSeconds: -60, allowNegative: false });
        expect(await statusText()).toBe('Завершено');
    });
});

test.describe('подсветка быстрого выбора', () => {
    const activePresets = () =>
        control.locator('.preset.active').evaluateAll((els) =>
            els.map((e) => e.dataset.minutes));

    test('клик по пресету подсвечивает именно его', async () => {
        await control.locator('.preset[data-minutes="15"]').click();
        await control.waitForTimeout(250);
        expect(await activePresets()).toEqual(['15']);
    });

    test('ручной ввод другого времени снимает подсветку', async () => {
        // Регрессия: класс active вешался по клику и не снимался ничем —
        // подсвеченной оставалась кнопка, не соответствующая таймеру.
        await enterInputMode();
        // Полей теперь ДВА: минуты и секунды отдельно, формат помнить не нужно.
        await control.locator('#manualMinutes').fill('7');
        await control.locator('#manualSeconds').fill('30');
        await control.locator('#manualSeconds').press('Enter');
        await control.waitForTimeout(400);

        expect(await timeText()).toBe('07:30');
        expect(await activePresets()).toEqual([]);
    });

    test('корректировка ± не сбивает подсветку пресета', async () => {
        // Пресет остаётся прежним (сброс вернёт к нему), меняется только total.
        await control.locator('.preset[data-minutes="45"]').click();
        await control.waitForTimeout(250);
        // Редизайн 2026-08-12 показывает ряд ± только там, где он нужен, — в
        // отсчёте и при вводе. В покое кнопки нет на экране, и прежняя версия
        // теста кликала по display:none, а не проверяла своё условие.
        await enterInputMode();
        await control.locator('.adjust-btn[data-adjust="300"]').click();
        await control.waitForTimeout(300);

        expect(await timeText()).toBe('50:00');
        expect(await activePresets()).toEqual(['45']);
    });
});

test.describe('Escape не пробивает слои', () => {
    test('Escape при открытой панели настроек только закрывает её', async () => {
        await control.locator('.tab-btn[data-tab="timer"]').click();
        await control.waitForTimeout(500);
        await expect(control.locator('#settingsDrawer')).toHaveClass(/open/);

        await control.keyboard.press('Escape');
        await control.waitForTimeout(600);

        await expect(control.locator('#settingsDrawer')).not.toHaveClass(/open/);
        // Приложение живо: панель по-прежнему отвечает.
        expect(await timeText()).toBeTruthy();
    });
});

test.describe('лимит перерасхода', () => {
    // input[type=checkbox] спрятан под кастомным .toggle-slider (opacity 0), и
    // Playwright не считает его кликабельным даже с force. Переключаем напрямую
    // и вручную шлём change — ровно так же это делает пользователь через слайдер.
    const setAllowNegative = (on) => control.evaluate((value) => {
        const el = document.getElementById('allowNegative');
        if (!el) { return; }
        el.checked = value;
        el.dispatchEvent(new Event('change'));
    }, on);

    test('строка лимита появляется только вместе с режимом «ниже нуля»', async () => {
        await enterInputMode();
        const row = control.locator('#overrunRow');

        await expect(row).toBeHidden();
        await setAllowNegative(true);
        await control.waitForTimeout(250);
        await expect(row).toBeVisible();

        await setAllowNegative(false);
        await control.waitForTimeout(250);
        await expect(row).toBeHidden();
    });

    test('введённый лимит разбирается и показывается подсказкой', async () => {
        await enterInputMode();
        await setAllowNegative(true);
        await control.waitForTimeout(200);
        await control.locator('#overrunLimit').fill('2:30');
        await control.locator('#overrunLimit').dispatchEvent('input');
        await control.waitForTimeout(200);

        expect(await control.locator('#overrunLimitHint').textContent()).toContain('02:30');
        await setAllowNegative(false);
    });
});

test.describe('декомпозиция панели: модули живы в рантайме', () => {
    test('все вынесенные модули подняли свои экспорты', async () => {
        // Структурные тесты проверяют, что <script src> на месте. Здесь важнее
        // другое: что файлы реально загрузились и объявили свои имена. Опечатка
        // в пути дала бы молчаливый 404 и падение при первом же клике.
        const present = await control.evaluate(() => ({
            toast: typeof window.Toast?.show,
            loading: typeof window.LoadingIndicator?.show,
            scaleEdit: typeof window.setupScaleValueEdit,
            picker: typeof window.ColorPicker,
            pickerToggle: typeof window.addPickerToggle,
            openModal: typeof window.openModal,
            closeModal: typeof window.closeModal,
            help: typeof window.showKeyboardShortcuts,
            soundBank: typeof window.SoundBank?.playBuiltInPreset,
            mixin: typeof window.CustomSoundsMixin
        }));

        expect(present).toEqual({
            toast: 'function',
            loading: 'function',
            scaleEdit: 'function',
            picker: 'function',
            pickerToggle: 'function',
            openModal: 'function',
            closeModal: 'function',
            help: 'function',
            soundBank: 'function',
            mixin: 'object'
        });
    });

    test('методы пользовательских звуков подмешаны в контроллер', async () => {
        // Object.assign(prototype, mixin) — если строка потеряется, падение
        // случится не при загрузке, а при первом клике «добавить звук».
        const methods = await control.evaluate(() =>
            ['showSoundUploadError', 'handleSoundFileUpload', 'loadCustomSounds',
                'playCustomSound', 'deleteCustomSound']
                .map((m) => typeof window.timerController[m]));

        expect(methods).toEqual(['function', 'function', 'function', 'function', 'function']);
    });

    test('список пользовательских звуков отрисовывается без ошибок', async () => {
        // Реальный вызов подмешанного метода: проверяем, что this внутри примеси
        // указывает на контроллер и DOM-узлы находятся.
        const ok = await control.evaluate(() => {
            try {
                window.timerController.loadCustomSounds();
                return document.getElementById('customSoundList') !== null;
            } catch (e) {
                return `упало: ${e.message}`;
            }
        });
        expect(ok).toBe(true);
    });

    test('стили подъехали из внешнего файла', async () => {
        // control.css вынесен из inline-<style>; если бы файл не нашёлся,
        // панель отрисовалась бы голым HTML.
        const bg = await control.evaluate(() => {
            const panel = document.querySelector('.control-panel');
            return panel ? getComputedStyle(panel).display : null;
        });
        expect(bg).toBeTruthy();
        expect(bg).not.toBe('inline');
    });
});
