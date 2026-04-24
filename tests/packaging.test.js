// Guard against the "works in dev, breaks in the installer" class of bugs.
// Every local file referenced from our HTML pages (via <link> / <script src>)
// and from our main-process JS (via require('./…')) must be listed in
// package.json `build.files`. Otherwise electron-builder won't pack it into
// app.asar, and the packaged app loads a renderer where half the CSS custom
// properties are undefined or a module is missing at runtime.
//
// Historical incident: v2.3.0 shipped without design-tokens.css in `files`.
// Packaged app rendered the control panel on a white BrowserWindow surface
// (Electron's default) because every --tw-* token was empty. Dev runs worked
// because file:// reads go straight from the working directory.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const filesPatterns = Array.isArray(pkg.build && pkg.build.files) ? pkg.build.files : [];

/**
 * Crude but sufficient check: do any of the patterns in `files` match the
 * exact bare-name asset? We only ever list assets as either their bare name
 * (e.g. "design-tokens.css") or a glob ("fonts/**\/*"). That's enough for
 * this project — we don't need full electron-builder minimatch semantics.
 */
function isPacked(assetPath) {
    if (filesPatterns.includes(assetPath)) { return true; }
    // Match top-level glob directories (e.g. "sounds/**/*" covers "sounds/x.mp3")
    for (const pattern of filesPatterns) {
        const [dir] = pattern.split('/');
        if (assetPath.startsWith(dir + '/') && pattern.includes('**')) { return true; }
    }
    return false;
}

function readHtml(file) {
    return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function extractLocalAssets(html) {
    const assets = new Set();
    // <link rel="stylesheet" href="...">  — treat any href ending in .css as local
    const linkRe = /<link[^>]+href\s*=\s*["']([^"']+\.css)["']/gi;
    // <script src="...">                   — treat any src ending in .js as local
    const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+\.js)["']/gi;
    for (const re of [linkRe, scriptRe]) {
        let match;
        while ((match = re.exec(html)) !== null) {
            const asset = match[1];
            // Skip absolute URLs — those are CDN/data, not bundled
            if (/^(https?:|data:|file:)/i.test(asset)) { continue; }
            assets.add(asset.replace(/^\.\//, ''));
        }
    }
    return assets;
}

test('every <link>/<script src> in HTML is listed in package.json build.files', () => {
    const htmlFiles = [
        'electron-control.html',
        'electron-widget.html',
        'electron-clock-widget.html',
        'display.html'
    ];

    const missing = [];
    for (const htmlFile of htmlFiles) {
        const html = readHtml(htmlFile);
        for (const asset of extractLocalAssets(html)) {
            // Must exist on disk and be packed
            const diskPath = path.join(repoRoot, asset);
            if (!fs.existsSync(diskPath)) {
                missing.push(`${htmlFile} references ${asset} which doesn't exist on disk`);
                continue;
            }
            if (!isPacked(asset)) {
                missing.push(`${htmlFile} references ${asset} — not in package.json build.files`);
            }
        }
    }

    assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('every local require() in main-process JS is listed in package.json build.files', () => {
    const mainJsFiles = [
        'electron-main.js',
        'preload.js',
        'recovery.js',
        'timer-engine.js',
        'utils.js',
        'security.js',
        'constants.js',
        'ipc-compat.js'
    ];

    const missing = [];
    for (const jsFile of mainJsFiles) {
        const code = fs.readFileSync(path.join(repoRoot, jsFile), 'utf8');
        // require('./foo') or require('./foo/bar')
        const re = /require\s*\(\s*['"](\.\/[^'"]+)['"]/g;
        let match;
        while ((match = re.exec(code)) !== null) {
            let target = match[1].replace(/^\.\//, '');
            // dev-only tooling — not shipped, acceptable
            if (target.startsWith('scripts/')) { continue; }
            // Resolve bare names (require('./foo') → foo.js)
            const candidates = [target, `${target}.js`, `${target}/index.js`];
            const onDisk = candidates.find(c => fs.existsSync(path.join(repoRoot, c)));
            if (!onDisk) {
                missing.push(`${jsFile} requires '${match[1]}' — not resolvable on disk`);
                continue;
            }
            if (!isPacked(onDisk)) {
                missing.push(`${jsFile} requires '${match[1]}' (${onDisk}) — not in package.json build.files`);
            }
        }
    }

    assert.deepStrictEqual(missing, [], missing.join('\n'));
});
