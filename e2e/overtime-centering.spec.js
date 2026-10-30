const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForWidget, waitForDisplaySnapshot, waitForDisplaySettled, waitForWidgetSnapshot,
    waitForWindowSettled, armReceived, waitForPanelRemaining, panelRoundTrip, waitForQuiet
} = require('./window-ready');

/** Окно показывает время со знаком минуса (или без него) и утихло. */
async function waitForSign(page, minus) {
    await page.waitForFunction((want) => {
        const t = document.querySelector('#timeDisplay, #controlTime');
        return !!t && /[−-]/.test(t.textContent) === want;
    }, minus, { timeout: 10000 }).catch(() => console.log(`   окно не показало ${minus ? 'минус' : 'время без минуса'} за 10 с`));
    await waitForQuiet(page);
}

/**
 * Центровка времени в перерасходе: по центру стоят ЦИФРЫ.
 *
 * Пользователь сообщил, что минус и цифры смотрятся не по центру — в панели и в
 * круговом стиле. Замер подтвердил: цифры уезжали от центральной оси на +26px в
 * панели, +16.1px в виджете и +54.2px на полноэкранном дисплее.
 *
 * Раньше в проекте было принято обратное решение — «центрируем всю надпись», знак
 * участвует в раскладке. Оно опиралось на верную мысль (нельзя центрировать
 * одновременно и цифры, и надпись — разница ровно в половину знака), но выбирало
 * не ту опору: у панели центральная ось общая с плашкой статуса и кнопками, а в
 * круговом стиле точкой отсчёта для глаза служит ЦЕНТР КОЛЬЦА. Сдвиг цифр внутри
 * круга читается как поломка, и на проекторе 54px видно сразу.
 *
 * Теперь контейнер сжимается по содержимому и центрируется, поэтому его левый край
 * совпадает с левым краем цифр, а знак позиционируется от него абсолютно и ширины
 * не занимает. Минус при этом остаётся ВНУТРИ кольца (замерено: запас 33.6px у
 * виджета, 49.7px у дисплея), то есть «висящим отдельно» не выглядит.
 *
 * Тест меряет обе величины и ТРЕБУЕТ, чтобы по центру были цифры.
 */

const MARKERS = {
    widget: () => !!document.getElementById('wFlipHoursGroup'),
    display: () => !!document.getElementById('flipHoursUnit')
};

async function findWindow(app, kind) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(MARKERS[kind]).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Возвращает центры: контейнера, всей надписи и только цифр.
function measure(sel) {
    const round = (v) => Math.round(v * 10) / 10;
    const box = document.querySelector(sel.container);
    if (!box) { return { error: `нет ${sel.container}` }; }
    const boxRect = box.getBoundingClientRect();
    const boxCenter = boxRect.left + boxRect.width / 2;

    // Точка отсчёта: либо кольцо прогресса (если задано), либо сам контейнер.
    let refCenter = boxCenter;
    let refName = 'контейнер';
    if (sel.ring) {
        const ring = document.querySelector(sel.ring);
        if (ring) {
            const r = ring.getBoundingClientRect();
            refCenter = r.left + r.width / 2;
            refName = 'кольцо';
        }
    }

    // Надпись целиком: объединяем прямоугольники всех дочерних узлов с текстом.
    const range = document.createRange();
    range.selectNodeContents(box);
    const whole = range.getBoundingClientRect();
    range.detach && range.detach();

    // Только цифры.
    let digitsRect = null;
    if (sel.digits) {
        const d = document.querySelector(sel.digits);
        if (d) { digitsRect = d.getBoundingClientRect(); }
    } else if (sel.digitsTextAfter) {
        // Цифры лежат текстовым узлом после span со знаком — обводим его Range-ом.
        const signEl = document.querySelector(sel.digitsTextAfter);
        if (signEl && signEl.nextSibling) {
            const r2 = document.createRange();
            r2.selectNodeContents(box);
            r2.setStartAfter(signEl);
            digitsRect = r2.getBoundingClientRect();
            r2.detach && r2.detach();
        }
    }

    const signEl = sel.sign ? document.querySelector(sel.sign) : null;
    const signRect = signEl ? signEl.getBoundingClientRect() : null;

    const ringEl = sel.ring ? document.querySelector(sel.ring) : null;
    const ringRect = ringEl ? ringEl.getBoundingClientRect() : null;
    // Если цифры центрировать по кольцу, знак уедет влево на свою ширину.
    // Считаем, влезет ли он внутрь кольца.
    let запасДоКольца = null;
    if (ringRect && digitsRect && signRect) {
        const digitsLeftIfCentered = refCenter - digitsRect.width / 2;
        const signLeftIfCentered = digitsLeftIfCentered - signRect.width;
        запасДоКольца = round(signLeftIfCentered - ringRect.left);
    }
    return {
        точкаОтсчёта: refName,
        текст: box.textContent.trim(),
        ширинаЗнака: signRect ? round(signRect.width) : null,
        ширинаЦифр: digitsRect ? round(digitsRect.width) : null,
        ширинаКольца: ringRect ? round(ringRect.width) : null,
        dxИнскрипция: round((whole.left + whole.width / 2) - refCenter),
        dxЦифры: digitsRect ? round((digitsRect.left + digitsRect.width / 2) - refCenter) : null,
        // Вертикаль: середина знака против середины цифр. Знак меньше кеглем, и
        // если привязать его к верхнему краю, он читается надстрочным.
        dyЗнака: (signRect && digitsRect)
            ? round((signRect.top + signRect.height / 2) - (digitsRect.top + digitsRect.height / 2))
            : null,
        запасДоКольца
    };
}

