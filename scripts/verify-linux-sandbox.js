#!/usr/bin/env node
'use strict';

/**
 * Проверяет настройку песочницы Chromium в СОБРАННЫХ Linux-пакетах.
 *
 * Зачем отдельный скрипт, а не unit-тест. Unit-тест читает package.json и
 * build/linux-after-install.sh — то есть мои намерения. Здесь проверяется
 * результат: что electron-builder действительно положил postinst в deb, что в
 * .desktop-файле нет `--no-sandbox`, и что у AppImage ключ, наоборот, на месте.
 * Между намерением и артефактом стоит сборщик со своими шаблонами и заменами.
 *
 * Почему цели разные:
 *   deb      — есть шаг установки, значит можно выставить SUID-бит и владельца
 *              root на chrome-sandbox; песочница работает без user namespaces;
 *   AppImage — устанавливать нечего, SUID выставить некому, а непривилегированные
 *              user namespaces доступны не везде (жёсткие ядра, а в Ubuntu 24.04
 *              их ограничивает профиль AppArmor). Поэтому там `--no-sandbox`
 *              остаётся осознанным исключением, и это единственная цель, где он
 *              допустим.
 *
 * Запускается в CI на ubuntu после `electron-builder --linux deb AppImage`.
 * Ненулевой код возврата валит сборку.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const problems = [];
const notes = [];

function fail(msg) { problems.push(msg); }
function note(msg) { notes.push(msg); }

function findByExt(dir, ext) {
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(ext))
        .map((f) => path.join(dir, f));
}

// --- deb ---------------------------------------------------------------------
function checkDeb(debPath) {
    console.log(`[linux-sandbox] deb: ${path.basename(debPath)}`);

    // Управляющие файлы пакета: postinst и всё остальное.
    const control = execFileSync('dpkg-deb', ['-I', debPath, 'postinst'], { encoding: 'utf8' });
    const code = control
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');

    if (!/chmod\s+4755/.test(code)) {
        fail('в postinst deb-пакета нет `chmod 4755` — песочница не поднимется без user namespaces');
    }
    if (!/chown\s+root:root/.test(code)) {
        fail('в postinst deb-пакета нет `chown root:root` — один SUID-бит без владельца root бесполезен');
    }

    // Строка запуска в .desktop не должна отключать песочницу.
    const list = execFileSync('dpkg-deb', ['-c', debPath], { encoding: 'utf8' });
    const desktopEntry = list.split('\n').find((l) => l.includes('.desktop'));
    if (!desktopEntry) {
        fail('в deb-пакете не найден .desktop-файл');
        return;
    }
    const desktopPath = desktopEntry.trim().split(/\s+/).pop().replace(/^\./, '');
    const extractDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deb-'));
    execFileSync('dpkg-deb', ['-x', debPath, extractDir]);
    const desktop = fs.readFileSync(path.join(extractDir, desktopPath.replace(/^\//, '')), 'utf8');
    const exec = (desktop.split('\n').find((l) => l.startsWith('Exec=')) || '');
    console.log(`[linux-sandbox]   Exec: ${exec}`);
    if (exec.includes('--no-sandbox')) {
        fail('deb запускается с --no-sandbox: песочница отключена в пакете, у которого есть postinst');
    }
}

// --- AppImage ----------------------------------------------------------------
function checkAppImage(appImagePath) {
    console.log(`[linux-sandbox] AppImage: ${path.basename(appImagePath)}`);
    // AppImage — это squashfs с префиксом. Ключ запуска лежит в .desktop внутри
    // образа; распаковываем самим образом (--appimage-extract), это не требует
    // FUSE.
    fs.chmodSync(appImagePath, 0o755);
    const workdir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'appimage-'));
    execFileSync(appImagePath, ['--appimage-extract'], { cwd: workdir, stdio: 'pipe' });
    const squash = path.join(workdir, 'squashfs-root');
    const desktopFile = findByExt(squash, '.desktop')[0];
    if (!desktopFile) {
        fail('в AppImage не найден .desktop-файл');
        return;
    }
    const exec = (fs.readFileSync(desktopFile, 'utf8').split('\n').find((l) => l.startsWith('Exec=')) || '');
    console.log(`[linux-sandbox]   Exec: ${exec}`);
    if (!exec.includes('--no-sandbox')) {
        fail(
            'у AppImage пропал --no-sandbox: без установочного шага SUID выставить нечем, '
            + 'и на системах без user namespaces приложение не запустится'
        );
    }
}

function main() {
    const debs = findByExt(DIST, '.deb');
    const appImages = findByExt(DIST, '.appimage');

    if (!debs.length && !appImages.length) {
        console.error('[linux-sandbox] в dist/ нет ни deb, ни AppImage — сначала соберите пакеты');
        process.exit(1);
    }

    if (debs.length) { checkDeb(debs[0]); } else { note('deb не собран — проверка postinst пропущена'); }
    if (appImages.length) { checkAppImage(appImages[0]); } else { note('AppImage не собран — проверка пропущена'); }

    for (const n of notes) { console.log(`[linux-sandbox] заметка: ${n}`); }

    if (problems.length) {
        console.error('\n[linux-sandbox] ПЕСОЧНИЦА НАСТРОЕНА НЕВЕРНО');
        for (const p of problems) { console.error(`  ${p}`); }
        process.exit(1);
    }
    console.log('[linux-sandbox] OK: deb с рабочей песочницей, исключение только у AppImage');
}

if (require.main === module) {
    main();
}

module.exports = { findByExt };
