'use strict';

/**
 * Сторож общего e2e-профиля (e2e/profile-guard.js): сравнение снимков
 * localStorage. Проверяется и то, что утечку он ВИДИТ, — сторож, который
 * молчит всегда, выглядел бы ровно как чистый прогон.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const setup = require('../e2e/global-setup');
const { RUN_PROFILE_ENV, getUserDataDir } = require('../e2e/run-profile');
const { diffProfiles, readLedger, VOLATILE_KEYS, KEY_DEFAULTS } = require('../e2e/profile-guard');

test('оставленное название мероприятия видно ПО ПОЛЮ, а не «ключ изменился»', () => {
    const before = { displayExtSettings: JSON.stringify({ eventTitle: '', endTime: '12:00' }) };
    const after = { displayExtSettings: JSON.stringify({ eventTitle: 'Ежегодная конференция', endTime: '12:00' }) };
    assert.deepEqual(diffProfiles(before, after), ['displayExtSettings.eventTitle: "" → "Ежегодная конференция"']);
});

test('новый и исчезнувший ключ — тоже утечка', () => {
    assert.deepEqual(diffProfiles({}, { uiLocked: '1' }), ['uiLocked: ∅ → 1']);
    assert.deepEqual(diffProfiles({ uiTheme: 'dark' }, {}), ['uiTheme: dark → ∅']);
    assert.deepEqual(diffProfiles({}, { uiPresetActive: '3' }), ['uiPresetActive: ∅ → 3']);
});

test('поле, появившееся со значением ПО УМОЛЧАНИЮ, профиль не меняет; не по умолчанию — меняет', () => {
    // Окна дописывают поля лениво: без этого правила виноват был бы первый
    // тест, открывший окно часов.
    assert.deepEqual(diffProfiles({}, { clockWidgetSettings: JSON.stringify({ clockStyle: 'circle', opacity: 1 }) }), []);
    assert.deepEqual(diffProfiles({}, { clockWidgetSettings: JSON.stringify({ clockStyle: 'flip' }) }),
        ['clockWidgetSettings.clockStyle: ∅ → "flip"']);
    assert.deepEqual(diffProfiles({ displayExtSettings: '{}' }, { displayExtSettings: JSON.stringify({ eventTitle: '' }) }), []);
    assert.deepEqual(diffProfiles({}, { uiTheme: KEY_DEFAULTS.uiTheme, displayTimerScale: '100' }), []);
    assert.deepEqual(diffProfiles({}, { displayTimerScale: '88' }), ['displayTimerScale: ∅ → 88']);
    // Пустой объект цветов — то же, что его отсутствие.
    assert.deepEqual(diffProfiles({}, { widgetColors: '{}' }), []);
});

test('место карточки — доли центра; пиксели left/top — производные и не считаются', () => {
    const at = (left, cx) => JSON.stringify({ heroLabel: { left, top: 10, cx, cy: 0.3 } });
    assert.deepEqual(diffProfiles({ displayBlockPositions: at(100, 0.4) }, { displayBlockPositions: at(140, 0.4) }), []);
    assert.deepEqual(diffProfiles({ displayBlockPositions: at(100, 0.4) }, { displayBlockPositions: at(100, 0.5) }),
        ['displayBlockPositions.heroLabel: {"cx":0.4,"cy":0.3} → {"cx":0.5,"cy":0.3}']);
});

test('возвращённый профиль — чисто, даже если порядок полей другой', () => {
    const a = { displayExtSettings: JSON.stringify({ a: 1, b: 2 }), uiTheme: 'dark' };
    const b = { uiTheme: 'dark', displayExtSettings: JSON.stringify({ b: 2, a: 1 }) };
    assert.deepEqual(diffProfiles(a, b), []);
});

test('ключи, которые пишет само приложение, не считаются — и у каждого есть причина', () => {
    for (const [key, why] of Object.entries(VOLATILE_KEYS)) {
        assert.ok(typeof why === 'string' && why.length > 5, `у изменчивого ключа ${key} нет причины`);
        assert.deepEqual(diffProfiles({ [key]: 'a' }, { [key]: 'b' }), [], key);
    }
});

test('изменчивые ключи — настоящие ключи хранилища приложения, а не опечатки', () => {
    // Опечатка в списке исключений молча ничего не исключила бы — или, хуже,
    // исключила бы то, чего не собирались.
    const CONFIG = require('../constants');
    const known = new Set(Object.values(CONFIG.STORAGE_KEYS));
    for (const key of Object.keys(VOLATILE_KEYS)) {
        assert.ok(known.has(key), `${key} нет в CONFIG.STORAGE_KEYS`);
    }
});

test('launchApp подключает сторож, а сводная спека идёт последней', () => {
    const e2e = path.join(__dirname, '..', 'e2e');
    const launch = fs.readFileSync(path.join(e2e, 'launch.js'), 'utf8');
    assert.match(launch, /profileGuard\.watch\(app\b/, 'launchApp не подключает сторож профиля');
    const specs = fs.readdirSync(e2e).filter((f) => f.endsWith('.spec.js')).sort();
    assert.equal(specs.at(-1), 'zz-profile-leaks.spec.js', 'сводная спека сторожа не последняя по алфавиту');
});

test('два прогона в одной временной папке получают свои профили и журналы', () => {
    const previous = process.env[RUN_PROFILE_ENV];
    const cleanupFirst = setup();
    const first = getUserDataDir();
    const firstLedger = { leaks: { example: ['тест не вернул профиль'] }, restored: {} };
    try {
        const firstMarker = path.join(first, 'last-state.json');
        fs.writeFileSync(firstMarker, 'saved');
        fs.writeFileSync(path.join(first, 'e2e-profile-leaks.json'), JSON.stringify(firstLedger));
        assert.deepEqual(readLedger(), firstLedger);

        const cleanupSecond = setup();
        const second = getUserDataDir();
        try {
            assert.notEqual(first, second, 'новый прогон открыл профиль первого');
            assert.ok(fs.existsSync(firstMarker), 'новый прогон стёр профиль первого');
            assert.deepEqual(readLedger(), { leaks: {}, restored: {} });
            const fromWorker = execFileSync(process.execPath, ['-e',
                "process.stdout.write(require('./e2e/run-profile.js').getUserDataDir())"
            ], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
            assert.equal(fromWorker, second, 'профиль не дошёл до воркера');
        } finally {
            cleanupSecond();
        }

        assert.ok(!fs.existsSync(second), 'второй прогон не удалил свой профиль');
        assert.ok(fs.existsSync(firstMarker), 'второй прогон удалил профиль первого');
        assert.deepEqual(readLedger(), firstLedger);
    } finally {
        cleanupFirst();
    }

    assert.ok(!fs.existsSync(first), 'первый прогон не удалил свой профиль');
    assert.equal(process.env[RUN_PROFILE_ENV], previous);
});
