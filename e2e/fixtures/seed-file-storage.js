'use strict';

/**
 * Главный процесс-«старая версия» для e2e/storage-migration.spec.js: пишет
 * ключи в localStorage origin'а file:// — туда, где их держало приложение до
 * переезда окон на app:// (SEC-12). Запускается тем же Electron, что и
 * приложение, с тем же --user-data-dir.
 *
 * Ключи — JSON-файл из переменной TW_SEED_FILE. Страница — та же пустая
 * storage-migration.html: все адреса file:// делят ОДНО хранилище, так что
 * ключи, записанные с неё, — ровно те, что видели окна прежней версии.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

const entries = JSON.parse(fs.readFileSync(process.env.TW_SEED_FILE, 'utf8'));
const PAGE = path.join(__dirname, '..', '..', 'storage-migration.html');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(PAGE);
    const payload = JSON.stringify(JSON.stringify(entries));
    const count = await win.webContents.executeJavaScript(`(() => {
        const e = JSON.parse(${payload});
        for (const k of Object.keys(e)) { localStorage.setItem(k, e[k]); }
        return localStorage.length;
    })()`);
    session.defaultSession.flushStorageData();
    console.log(`SEEDED ${count}`);
    // Выход сам сбрасывает хранилище на диск; пауза — чтобы сброс выше успел.
    setTimeout(() => app.quit(), 300);
}).catch((err) => {
    console.error('SEED FAILED', err && err.message);
    app.exit(1);
});
