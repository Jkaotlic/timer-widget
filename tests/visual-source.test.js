'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('control window keeps enough breathing room for rounded glass panel', () => {
    const constants = read('constants.js');
    const controlHtml = read('electron-control.html');

    assert.match(constants, /CONTROL_WINDOW_WIDTH:\s*400/);
    assert.match(constants, /CONTROL_WINDOW_MIN_WIDTH:\s*380/);
    assert.match(controlHtml, /\.app-shell\s*\{[^}]*padding:\s*0;/s);
    assert.match(controlHtml, /\.app-shell::before\s*\{[^}]*inset:\s*0;/s);
    assert.match(controlHtml, /\.control-panel\s*\{[^}]*max-height:\s*100vh;/s);
    assert.match(controlHtml, /html,\s*body\s*\{[^}]*background:\s*transparent;/s);
    assert.match(controlHtml, /\.control-window\s*\{[^}]*background:\s*transparent;/s);
});

test('control settings use one outer shell instead of a nested window frame', () => {
    const controlHtml = read('electron-control.html');

    assert.match(controlHtml, /\.app-shell::before\s*\{[^}]*background:[^}]*var\(--tw-bg-surface-solid\);[^}]*box-shadow:\s*var\(--tw-shadow-panel\);/s);
    assert.match(controlHtml, /\.control-panel\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(controlHtml, /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*border-right:\s*1px solid var\(--tw-divider\);/s);
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(controlHtml, /@media \(min-width: 500px\)\s*\{[^}]*\.control-panel\s*\{\s*margin:\s*0;\s*\}/s);
});

test('opening settings keeps control scale stable', () => {
    const controlHtml = read('electron-control.html');

    assert.match(controlHtml, /\.app-shell\s*\{[^}]*--drawer-width:\s*336px;[^}]*--control-panel-width:\s*400px;/s);
    assert.match(controlHtml, /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*width:\s*var\(--control-panel-width\);[^}]*max-width:\s*var\(--control-panel-width\);/s);
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*width:\s*var\(--drawer-width\);[^}]*max-width:\s*var\(--drawer-width\);/s);
    assert.doesNotMatch(controlHtml, /\.timer-display-main\s*\{[^}]*vw/s);
    assert.match(controlHtml, /shell\.style\.setProperty\('--control-panel-width', `\$\{panelWidth\}px`\)/);
});

test('control window keeps a reliable drag region after frameless shell changes', () => {
    const controlHtml = read('electron-control.html');

    assert.match(controlHtml, /\.custom-titlebar,\s*\n\s*\.timer-header\s*\{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;[^}]*user-select:\s*none;/s);
    assert.match(controlHtml, /\.custom-titlebar \.titlebar-right\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(controlHtml, /\.custom-titlebar \.window-controls\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(controlHtml, /\.faq-btn\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
});

test('widget windows only start JS drag from non-interactive surfaces', () => {
    const widgetHtml = read('electron-widget.html');
    const clockHtml = read('electron-clock-widget.html');
    const displayScript = read('display-script.js');

    [widgetHtml, clockHtml, displayScript].forEach(source => {
        assert.match(source, /isWindowDragTarget\(target\)\s*\{[^}]*typeof target\.closest === 'function'/s);
        assert.match(source, /button, input, select, textarea, \[role="button"\], \[tabindex\]/);
        assert.match(source, /e\.button !== 0[^;]+e\.altKey[^;]+e\.ctrlKey[^;]+e\.metaKey[^;]+e\.shiftKey/s);
        assert.match(source, /!\s*this\.isWindowDragTarget\(e\.target\)/);
    });
});

test('clock overlay controls opt out of Electron drag regions with standard and prefixed CSS', () => {
    const clockHtml = read('electron-clock-widget.html');

    assert.match(clockHtml, /\.controls-overlay\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(clockHtml, /\.ctrl-btn\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(clockHtml, /\.settings-panel\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
});

test('empty timer sign slots do not push positive digits off center', () => {
    const controlHtml = read('electron-control.html');
    const widgetHtml = read('electron-widget.html');

    assert.match(controlHtml, /\.timer-display-main \.tm-sign\s*\{[^}]*width:\s*0;/s);
    assert.match(controlHtml, /\.timer-display-main \.tm-sign:not\(:empty\)\s*\{[^}]*width:\s*0\.6ch;/s);
    assert.match(widgetHtml, /\.time-display \.tm-sign\s*\{[^}]*width:\s*0;/s);
    assert.match(widgetHtml, /\.time-display \.tm-sign:not\(:empty\)\s*\{[^}]*width:\s*0\.6ch;/s);
});

test('circular widget centers the digits independently from the status chip', () => {
    const widgetHtml = read('electron-widget.html');

    assert.match(widgetHtml, /\.center-content\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*1fr auto 1fr;/s);
    assert.match(widgetHtml, /\.center-content\s*\{[^}]*width:\s*72%;/s);
    assert.match(widgetHtml, /\.time-display\s*\{[^}]*grid-row:\s*2;/s);
    assert.match(widgetHtml, /\.status-badge\s*\{[^}]*grid-row:\s*3;/s);
});

test('circular clock keeps the time fixed at the ring center', () => {
    const clockHtml = read('electron-clock-widget.html');

    assert.match(clockHtml, /\.center-content\s*\{[^}]*width:\s*72%;[^}]*height:\s*72%;/s);
    assert.match(clockHtml, /\.time-display\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\);/s);
    assert.match(clockHtml, /\.center-content > \.date-badge\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\);/s);
    assert.match(clockHtml, /\.center-content > \.timezone-badge\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\);/s);
});

test('release-facing docs do not point back to Electron 41 or production DevTools edits', () => {
    const readmeRu = read('README.md');
    const readmeEn = read('README.en.md');
    const performance = read('docs/PERFORMANCE.md');

    assert.doesNotMatch(readmeRu, /Electron_41/);
    assert.doesNotMatch(readmeEn, /Electron_41/);
    assert.doesNotMatch(performance, /devTools:\s*true/);
    assert.match(performance, /npm run dev/);
});
