'use strict';

/**
 * Одна подготовка на весь прогон: каталог профиля сносится и создаётся заново.
 *
 * Иначе прогон зависит от того, что оставил после себя предыдущий: тесты пишут
 * в общий localStorage (стиль часов, шильдики, геометрия окон), а снимок
 * восстановления вообще переживает выход по замыслу. Без чистки «зелено» могло
 * означать «повезло с остатками», а первый прогон на свежей машине падал.
 *
 * Чистим ЗДЕСЬ, а не в launch.js: каталог обязан быть один на прогон —
 * e2e/crash-recovery.spec.js перезапускает приложение и ждёт, что снимок
 * останется на месте.
 */

const fs = require('fs');
const { USER_DATA_DIR } = require('./launch');

module.exports = function globalSetup() {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    console.log(`[e2e] профиль тестов: ${USER_DATA_DIR}`);
};
