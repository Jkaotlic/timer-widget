'use strict';

/**
 * `test` и `expect` для ВСЕХ спек — отсюда, а не из '@playwright/test'.
 *
 * Разница одна: авто-фикстура `_failureArtifacts`. После упавшего теста она
 * кладёт в его папку в test-results/ снимки и состояние окон
 * (e2e/failure-artifacts.js). Спека, взявшая `test` напрямую из
 * '@playwright/test', тихо останется без следов — это ловит
 * tests/e2e-fixtures.test.js.
 */

const base = require('@playwright/test');
const artifacts = require('./failure-artifacts');

const test = base.test.extend({
    // Пустой разбор — требование Playwright: первым аргументом фикстуры он
    // читает, от каких фикстур она зависит, и принимает только `{…}`.
    // eslint-disable-next-line no-empty-pattern
    _failureArtifacts: [async ({}, use, testInfo) => {
        artifacts.beginTest();
        await use();
        if (testInfo.status !== testInfo.expectedStatus) {
            await artifacts.attachOnFailure(testInfo);
        }
    }, {
        auto: true,
        // Свой бюджет на снятие следов: тест, упавший по ТАЙМАУТУ, уже
        // израсходовал свой, и без отдельного запаса снимать было бы некогда.
        timeout: 60000,
        title: 'следы упавшего теста'
    }]
});

module.exports = { test, expect: base.expect };
