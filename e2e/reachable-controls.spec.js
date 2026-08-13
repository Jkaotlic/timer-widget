const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Достижимость мышью — тема этого прохода.
 *
 * Предыдущий проход починил ЛОГИКУ синхронизации стиля часов и оставил зелёный
 * e2e-тест, который выставляет `.checked` кодом. Контрол при этом остался в блоке
 * `display:none`, то есть функция была недостижима — и тест этого не показывал.
 * Здесь всё делается ТОЛЬКО кликами и только по видимым элементам: Playwright
 * сам откажется кликать по скрытому узлу, поэтому спрятать контрол снова и
 * оставить тест зелёным нельзя.
 *
 * Проверяется три вещи:
 *   1. справка «?» раскрывается и мышью, И С КЛАВИАТУРЫ — вопрос был <div>,
 *      поэтому Tab проходил мимо, а Enter ничего не делал;
 *   2. переключатели часов (секунды, 24 часа) реально меняют окно часов;
 *   3. «Как у виджета» скрывает выбор стиля часов, как и обещает.
 */

const isClock = () => !!document.getElementById('wFlipSecGroup');

async function findClock(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(isClock).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Что видно в окне часов. Проба обязана быть НЕЗАВИСИМОЙ ОТ СТИЛЯ: у часов их
// четыре, и в каждом время рисуется своей разметкой. Первая версия смотрела
// только на `.time-display .clock-seconds` (круг/LED) и на флип-часах всегда
// возвращала «секунд нет» — переключатель работал, а тест падал.
function probeClock() {
    const visibleText = (sel) => {
        const el = document.querySelector(sel);
        if (!el || el.getClientRects().length === 0) { return null; }
        return el.textContent.replace(/\s+/g, ' ').trim();
    };
    // Круг/LED — один узел; флип — набор карточек с цифрами.
    const plain = visibleText('.time-display');
    const flipSecs = document.getElementById('wFlipSecGroup');
    const flipSecsVisible = !!flipSecs && flipSecs.getClientRects().length > 0;
    const text = plain || visibleText('.widget-flip') || '';
    return {
        text,
        // Секунды видны, если их показывает активный стиль: либо узел
        // .clock-seconds отрисован, либо видна группа флип-карточек секунд.
        secondsVisible: (() => {
            const node = document.querySelector('.clock-seconds');
            if (node && node.getClientRects().length > 0) { return true; }
            return flipSecsVisible;
        })(),
        hasAmPm: /\b(AM|PM)\b/i.test(text)
    };
}

// Приводит тумблер к нужному состоянию ЧЕРЕЗ UI (клик по подписи).
// Нужен потому, что localStorage переживает перезапуск приложения: тест,
// оставивший галочку включённой, ломал бы следующий запуск самого себя.
async function setToggle(control, id, want) {
    const current = await control.evaluate((elId) => {
        const el = document.getElementById(elId);
        return el ? el.checked : null;
    }, id);
    if (current !== want) {
        await control.click(`label[for="${id}"]`);
        await control.waitForTimeout(400);
    }
}

test('справка раскрывает ответы по клику и по клавиатуре', async () => {
    const { app, control } = await launchApp();

    await control.click('#faqBtn');
    await control.waitForTimeout(400);

    const first = control.locator('.faq-question').first();
    const answer = control.locator('.faq-answer').first();

    // До клика ответ скрыт — это правильное поведение аккордеона.
    await expect(answer).toBeHidden();
    await expect(first).toHaveAttribute('aria-expanded', 'false');

    await first.click();
    await expect(answer).toBeVisible();
    await expect(first).toHaveAttribute('aria-expanded', 'true');

    // Ответ не обрезан. Прежняя схема ограничивала его max-height: 500px, и
    // обрезка была бы незаметной: overflow: hidden прячет и полосу прокрутки.
    const height = await answer.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(height, 'ответ справки обрезан по высоте').toBe(0);

    // Повторный клик по тому же вопросу закрывает.
    await first.click();
    await expect(answer).toBeHidden();
    await expect(first).toHaveAttribute('aria-expanded', 'false');

    // Клавиатура: вопрос — настоящая <button>, значит фокусируется и жмётся Enter.
    // До этого он был <div> — Tab проходил мимо, Enter не делал ничего.
    const second = control.locator('.faq-question').nth(1);
    const secondAnswer = control.locator('.faq-answer').nth(1);
    await second.focus();
    await expect(second, 'вопрос справки должен получать фокус').toBeFocused();
    await control.keyboard.press('Enter');
    await expect(secondAnswer).toBeVisible();
    await expect(second).toHaveAttribute('aria-expanded', 'true');

    // Аккордеон ЭКСКЛЮЗИВНЫЙ: открытие соседа в той же секции закрывает
    // предыдущий — и его aria-expanded обязан сброситься, иначе для скринридера
    // открытыми окажутся оба.
    await first.click();
    await expect(answer).toBeVisible();
    await expect(secondAnswer).toBeHidden();
    await expect(second).toHaveAttribute('aria-expanded', 'false');

    await app.close();
});

test('вернувшиеся переключатели часов меняют окно часов', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
    await control.waitForTimeout(2000);
    const clock = await findClock(app);
    expect(clock, 'окно часов не найдено').not.toBeNull();

    // Открываем вкладку «Часы» — настройки живут в выдвижном ящике.
    await control.click('.tab-btn[data-tab="clock"]');
    await control.waitForTimeout(600);

    // Все четыре вернувшихся контрола обязаны быть ДОСТИЖИМЫ. Проверяем видимую
    // поверхность — подпись и ползунок тумблера: сам <input type="checkbox"> у
    // этого стиля переключателя намеренно скрыт (opacity: 0, нулевой размер),
    // кликают по нему через <label>. Раньше скрыт был весь БЛОК, вместе с
    // подписью, и дотянуться было нельзя ничем.
    for (const id of ['syncClockStyle', 'clockShowSeconds', 'clockFormat24h', 'clockShowTimezone']) {
        await expect(control.locator(`label[for="${id}"]`), `подпись ${id} не видна`).toBeVisible();
        await expect(control.locator(`#${id} + .toggle-slider`), `тумблер ${id} не виден`).toBeVisible();
        // Инпут существует и не спрятан целым блоком: display:none у родителя
        // убрал бы и ползунок выше, но проверим прямо — именно это и было дефектом.
        const hiddenByBlock = await control.evaluate((elId) => {
            const el = document.getElementById(elId);
            return !el || el.offsetParent === null;
        }, id);
        expect(hiddenByBlock, `${id} спрятан через display:none у родителя`).toBe(false);
    }

    // Стиль часов тоже переживает перезапуск, а формат AM/PM у флип-часов
    // намеренно не показывается (нет ячейки) — фиксируем круговой стиль, иначе
    // проверять 12-часовой формат было бы нечем.
    await control.click('#clockStyle button[data-val="circle"]');
    await control.waitForTimeout(900);

    // Проверяем ИЗМЕНЕНИЕ, а не абсолютные значения: настройки живут в
    // localStorage и переживают перезапуск приложения, поэтому «по умолчанию
    // секунды включены» — не то, на что тест имеет право опираться. Утверждение
    // теста ровно одно: клик по подписи меняет картинку в окне часов.
    const before = await clock.evaluate(probeClock);

    await control.click('label[for="clockShowSeconds"]');
    await control.waitForTimeout(900);
    const afterSeconds = await clock.evaluate(probeClock);
    expect(
        afterSeconds.secondsVisible,
        'переключатель секунд не изменил окно часов'
    ).toBe(!before.secondsVisible);

    await control.click('label[for="clockFormat24h"]');
    await control.waitForTimeout(900);
    const afterFormat = await clock.evaluate(probeClock);
    expect(
        afterFormat.hasAmPm,
        'переключатель 24-часового формата не изменил окно часов'
    ).toBe(!before.hasAmPm);

    // Возвращаем обратно — переключатели двусторонние, и состояние восстановимо.
    await control.click('label[for="clockShowSeconds"]');
    await control.click('label[for="clockFormat24h"]');
    await control.waitForTimeout(900);
    const restored = await clock.evaluate(probeClock);
    expect(restored.secondsVisible, 'секунды не вернулись в исходное состояние').toBe(before.secondsVisible);
    expect(restored.hasAmPm, 'формат не вернулся в исходное состояние').toBe(before.hasAmPm);

    await app.close();
});

