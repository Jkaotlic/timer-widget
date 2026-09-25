'use strict';

/**
 * Сторож общего e2e-профиля: какой тест оставил в localStorage чужое — и
 * возврат профиля к тому, каким тест его получил.
 *
 * Профиль тестов ОДИН на прогон (e2e/launch.js), и тест, поменявший настройку
 * и не вернувший её, меняет условия всем следующим. Правило «вернул, что
 * поменял» было записано (docs/lessons.md, «The e2e profile is shared…»), но
 * держалось на `finally` каждой спеки: первый прогон сторожа (26.09.2026)
 * назвал 99 тестов из 263, а «Ежегодная конференция» была лишь самой заметной
 * утечкой. `finally` ломается тихо: убранный ключ дописывает обратно ещё
 * открытое окно, пропущенный — никто не замечает.
 *
 * Как устроено:
 *   - на ПЕРВОМ запуске в тесте снимается localStorage (все окна живут на
 *     одном origin app://timer-widget/, хранилище у них общее) — это «было»;
 *   - на КАЖДОМ `app.close()` (обёртка в launchApp) профиль сверяется с «было».
 *     Разница печатается с именем теста и ВОЗВРАЩАЕТСЯ: сначала закрывается
 *     дисплей (он дописывает места карточек из памяти на каждом изменении
 *     размера, в том числе при выходе из полноэкранного), потом «было»
 *     записывается обратно, и сверка повторяется. Чистый тест идёт своим
 *     обычным путём выхода — окна ему никто не закрывает;
 *   - что вернуть НЕ удалось, пишется в журнал на диске под именем теста;
 *   - на первом запуске СЛЕДУЮЩЕГО теста «было» сверяется с последним
 *     «стало»: так видно дописанное окном уже на выходе и оставленное убитым
 *     приложением;
 *   - e2e/zz-profile-leaks.spec.js идёт ПОСЛЕДНИМ и падает списком «тест →
 *     поле: было → стало».
 *
 * Тест с перезапуском, которому настройка нужна во ВТОРОМ запуске, закрывает
 * первый с `launchApp({ keepProfile: true })`: возврат идёт на последнем
 * закрытии, «было» — от первого запуска теста.
 *
 * Журнал — файл, а не память модуля: воркер Playwright перезапускается после
 * упавшего теста, и память пропала бы вместе с ним.
 *
 * Сравнение (`diffProfiles`) ЧИСТОЕ — его проверяет
 * tests/e2e-profile-guard.test.js на подставных снимках, в том числе на то,
 * что утечку оно ВИДИТ (иначе зелёный значил бы и «чисто», и «сравнение
 * сломано»).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const SettingsSchema = require('../settings-schema.js');
const ClockSettingsSchema = require('../clock-settings-schema.js');
const UITheme = require('../ui-theme.js');

const LEDGER = path.join(os.tmpdir(), 'timer-widget-e2e-profile-leaks.json');

/**
 * Ключи, которые пишет само ПРИЛОЖЕНИЕ, а не тест, — каждый с причиной.
 * Вернуть их тест не может и не должен.
 */
const VOLATILE_KEYS = Object.freeze({
    // Однократные подсказки: окно ставит флаг при первом открытии за профиль.
    onboardingShown: 'флаг первого запуска, ставит панель',
    widgetHintShown: 'подсказка при первом открытии виджета',
    clockHintShown: 'подсказка при первом открытии часов',
    displayHintShown: 'подсказка при первом открытии дисплея',
    // Геометрию окна пишет модуль геометрии на КАЖДОМ resize/move — и при
    // открытии окна, и от раскладки ОС; это не настройка теста.
    widgetGeometry: 'размер и место виджета, пишет window-geometry.js',
    clockGeometry: 'размер и место часов, пишет window-geometry.js'
});

/**
 * Поля-ПРОИЗВОДНЫЕ внутри значения ключа. Место карточки — доля окна для
 * центра (`cx`, `cy`); `left`/`top` — пиксели, которые дисплей пересчитывает
 * из долей при каждой раскладке и под каждый размер окна. Их смена — не
 * настройка, а тот же вид на другом окне.
 */
const DERIVED = Object.freeze({
    displayBlockPositions: (v) => {
        const out = {};
        for (const [id, p] of Object.entries(v || {})) {
            out[id] = p && typeof p === 'object' ? { cx: p.cx, cy: p.cy } : p;
        }
        return out;
    }
});

