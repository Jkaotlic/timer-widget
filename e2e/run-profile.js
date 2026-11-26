'use strict';

const RUN_PROFILE_ENV = 'TIMER_WIDGET_E2E_RUN_PROFILE';

function getUserDataDir() {
    // Playwright может импортировать спеки без globalSetup, например при --list.
    // Читаем окружение только тогда, когда тест действительно обращается к профилю.
    const profile = process.env[RUN_PROFILE_ENV];
    if (!profile) {
        throw new Error('Профиль e2e не создан: запустите тесты с globalSetup из playwright.config.js');
    }
    return profile;
}

module.exports = { RUN_PROFILE_ENV, getUserDataDir };
