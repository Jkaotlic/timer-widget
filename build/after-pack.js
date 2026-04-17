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

exports.default = async function afterPack(context) {
    const appOutDir = context.appOutDir;
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
