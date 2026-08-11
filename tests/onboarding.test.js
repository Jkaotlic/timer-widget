'use strict';

/**
 * onboarding.js — поведенческие тесты на поддельных document/localStorage.
 *
 * Модуль сделан с внедрением зависимостей именно ради этого: обе его функции
 * трогают хранилище и DOM, а обе ошибки, которые в них возможны, тихие. Первая —
 * подсказка показывается не один раз, а каждый запуск (раздражает и выглядит
 * как поломка). Вторая — не показывается никогда (фича есть, увидеть её нельзя,
 * ни один тест этого не замечает). Ровно тот класс, про который в этом проекте
 * записано «зелёный тест не доказывает, что фича достижима».
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const Onboarding = require('../onboarding');

function fakeStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); }
    };
}

function fakeButton() {
    const handlers = [];
    return {
        handlers,
        addEventListener: (type, fn) => { handlers.push([type, fn]); },
        click: () => handlers.filter(([t]) => t === 'click').forEach(([, fn]) => fn())
    };
}

test('подсказка показывается при первом запуске', () => {
    const storage = fakeStorage();
    const seen = [];
    const shown = Onboarding.showFirstRunHint({
        storage,
        notify: (t) => seen.push(t),
        schedule: (fn) => fn()
    });
    assert.equal(shown, true);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /F1/, 'подсказка обязана называть клавишу');
});

test('во второй раз подсказка не показывается', () => {
    const storage = fakeStorage();
    const seen = [];
    const run = () => Onboarding.showFirstRunHint({
        storage, notify: (t) => seen.push(t), schedule: (fn) => fn()
    });
    run();
    const second = run();
    assert.equal(second, false);
    assert.equal(seen.length, 1, 'подсказка показалась дважды');
});

test('флаг ставится ДО показа, а не после', () => {
    // Если бы флаг ставился в колбэке, перезапуск в течение задержки показал бы
    // подсказку второй раз — то есть обещание «ровно один раз» ломалось бы
    // именно у тех, у кого приложение падает на старте. Проверяем, что к
    // моменту постановки задачи в очередь флаг уже записан: колбэк намеренно
    // НЕ вызываем.
    const storage = fakeStorage();
    let scheduled = null;
    Onboarding.showFirstRunHint({
        storage, notify: () => {}, schedule: (fn) => { scheduled = fn; }
    });
    assert.ok(scheduled, 'показ должен быть отложен, а не выполнен синхронно');
    assert.equal(storage.getItem('onboardingShown'), '1', 'флаг обязан стоять до показа');
});

test('сломанное хранилище не роняет приложение и не показывает подсказку', () => {
    // Приватный режим или переполнение квоты. Подсказка не критична: молча
    // пропускаем. Падение из-за неё было бы несоразмерным.
    const storage = {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); }
    };
    let notified = false;
    const shown = Onboarding.showFirstRunHint({
        storage, notify: () => { notified = true; }, schedule: (fn) => fn()
    });
    assert.equal(shown, false);
    assert.equal(notified, false, 'при неудачной записи флага показывать нельзя — иначе покажем каждый запуск');
});

test('ключ хранилища можно задать снаружи', () => {
    const storage = fakeStorage();
    Onboarding.showFirstRunHint({
        storage, notify: () => {}, schedule: (fn) => fn(), storageKey: 'ownKey'
    });
    assert.equal(storage.getItem('ownKey'), '1');
});

test('кнопка релизов шлёт канал БЕЗ payload', () => {
    // Это и есть граница безопасности: shell.openExternal с адресом из
    // рендерера означал бы выполнение произвольного URL руками ОС. Рендерер
    // может сказать «открой», но не «открой ЧТО».
    const button = fakeButton();
    const calls = [];
    const bound = Onboarding.bindReleasesLink({
        button,
        send: (...args) => calls.push(args),
        notify: () => {}
    });
    assert.equal(bound, true);
    button.click();
    assert.deepEqual(calls, [['open-releases-page']], 'канал обязан уходить ровно с одним аргументом — именем');
});

test('без кнопки привязка молча ничего не делает', () => {
    // Панель может быть пересобрана из трея, и элемента может не оказаться.
    assert.equal(Onboarding.bindReleasesLink({ button: null, send: () => {} }), false);
    assert.equal(Onboarding.bindReleasesLink({ button: fakeButton() }), false);
});

test('init делает обе вещи разом и сообщает, что удалось', () => {
    const storage = fakeStorage();
    const button = fakeButton();
    const calls = [];
    const seen = [];
    const result = Onboarding.init({
        storage,
        releasesButton: button,
        send: (...a) => calls.push(a),
        notify: (t) => seen.push(t),
        schedule: (fn) => fn()
    });
    assert.deepEqual(result, { hintShown: true, releasesBound: true });
    assert.equal(seen.length, 1);
    button.click();
    assert.deepEqual(calls, [['open-releases-page']]);
});
