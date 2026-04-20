#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'NOTICE');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let raw;
try {
    raw = execSync('npx --yes license-checker --json --excludePrivatePackages', {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8'
    });
} catch (err) {
    console.error('license-checker failed:', err.message);
    process.exit(1);
}

const packages = JSON.parse(raw);

const header = `Timer Widget
Copyright (c) 2026 ${pkg.author && pkg.author.name ? pkg.author.name : pkg.author || 'Jkaotlic'}
Licensed under the ${pkg.license || 'MIT'} License.

This software includes the following third-party components.
Each is distributed under its own license terms (listed below).

For the embedded Electron runtime (Chromium, V8, Node.js, libuv and their dependencies),
see LICENSES.chromium.html shipped with the application installation.

================================================================================

`;

const entries = Object.entries(packages)
    .filter(([name]) => !name.startsWith('timer-widget@'))
    .sort(([a], [b]) => a.localeCompare(b));

const blocks = entries.map(([nameVer, info]) => {
    const [name, version] = nameVer.split(/@(?=[^@]+$)/);
    const lines = [
        `=== ${name} ===`,
        `Version: ${version || 'unknown'}`,
        `License: ${info.licenses || 'UNKNOWN'}`
    ];
    if (info.repository) { lines.push(`Repository: ${info.repository}`); }
    if (info.publisher) { lines.push(`Publisher: ${info.publisher}`); }
    if (info.url) { lines.push(`Homepage: ${info.url}`); }
    return lines.join('\n');
});

const body = blocks.join('\n\n');
fs.writeFileSync(OUT, header + body + '\n', 'utf8');
console.log(`NOTICE written: ${entries.length} packages (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