test('«Как у виджета» переводит выбор стиля часов на виджет и сохраняется', async () => {
    const { app, control } = await launchApp();

    await control.click('.tab-btn[data-tab="clock"]');
    await control.waitForTimeout(600);

    // Синхронизация могла остаться включённой от прошлого прогона.
    await setToggle(control, 'syncClockStyle', false);

    const row = control.locator('#clockStyleRow');
    await expect(row, 'строка выбора стиля часов должна быть видна, пока синхронизация выключена').toBeVisible();

    await control.click('label[for="syncClockStyle"]');
    await control.waitForTimeout(500);
    // Строка НЕ прячется: она — единственное место, где виден стиль часов, и
    // при включённой синхронизации показывает действующий, то есть стиль
    // виджета. Прятать её значило убирать ответ на вопрос «почему часы поехали».
    await expect(row, 'строка выбора стиля часов остаётся видимой').toBeVisible();
    const mirrored = await control.evaluate(() => ({
        clock: document.getElementById('clockStyle').value,
        widget: document.getElementById('timerStyle').value
    }));
    expect(mirrored.clock, 'под синхронизацией показан стиль виджета').toBe(mirrored.widget);

    // Настройка обязана дожить до перезагрузки: раньше loadSettings() её убивала,
    // потому что присваивание .value самодельному сегментированному контролу
    // порождало change, а обработчик стиля гасил галочку.
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(1500);
    const saved = await control.evaluate(
        () => JSON.parse(localStorage.getItem('displayExtSettings') || '{}').syncClockStyle
    );
    expect(saved, 'синхронизация не сохранилась').toBe(true);

    // Возвращаем как было: настройка общая для всех спеков через localStorage.
    // Ящик после перезагрузки закрыт — сначала открываем вкладку, иначе клик по
    // скрытой подписи будет ждать до таймаута.
    await control.click('.tab-btn[data-tab="clock"]');
    await control.waitForTimeout(600);
    await setToggle(control, 'syncClockStyle', false);

    await app.close();
});