/**
 * Умолчания: поле, появившееся со значением ПО УМОЛЧАНИЮ (или исчезнувшее с
 * ним), профиль не меняет — приложение читает отсутствие как умолчание.
 * Окна дописывают поля в хранилище лениво, при первой записи, и без этого
 * правила виноватым был бы первый тест, открывший окно.
 *
 * Источник — таблицы настроек, а не копия чисел; своё здесь только то, чего в
 * таблицах нет, с владельцем в комментарии.
 */
const schemaDefaults = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.def]));
const FIELD_DEFAULTS = Object.freeze({
    displayExtSettings: schemaDefaults(SettingsSchema.SETTINGS_DESCRIPTORS),
    clockWidgetSettings: Object.assign(schemaDefaults(ClockSettingsSchema.CLOCK_SETTINGS), {
        clockStyle: 'circle', // clock-widget-app.js: круговые — стиль по умолчанию
        opacity: 1            // clock-widget-app.js: непрозрачность по умолчанию
    })
});
const KEY_DEFAULTS = Object.freeze({
    uiTheme: UITheme.UI_THEME_DEFAULT,
    uiLocked: '0',            // ui-lock.js: '1' | '0', умолчание — не закреплено
    soundEnabled: 'true',     // панель: звук включён
    clockShowTicks: 'false',  // деления циферблата выключены
    displayTimerScale: '100'  // масштаб таймера дисплея, %
});

const MAX_VALUE = 80;

