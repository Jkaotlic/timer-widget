const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    // Сносит и создаёт заново каталог профиля (см. e2e/global-setup.js): тесты
    // делят один профиль внутри прогона, но не должны наследовать предыдущий.
    globalSetup: require.resolve('./e2e/global-setup.js'),
    timeout: 30000,
    retries: 0,
    // ОДИН воркер обязателен: приложение держит single-instance lock
    // (app.requestSingleInstanceLock в electron-main.js), поэтому второй
    // параллельно запущенный экземпляр немедленно завершается, и тесты во
    // втором файле падают с «Process failed to launch». Последовательный прогон —
    // не оптимизация, а требование архитектуры приложения.
    workers: 1,
    fullyParallel: false,
    use: {
        trace: 'on-first-retry',
    },
});
