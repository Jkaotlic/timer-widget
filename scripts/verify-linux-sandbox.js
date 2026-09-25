#!/usr/bin/env node
'use strict';

/**
 * Проверяет настройку песочницы Chromium в СОБРАННОМ deb-пакете.
 *
 * Зачем отдельный скрипт, а не unit-тест. Unit-тест читает package.json и
 * build/linux-*.sh — то есть мои намерения. Здесь проверяется результат: что
 * electron-builder действительно положил наш postinst/postrm (с подставленными
 * путями), профиль AppArmor с `userns,` и .desktop без `--no-sandbox`. Между
 * намерением и артефактом стоит сборщик со своими шаблонами и заменами.
 *
 * Схема песочницы:
 *   AppArmor — Ubuntu 24.04+ ограничивает user namespaces для приложений без
 *              профиля; postinst ставит профиль с `userns,`;
 *   SUID     — chrome-sandbox получает 4755 + root ТОЛЬКО там, где user
 *              namespaces в ядре нет вовсе; в остальных случаях 0755.
 * `--no-sandbox` не допускается ни в одной цели. AppImage снят с поставки: без
 * шага установки песочницу там не поднять ничем, кроме этого ключа, и именно
 * Linux-сборка не прошла ПСИ по критическим уязвимостям.
 *
 * Запускается в CI и в релизе на ubuntu после `electron-builder --linux deb`.
 * Ненулевой код возврата валит сборку.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const problems = [];

function fail(msg) { problems.push(msg); }

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

    if (!/unprivileged_userns_clone/.test(code) || /unshare --user true/.test(code)) {
        fail('postinst решает про SUID не по настройкам ядра — проба от root проходит и там, где пользователю запрещено');
    }
    if (!/chmod\s+4755/.test(code)) {
        fail('в postinst нет запасного `chmod 4755` — на ядрах без user namespaces приложение не стартует');
    }
    if (!/chown\s+root:root/.test(code)) {
        fail('в postinst нет `chown root:root` — SUID-бит без владельца root бесполезен');
    }
    if (!/\/etc\/apparmor\.d\/[\w-]+/.test(code)) {
        fail('postinst не ставит профиль AppArmor — на Ubuntu 24.04+ песочница не поднимется');
    }
    if (/\$\{[a-zA-Z]+\}/.test(code)) {
        fail('в postinst остались неподставленные макросы ${...}');
    }

    const postrm = execFileSync('dpkg-deb', ['-I', debPath, 'postrm'], { encoding: 'utf8' });
    if (!/apparmor_parser --remove/.test(postrm)) {
        fail('postrm не выгружает профиль AppArmor — он останется в системе после удаления');
    }

    // Depends: штатный список electron-builder не знает libgbm1 и libasound2 —
    // пакет ставился на чистую систему и падал на старте (job
    // deb-launch-container, 25.09.2026). Здесь — быстрая проверка списка,
    // там — запуск.
    const depends = execFileSync('dpkg-deb', ['-f', debPath, 'Depends'], { encoding: 'utf8' });
    console.log(`[linux-sandbox]   Depends: ${depends.trim()}`);
    for (const lib of ['libgbm1', 'libasound2', 'libnss3', 'libgtk-3-0']) {
        if (!new RegExp(`(^|[,|]\\s*)${lib.replace(/[.+]/g, '\\$&')}(\\s|,|\\(|$)`).test(depends)) {
            fail(`в Depends нет ${lib} — на чистой системе приложение не стартует`);
        }
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
        fail('deb запускается с --no-sandbox: песочница отключена');
    }

    const profileEntry = list.split('\n').find((l) => /resources\/apparmor-profile$/.test(l.trim()));
    if (!profileEntry) {
        fail('в пакете нет resources/apparmor-profile');
        return;
    }
    const profilePath = profileEntry.trim().split(/\s+/).pop().replace(/^\.\//, '');
    const profile = fs.readFileSync(path.join(extractDir, profilePath), 'utf8');
    if (!/^\s*userns,/m.test(profile)) {
        fail('профиль AppArmor не разрешает userns — он ничего не даёт песочнице');
    }
}

function main() {
    const debs = findByExt(DIST, '.deb');
    if (!debs.length) {
        console.error('[linux-sandbox] в dist/ нет deb — сначала соберите пакет');
        process.exit(1);
    }
    checkDeb(debs[0]);

    if (findByExt(DIST, '.appimage').length) {
        fail('в dist/ снова AppImage: без шага установки он запускается только с --no-sandbox');
    }

    if (problems.length) {
        console.error('\n[linux-sandbox] ПЕСОЧНИЦА НАСТРОЕНА НЕВЕРНО');
        for (const p of problems) { console.error(`  ${p}`); }
        process.exit(1);
    }
    console.log('[linux-sandbox] OK: deb с рабочей песочницей (AppArmor + SUID только запасом), --no-sandbox нет нигде');
}

if (require.main === module) {
    main();
}

module.exports = { findByExt };
