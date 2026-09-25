'use strict';

/**
 * Перенос настроек file:// → app:// (SEC-12) в НАСТОЯЩЕМ Electron.
 *
 * Unit-тест (tests/main-storage-migration.test.js) исполняет код переноса на
 * подставке хранилища. Здесь — то, что подставка доказать не может: что у
 * file:// и app:// в Chromium действительно РАЗНЫЕ хранилища, что старое
 * читается, новое пишется, переживает выход и доходит до окон.
 *
 * «Старая версия» — e2e/fixtures/seed-file-storage.js: пишет ключи в origin
 * file:// того же профиля. Профиль — свой на тест, а не общий e2e: общий
 * профиль к этому моменту уже отмечен «перенос сделан».
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const { MAIN, cleanEnv, waitForControlWindow } = require('./launch');

const ELECTRON = require('electron');
const SEEDER = path.join(__dirname, 'fixtures', 'seed-file-storage.js');
const MARKER = 'storage-migration.json';

// Настоящий PNG из шума — не сжимается, поэтому размер файла честный.
function noisePng(side) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8 бит, RGB
    const rows = [];
    for (let y = 0; y < side; y++) {
        const row = Buffer.alloc(1 + side * 3);
        for (let i = 1; i < row.length; i++) { row[i] = (Math.random() * 256) | 0; }
        rows.push(row);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 0 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function seed(dir, entries) {
    const file = path.join(dir, '..', `${path.basename(dir)}-seed.json`);
    fs.writeFileSync(file, JSON.stringify(entries));
    const res = spawnSync(ELECTRON, [SEEDER, `--user-data-dir=${dir}`], {
        env: cleanEnv({ TW_SEED_FILE: file }), encoding: 'utf8', timeout: 60000
    });
    fs.rmSync(file, { force: true });
    const out = `${res.stdout}\n${res.stderr}`;
    const m = /SEEDED (\d+)/.exec(out);
    if (!m) { throw new Error(`посев file:// не удался: ${out.slice(0, 600)}`); }
    return Number(m[1]);
}

async function start(dir) {
    const app = await electron.launch({ args: [MAIN, `--user-data-dir=${dir}`], env: cleanEnv() });
    const control = await waitForControlWindow(app);
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(900);
    return { app, control };
}

const readMarker = (dir) => JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
const readKeys = (page, keys) => page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), keys);

test('перенос настроек: всё из file:// доходит до app:// и окон, второй запуск не повторяет', async () => {
    test.setTimeout(180000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-migration-'));
    const png = noisePng(900); // ~2.4 МБ файла → ~3.2 М символов base64
    const SEED = {
        uiTheme: 'light',
        onboardingShown: 'true',
        displayExtSettings: JSON.stringify({ eventTitle: 'Перенос: доклад №7' }),
        customSounds: JSON.stringify([{ name: 'Гонг-перенос', data: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=' }]),
        localBgImage: `data:image/png;base64,${png.toString('base64')}`,
        localBgSettings: JSON.stringify({ fit: 'contain', overlay: 20 }),
        widgetColors: JSON.stringify({ background: '#123456' }),
        widgetGeometry: JSON.stringify({ x: 40, y: 50, width: 220, height: 220 }),
        // Непрозрачный ключ: приложение его не знает и не трогает — значит,
        // сравнивать можно байт в байт. Кириллица, эмодзи, U+2028 и кавычки —
        // то, на чём ломается передача строкой кода.
        e2eMigrationProbe: 'старое «значение» 😀   "q" \\ </script>'
    };
    const KEYS = Object.keys(SEED);
    const OPAQUE = ['localBgImage', 'customSounds', 'e2eMigrationProbe', 'widgetGeometry'];

    try {
        const seeded = seed(dir, SEED);
        expect(seeded).toBe(KEYS.length);
        expect(fs.existsSync(path.join(dir, MARKER)), 'метки до первого запуска быть не может').toBe(false);

        // --- Первый запуск новой версии: перенос ---
        let { app, control } = await start(dir);
        try {
            expect(control.url()).toBe('app://timer-widget/electron-control.html');
            const marker = readMarker(dir);
            expect(marker.status).toBe('done');
            expect(marker.keys).toBe(KEYS.length);
            expect(marker.written).toBe(KEYS.length);

            const got = await readKeys(control, KEYS);
            for (const k of KEYS) { expect(got[k], `ключ ${k} не доехал`).not.toBeNull(); }
            for (const k of OPAQUE) { expect(got[k], `ключ ${k} доехал искажённым`).toBe(SEED[k]); }

            // Окна видят настройки, а не только хранилище.
            expect(await control.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
            expect(await control.inputValue('#eventTitleInput')).toBe('Перенос: доклад №7');
            expect(await control.evaluate(() => document.getElementById('localBgPreview').classList.contains('has-image'))).toBe(true);
            expect(await control.evaluate(() => [...document.querySelectorAll('.custom-sound-item')].map((e) => e.textContent).join('|')))
                .toContain('Гонг-перенос');

            // Скрытое окно переноса погашено.
            await expect.poll(() => app.windows().filter((w) => w.url().includes('storage-migration')).length).toBe(0);

            // Новое значение в новом origin — второй запуск обязан его сохранить.
            await control.evaluate(() => localStorage.setItem('e2eMigrationProbe', 'новое'));
        } finally {
            await app.close();
        }

        // --- Второй запуск: метка есть, перенос не повторяется ---
        const markerText = fs.readFileSync(path.join(dir, MARKER), 'utf8');
        ({ app, control } = await start(dir));
        try {
            expect(fs.readFileSync(path.join(dir, MARKER), 'utf8'), 'метка переписана — перенос шёл второй раз').toBe(markerText);
            expect((await readKeys(control, ['e2eMigrationProbe'])).e2eMigrationProbe).toBe('новое');
            expect((await readKeys(control, ['localBgImage'])).localBgImage).toBe(SEED.localBgImage);
        } finally {
            await app.close();
        }

        // --- Сбой до метки (метки нет): повтор не перезаписывает новое ---
        fs.rmSync(path.join(dir, MARKER));
        ({ app, control } = await start(dir));
        try {
            const again = readMarker(dir);
            expect(again.status).toBe('done');
            expect(again.skipped, 'при повторе всё уже было в app:// — ничего не перезаписано').toBe(KEYS.length);
            expect(again.written).toBe(0);
            expect((await readKeys(control, ['e2eMigrationProbe'])).e2eMigrationProbe).toBe('новое');
        } finally {
            await app.close();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('свежий профиль: перенос не создаёт окна и сразу ставит метку', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-migration-fresh-'));
    try {
        const { app, control } = await start(dir);
        try {
            // Первое же окно — панель: окна переноса не было вовсе.
            expect((await app.firstWindow()).url()).toBe(control.url());
            const marker = readMarker(dir);
            expect(marker.status).toBe('done');
            expect(marker.reason).toBe('fresh');
        } finally {
            await app.close();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