function short(value, asJson = false) {
    if (value === undefined) { return '∅'; }
    const text = typeof value === 'string' && !asJson ? value : JSON.stringify(value);
    return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…(${text.length})` : text;
}

function asObject(raw) {
    if (typeof raw !== 'string' || raw[0] !== '{') { return null; }
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
        return null;
    }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Разница двух снимков localStorage списком строк «ключ[.поле]: было → стало».
 * JSON-объекты сравниваются ПО ПОЛЯМ: в `displayExtSettings` десятки полей, и
 * «ключ изменился» не сказал бы, что именно оставили. Отсутствующий
 * JSON-ключ равен пустому объекту.
 *
 * @param {Record<string,string>} before
 * @param {Record<string,string>} after
 * @returns {string[]}
 */
function diffProfiles(before, after) {
    const out = [];
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const key of [...keys].sort()) {
        if (Object.prototype.hasOwnProperty.call(VOLATILE_KEYS, key)) { continue; }
        const a = before ? before[key] : undefined;
        const b = after ? after[key] : undefined;
        if (a === b) { continue; }
        let oa = asObject(a);
        let ob = asObject(b);
        if ((oa || a === undefined) && (ob || b === undefined) && (oa || ob)) {
            const derive = DERIVED[key] || ((v) => v);
            oa = derive(oa || {});
            ob = derive(ob || {});
            const defaults = FIELD_DEFAULTS[key] || {};
            const fields = new Set([...Object.keys(oa), ...Object.keys(ob)]);
            for (const f of [...fields].sort()) {
                const hasDef = Object.prototype.hasOwnProperty.call(defaults, f);
                const va = f in oa ? oa[f] : (hasDef ? defaults[f] : undefined);
                const vb = f in ob ? ob[f] : (hasDef ? defaults[f] : undefined);
                if (!same(va, vb)) {
                    out.push(`${key}.${f}: ${short(oa[f], true)} → ${short(ob[f], true)}`);
                }
            }
            continue;
        }
        const hasDef = Object.prototype.hasOwnProperty.call(KEY_DEFAULTS, key);
        const va = a === undefined && hasDef ? KEY_DEFAULTS[key] : a;
        const vb = b === undefined && hasDef ? KEY_DEFAULTS[key] : b;
        if (va === vb) { continue; }
        out.push(`${key}: ${short(a)} → ${short(b)}`);
    }
    return out;
}

function readLedger() {
    try {
        const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
        ledger.leaks = ledger.leaks || {};
        ledger.restored = ledger.restored || {};
        return ledger;
    } catch {
        return { leaks: {}, restored: {} };
    }
}

function writeLedger(ledger) {
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
}

function resetLedger() {
    fs.rmSync(LEDGER, { force: true });
}

/** Имя текущего теста «файл › describe › тест» или null вне теста. */
function currentTest() {
    try {
        const { test } = require('@playwright/test');
        const info = test.info();
        const file = path.basename(info.file);
        const titles = info.titlePath.filter((t) => t && t !== file && !t.endsWith(info.file));
        return { id: info.testId, name: `${file} › ${titles.join(' › ')}` };
    } catch {
        return null;
    }
}

const appPages = (app) => app.windows().filter((w) => {
    try { return w.url().startsWith('app://timer-widget/') && !w.isClosed(); } catch { return false; }
});
const controlPage = (app) => appPages(app).find((w) => w.url().includes('electron-control.html')) || null;

/** localStorage приложения — из любого живого окна на app://timer-widget/. */
async function snapshot(app) {
    const page = controlPage(app) || appPages(app)[0];
    if (!page) { return null; }
    return page.evaluate(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            out[k] = localStorage.getItem(k);
        }
        return out;
    });
}

/**
 * Вернуть профиль к «было». Изменчивые ключи не трогаются: их владелец —
 * приложение. Возвращает профиль после возврата.
 */
async function restore(app, baseline) {
    const control = controlPage(app);
    if (!control) { return snapshot(app); }
    // Дисплей держит места карточек в памяти и пишет их на каждом изменении
    // размера — запись поверх открытого дисплея он бы перетёр на выходе.
    const { waitForDisplayGone } = require('./window-ready');
    await control.evaluate(() => window.ipcRenderer.send('close-display')).catch(() => {});
    await waitForDisplayGone(app, { timeout: 10000 }).catch(() => {});
    let after = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        await control.evaluate(([base, volatile]) => {
            const keep = new Set(volatile);
            for (const k of Object.keys(localStorage)) {
                if (!keep.has(k) && !(k in base)) { localStorage.removeItem(k); }
            }
            for (const [k, v] of Object.entries(base)) {
                if (!keep.has(k) && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); }
            }
        }, [baseline, Object.keys(VOLATILE_KEYS)]);
        // Отложенная запись панели (debounce) могла быть в пути: сверяем ещё
        // раз через паузу и повторяем, пока не устоится.
        await new Promise((r) => setTimeout(r, 400));
        after = await snapshot(app);
        if (after && diffProfiles(baseline, after).length === 0) { break; }
    }
    return after;
}

const baselines = new Map();

/**
 * Подключить сторож к запущенному приложению: снять «было» на первом запуске
 * теста и обернуть `app.close()` сверкой и возвратом.
 *
 * @param {object} app
 * @param {{keepProfile?: boolean}} [opts] — не возвращать на ЭТОМ закрытии
 */
async function watch(app, opts = {}) {
    const owner = currentTest();
    if (!owner) { return; }
    if (!baselines.has(owner.id)) {
        const snap = await snapshot(app).catch(() => null);
        if (snap) {
            baselines.set(owner.id, snap);
            // Дрейф МЕЖДУ тестами: что поменялось после последнего закрытия,
            // которое видел сторож. Сюда попадает то, что окно дописало уже
            // на выходе (beforeunload), и то, что оставило убитое, а не
            // закрытое приложение, — на закрытии этого не увидеть.
            const ledger = readLedger();
            if (ledger.lastClose && ledger.lastClose.name !== owner.name) {
                const drift = diffProfiles(ledger.lastClose.snap, snap);
                const key = `${ledger.lastClose.name} (после закрытия, увидено при запуске ${owner.name})`;
                if (drift.length) {
                    ledger.leaks[key] = drift;
                    console.warn(`[profile-guard] ${key}:\n  ${drift.join('\n  ')}`);
                    writeLedger(ledger);
                }
            }
        }
    }
    const close = app.close.bind(app);
    app.close = async () => {
        try {
            const before = baselines.get(owner.id);
            let after = before ? await snapshot(app) : null;
            if (before && after) {
                const ledger = readLedger();
                const changed = diffProfiles(before, after);
                if (changed.length && !opts.keepProfile) {
                    console.warn(`[profile-guard] ${owner.name} оставил в профиле — возвращаю:\n  ${changed.join('\n  ')}`);
                    ledger.restored[owner.name] = changed;
                    after = (await restore(app, before)) || after;
                }
                const leaks = opts.keepProfile ? [] : diffProfiles(before, after);
                if (leaks.length) {
                    ledger.leaks[owner.name] = leaks;
                    console.warn(`[profile-guard] ${owner.name}: вернуть не удалось:\n  ${leaks.join('\n  ')}`);
                } else {
                    delete ledger.leaks[owner.name];
                }
                ledger.lastClose = { name: owner.name, snap: after };
                writeLedger(ledger);
            }
        } catch (e) {
            // Сторож не имеет права ронять закрытие: окно могло уже уйти.
            console.warn(`[profile-guard] сверка на закрытии не удалась: ${e && e.message}`);
        }
        return close();
    };
}

module.exports = {
    diffProfiles, watch, readLedger, resetLedger, snapshot,
    VOLATILE_KEYS, DERIVED, FIELD_DEFAULTS, KEY_DEFAULTS, LEDGER
};
