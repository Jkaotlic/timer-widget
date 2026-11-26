'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RUN_PROFILE_ENV } = require('./run-profile');

module.exports = function globalSetup() {
    // Воркеры и повторные запуски Electron наследуют один профиль прогона.
    // При параллельном прогоне mkdtemp создаёт другой каталог.
    const previousProfile = process.env[RUN_PROFILE_ENV];
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-widget-e2e-'));
    process.env[RUN_PROFILE_ENV] = profile;
    console.log(`[e2e] профиль тестов: ${profile}`);

    return () => {
        try {
            fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
        } finally {
            if (process.env[RUN_PROFILE_ENV] === profile) {
                if (previousProfile === undefined) {
                    delete process.env[RUN_PROFILE_ENV];
                } else {
                    process.env[RUN_PROFILE_ENV] = previousProfile;
                }
            }
        }
    };
};