const TARGETS = {
    'панель управления': {
        container: '#controlTime',
        sign: '#controlTimeSign',
        digits: '#controlTimeDigits'
    },
    'виджет, круг': {
        container: '#timeDisplay',
        ring: '.progress-ring, svg',
        sign: '#timeDisplaySign',
        digits: '#timeDisplayDigits'
    },
    'дисплей, круг': {
        container: '#timeDisplay',
        ring: '#progressRing',
        sign: '.time-minus',
        digitsTextAfter: '.time-minus'
    }
};

test('замер центровки времени в перерасходе', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-display');
    });
    // Оба окна получили снимок main и ВСТАЛИ — было 2500 мс.
    await waitForDisplaySettled(app, await waitForDisplaySnapshot(app, await waitForDisplay(app)));
    await waitForWindowSettled(app, await waitForWidgetSnapshot(app, await waitForWidget(app)), 'electron-widget.html');

    const widget = await findWindow(app, 'widget');
    const display = await findWindow(app, 'display');

    // Круглый стиль в обоих окнах — именно про него речь. Ждём, что оба
    // стиля ДОШЛИ до окон (было 800 мс); виджет после стиля ещё и встаёт.
    const widgetStyle = await armReceived(widget, 'widget-style-update');
    const displayStyle = await armReceived(display, 'display-settings-update');
    await control.evaluate(() => {
        const seg = document.querySelector('#timerStyle button[data-val="circle"]');
        if (seg) { seg.click(); }
        const dseg = document.querySelector('#displayTimerStyle button[data-val="circle"]');
        if (dseg) { dseg.click(); }
    });
    await widgetStyle({ match: { timerStyle: 'circle' } });
    await displayStyle({ match: { displayTimerStyle: 'circle' } });
    await waitForWindowSettled(app, widget, 'electron-widget.html');

    // Уводим таймер в перерасход: 5 минут, разрешить минус, поставить −47 с.
    await control.evaluate(() => {
        const neg = document.getElementById('allowNegative');
        neg.checked = true;
        neg.dispatchEvent(new Event('change', { bubbles: true }));
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: 300 });
        window.ipcRenderer.send('timer-command', { type: 'adjust', deltaSeconds: -347 });
        window.ipcRenderer.send('timer-command', { type: 'start' });
    });
    // Отсчёт идёт и уже в минусе (было 1500 мс — до −48 с); все три окна
    // показали минус и утихли. Окна получают состояние своими трубами,
    // поэтому признак — их собственный текст.
    await waitForPanelRemaining(control, -48);
    for (const page of [control, widget, display]) { await waitForSign(page, true); }

    const rows = [];
    rows.push(['панель управления', await control.evaluate(measure, TARGETS['панель управления'])]);
    if (widget) { rows.push(['виджет, круг', await widget.evaluate(measure, TARGETS['виджет, круг'])]); }
    if (display) { rows.push(['дисплей, круг', await display.evaluate(measure, TARGETS['дисплей, круг'])]); }

    console.log('\n=== ПЕРЕРАСХОД ===');
    for (const [name, m] of rows) {
        console.log(`${name}: ${JSON.stringify(m, null, 0)}`);
    }

    // Допуск 1.5px: субпиксельный рендеринг и tabular-nums дают дробные значения.
    const TOL = 1.5;
    for (const [name, m] of rows) {
        expect(m.error, `${name}: ${m.error}`).toBeUndefined();
        expect(
            Math.abs(m.dxЦифры),
            `${name}: цифры смещены от ${m.точкаОтсчёта} на ${m.dxЦифры}px — `
            + 'в перерасходе по центру должны стоять именно цифры'
        ).toBeLessThanOrEqual(TOL);
        // Знак обязан быть ВНЕ потока: иначе он и есть источник сдвига.
        expect(
            Math.abs(m.dxИнскрипция),
            `${name}: надпись центрирована (dx=${m.dxИнскрипция}) — значит знак снова `
            + 'занимает место в раскладке и толкает цифры'
        ).toBeGreaterThan(TOL);
        // И остаётся внутри кольца, где кольцо есть.
        // Знак обязан стоять по средней линии цифр. Допуск 0.08 от высоты цифр:
        // визуально это уже неразличимо, а жёстче мешает разница метрик шрифта.
        if (m.dyЗнака !== null) {
            expect(
                Math.abs(m.dyЗнака),
                `${name}: знак смещён по вертикали на ${m.dyЗнака}px относительно середины цифр`
            ).toBeLessThanOrEqual(0.08 * (m.ширинаЦифр / 5) * 1.6);
        }
        if (m.запасДоКольца !== null) {
            expect(
                m.запасДоКольца,
                `${name}: минус вылезает за обводку кольца (запас ${m.запасДоКольца}px)`
            ).toBeGreaterThan(0);
        }
    }

    // Для сравнения — то же в обычном режиме, где знака нет. Сначала СБРОС:
    // `set` при идущем таймере — no-op (timer-controller.js, setPreset), и
    // до 31.10.2026 этот раздел печатал тот же перерасход (−01:18) под
    // заголовком «обычный режим». Вскрылось, когда пауза стала условием
    // «минуса нет».
    await control.evaluate(() => {
        window.ipcRenderer.send('timer-command', { type: 'reset' });
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: 300 });
    });
    // Команда обработана и окна показали время без минуса — было 1200 мс.
    await panelRoundTrip(control);
    for (const page of [control, widget, display]) { await waitForSign(page, false); }

    console.log('\n=== ОБЫЧНЫЙ РЕЖИМ (для сравнения) ===');
    console.log(`панель управления: ${JSON.stringify(await control.evaluate(measure, TARGETS['панель управления']))}`);
    if (widget) {
        console.log(`виджет, круг: ${JSON.stringify(await widget.evaluate(measure, TARGETS['виджет, круг']))}`);
    }
    if (display) {
        console.log(`дисплей, круг: ${JSON.stringify(await display.evaluate(measure, TARGETS['дисплей, круг']))}`);
    }

    // Возвращаем «Считать ниже нуля» выключенным: настройка живёт в localStorage и
    // переживает перезапуск, а другие спеки ожидают, что строка лимита скрыта.
    // Забыл в первой версии — уронил e2e/status-and-colors.spec.js через состояние.
    await control.evaluate(() => {
        const neg = document.getElementById('allowNegative');
        if (neg && neg.checked) {
            neg.checked = false;
            neg.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    // Запись хранилища синхронна; всё, что панель послала в main, main
    // обработал (было 500 мс).
    await panelRoundTrip(control);

    await app.close();
});