/**
 * Состояние «окно открыто» читается формой, а не только цветом.
 *
 * Раньше открытое окно помечалось заливкой кнопки акцентом плюс зелёной
 * точкой. В светлой теме заливка была синей, а точка зелёной — и оба токена в
 * этой теме тёмные: 1.03:1, индикатора не существовало. Замер живёт в
 * tests/contrast.test.js; здесь проверяется, что признак состояния вообще
 * доезжает до кнопки при настоящем клике.
 */
test('открытое окно помечено формой, а не только цветом', async () => {
    const { app, control } = await launchApp();
    try {
        const probe = () => {
            const btn = document.getElementById('openWidgetBtn');
            const knob = btn.querySelector('.wrow-knob');
            return {
                active: btn.classList.contains('active'),
                checked: btn.getAttribute('aria-checked'),
                // Форма состояния после редизайна 2026-08-12 — ПОЛОЖЕНИЕ ручки
                // тумблера. Раньше ей была inset-тень плитки; тумблер сильнее:
                // сдвиг ручки виден и в чёрно-белом, и мимо любой темы.
                knob: knob ? getComputedStyle(knob).transform : null
            };
        };

        const before = await control.evaluate(probe);
        expect(before.active, 'виджет уже открыт — профиль не вернули в исходное').toBe(false);

        await control.click('#openWidgetBtn');
        await control.waitForTimeout(800);

        const after = await control.evaluate(probe);
        expect(after.active).toBe(true);
        // Форма, а не только цвет: ручка тумблера сдвинута, и состояние
        // объявлено скринридеру.
        expect(after.checked).toBe('true');
        expect(before.checked).toBe('false');
        expect(after.knob, `положение ручки: ${after.knob}`).not.toBe(before.knob);
        expect(after.knob).not.toBe('none');

        // Профиль e2e общий: тест, меняющий глобальное состояние, обязан его
        // вернуть, иначе следующий спек стартует с открытым виджетом.
        await control.click('#openWidgetBtn');
        await control.waitForTimeout(500);
    } finally {
        await app.close();
    }
});
