'use strict';

const fs = require('fs');
const path = require('path');

const POLITICAL_URL_PATTERNS = [
    [/https?:\/\/stand-with-ukraine\.pp\.ua\/?/gi, ''],
    [/\s*-\s*StandWithUkraine/gi, ''],
    [/StandWithUkraine/gi, ''],
    [/https?:\/\/github\.com\/acornjs\/acorn/gi, 'https://www.npmjs.com/package/acorn']
];

const ACORN_POLITICAL_BANNER = /<h2[^>]*>[^<]*Support Ukraine[^<]*<\/h2>[\s\S]*?<\/p>/gi;

function walk(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            walk(full, acc);
        } else if (/LICENSES?\.chromium\.html$/i.test(entry.name) || /LICENSE\.txt$/i.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function sanitizeLicenseFile(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return false;
    }
    const original = content;

    content = content.replace(ACORN_POLITICAL_BANNER, '');
    for (const [pattern, replacement] of POLITICAL_URL_PATTERNS) {
        content = content.replace(pattern, replacement);
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    }
    return false;
}

// Разделяемые библиотеки Electron (libffmpeg.so, libvk_swiftshader.so,
// libvulkan.so.1) приходят с правами 0755. dlopen() бит исполнения не нужен,
// а lintian считает его ошибкой (E: shared-library-is-executable, CI
// 28.09.2026). fpm берёт права с диска — поэтому снимаем здесь, до упаковки.
// Символические ссылки не трогаем: chmod по ним менял бы цель.
const SHARED_LIB = /\.so(\.\d+)*$/;

function dropExecOnSharedLibs(dir, acc = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            dropExecOnSharedLibs(full, acc);
        } else if (entry.isFile() && SHARED_LIB.test(entry.name)) {
            const mode = fs.statSync(full).mode & 0o777;
            if (mode & 0o111) {
                fs.chmodSync(full, mode & ~0o111);
                acc.push(full);
            }
        }
    }
    return acc;
}

exports.dropExecOnSharedLibs = dropExecOnSharedLibs;

exports.default = async function afterPack(context) {
    const appOutDir = context.appOutDir;
    if (context.electronPlatformName === 'linux') {
        const fixed = dropExecOnSharedLibs(appOutDir);
        console.log(`[after-pack] Linux: снят бит исполнения у ${fixed.length} библиотек: ` +
            fixed.map((f) => path.relative(appOutDir, f)).join(', '));
    }
    const files = walk(appOutDir, []);
    let cleaned = 0;
    for (const file of files) {
        if (sanitizeLicenseFile(file)) {
            cleaned++;
            console.log(`[after-pack] Cleaned political content: ${path.relative(appOutDir, file)}`);
        }
    }
    console.log(`[after-pack] Processed ${files.length} license file(s), cleaned ${cleaned}.`);
};
