'use strict';

/**
 * ПОСЛЕДНЯЯ спека прогона (имя начинается с «zz-»: Playwright идёт по файлам
 * по алфавиту, воркер один): падает, если профиль после какого-то теста не
 * вернулся к тому, каким тест его получил, — ни самим тестом, ни возвратом
 * сторожа на app.close().
 *
 * Журнал пишет e2e/profile-guard.js. Прогон одной спеки сюда не доходит —
 * там сторож печатает всё предупреждением на закрытии.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { readLedger, VOLATILE_KEYS } = require('./profile-guard');
const { launchApp, USER_DATA_DIR } = require('./launch');
const { RELAY_STATE_FILE } = require('../relay-store.js');

test('каждый тест вернул общий профиль таким, каким получил', async () => {
    // Запуск нужен ради сверки «между тестами» для ПРЕДЫДУЩЕГО теста: то, что
    // его окна дописали на выходе, видно только при следующем запуске.
    const { app } = await launchApp();
    await app.close();

    const { leaks, restored } = readLedger();
    // Возвращённое сторожем — сведения, а не провал: тест поменял профиль, и
    // возврат сработал. Провал — то, что вернуть не удалось.
    const names = Object.keys(restored);
    if (names.length) {
        console.log(`[profile-guard] возвращено сторожем после ${names.length} тест(ов):\n  ${names.join('\n  ')}`);
    }
    const report = Object.entries(leaks)
        .map(([name, lines]) => `${name}\n    ${lines.join('\n    ')}`)
        .join('\n');
    expect(
        Object.keys(leaks),
        `профиль не вернулся к «было» (e2e/profile-guard.js; изменчивые ключи приложения `
        + `не считаются: ${Object.keys(VOLATILE_KEYS).join(', ')}):\n${report}`
    ).toEqual([]);
});

test('память ретрансляторов main не переживает закрытие теста (relay-state.json)', async () => {
    // localStorage сторож возвращает, а память main (relay.*) — нет: выход
    // пишет её в файл, и следующий тест прочёл бы её раньше посылок панели.
    // Сторож удаляет файл после закрытия. Проверка на себе: пока приложение
    // живо, файл ЕСТЬ (панель прислала настройки, склейка их записала) —
    // иначе «файла нет» значило бы и «удалён», и «не писался вовсе».
    const file = path.join(USER_DATA_DIR, RELAY_STATE_FILE);
    const { app } = await launchApp();
    await expect.poll(() => fs.existsSync(file), {
        message: 'живое приложение не записало relay-state.json — проверка ниже ничего не докажет'
    }).toBe(true);
    await app.close();
    expect(fs.existsSync(file), 'сторож профиля не удалил relay-state.json после закрытия').toBe(false);
});
