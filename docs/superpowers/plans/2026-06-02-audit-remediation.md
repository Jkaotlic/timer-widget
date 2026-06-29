# TimerWidget Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the actionable findings from the June 2, 2026 full project audit without changing product behavior beyond the audited fixes.

**Architecture:** Keep fixes scoped to existing vanilla JavaScript/Electron patterns. Add small testable helper modules for behavior that currently lives inside inline renderer code, and leave large HTML decomposition as a later dedicated refactor.

**Tech Stack:** Electron 42 target, Node.js built-in test runner, vanilla HTML/CSS/JS, GitHub Actions, electron-builder.

---

## File Map

- Modify `electron-main.js`: harden IPC handlers against missing or malformed payloads, enable DevTools only in unpackaged `--dev` runs, and use the existing PNG icon path.
- Create `renderer-storage.js`: shared browser/Node helper for safe JSON storage with byte limits and quota handling.
- Modify `electron-control.html`: use `renderer-storage.js` for custom sounds and keep user-facing quota errors graceful.
- Modify `package.json`: package the new helper module.
- Modify `tests/packaging.test.js`: continue guarding all local assets and modules in packaged builds.
- Create `tests/renderer-storage.test.js`: unit tests for quota-safe storage behavior.
- Create `tests/electron-main-source.test.js`: source-level regression tests for IPC payload hardening, DevTools dev-mode behavior, and icon path.
- Modify `.github/workflows/release.yml`: run lint in release jobs before packaging and update test count in release copy.
- Modify `README.md` and `README.en.md`: align test count and dev command wording with actual behavior.
- Modify `package.json` and `package-lock.json`: upgrade Electron from the CVE-flagged runtime line to the current patched line.
- Modify `electron-control.html` and `e2e/app.spec.js`: remove visual overflow/cropping in the control panel and keep e2e selectors aligned with the real timer display.

## Task 1: Durable Plan

**Files:**
- Create: `docs/superpowers/plans/2026-06-02-audit-remediation.md`

- [x] **Step 1: Save the implementation plan**

Create this file with the audit findings, target files, tests, and verification commands.

- [x] **Step 2: Verify plan exists**

Run: `Test-Path -Path docs/superpowers/plans/2026-06-02-audit-remediation.md`

Expected: `True`.

## Task 2: IPC Payload Hardening

**Files:**
- Modify: `electron-main.js`
- Create: `tests/electron-main-source.test.js`

- [x] **Step 1: Write source regression tests**

Add tests that assert IPC handlers for `display-move`, `clock-widget-resize`, `clock-widget-move`, `widget-set-position`, `widget-resize`, and `widget-move` do not destructure payloads in function parameters.

- [x] **Step 2: Run the new test and confirm RED**

Run: `node --test tests/electron-main-source.test.js`

Expected before implementation: FAIL because the current handlers destructure payloads in parameters or from unguarded data.

- [x] **Step 3: Implement guarded payload parsing**

Change the affected handlers to accept a single `payload`/`data` argument, check `payload && typeof payload === 'object'`, then read numeric fields.

- [x] **Step 4: Run the focused test and full unit suite**

Run: `node --test tests/electron-main-source.test.js`

Run: `node --test`

Expected: all tests pass.

## Task 3: Custom Sound Storage Safety

**Files:**
- Create: `renderer-storage.js`
- Modify: `electron-control.html`
- Modify: `package.json`
- Modify: `tests/packaging.test.js`
- Create: `tests/renderer-storage.test.js`

- [x] **Step 1: Write storage helper tests**

Cover:
- small values store successfully;
- values over limit are rejected before calling storage;
- quota errors return `{ ok:false, reason:'quota' }`;
- invalid JSON falls back to the default value.

- [x] **Step 2: Run the new storage test and confirm RED**

Run: `node --test tests/renderer-storage.test.js`

Expected before implementation: FAIL because `renderer-storage.js` does not exist.

- [x] **Step 3: Implement `renderer-storage.js`**

Export `getByteSize`, `safeSetJSON`, and `safeGetJSON`. Attach them to `window.RendererStorage` in browser context and to `module.exports` for Node tests.

- [x] **Step 4: Use the helper in custom sound add/delete paths**

Replace direct `localStorage.setItem('customSounds', ...)` calls with `RendererStorage.safeSetJSON('customSounds', updated, { limitBytes: 4 * 1024 * 1024 })`, and show a toast/error panel if storage fails.

- [x] **Step 5: Package the helper**

Add `renderer-storage.js` to `package.json build.files` and update packaging tests if the main-process module guard needs to include it.

- [x] **Step 6: Run focused and full tests**

Run: `node --test tests/renderer-storage.test.js tests/packaging.test.js`

Run: `node --test`

Expected: all tests pass.

## Task 4: Release, DevTools, Icon, And Docs Polish

**Files:**
- Modify: `electron-main.js`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `tests/electron-main-source.test.js`

- [x] **Step 1: Extend source tests for DevTools and icon path**

Assert BrowserWindow DevTools are enabled only by `process.argv.includes('--dev') && !app.isPackaged`, and `path.join(__dirname, 'build', 'icon.png')` is used instead of missing `icon.ico`.

- [x] **Step 2: Run source test and confirm RED**

Run: `node --test tests/electron-main-source.test.js`

Expected before implementation: FAIL on DevTools/icon assertions.

- [x] **Step 3: Implement runtime polish**

Set every BrowserWindow `devTools` option to `process.argv.includes('--dev') && !app.isPackaged`, open control DevTools only in unpackaged dev mode after load, and change control icon path to `build/icon.png`.

- [x] **Step 4: Update release CI**

Add a `Run lint` step or replace separate test steps with `npm run ci` in each tag build job before packaging.

- [x] **Step 5: Update docs and release copy**

Change stale `126/128/136/139/141/142 tests` text to `144 tests`. Make `npm run dev` wording match the implemented DevTools behavior.

- [x] **Step 6: Run full tests**

Run: `node --test`

Expected: all tests pass.

## Task 5: Electron CVE Runtime Upgrade

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Confirm current patched Electron release**

Check the npm registry for the current Electron release and compare it against the pre-remediation runtime `Electron 41.2.1 / Chromium 146.0.7680.188 / Node.js 24.14.1 / V8 14.6.202.33`.

- [x] **Step 2: Update dependency metadata**

Upgrade `electron` in `devDependencies` to the current patched line and regenerate `package-lock.json` with npm, keeping `electron-builder` on the current latest line unless the registry shows a newer compatible release.

- [x] **Step 3: Verify after dependency update**

Run `npm run lint`, `npm test`, and, if dependencies install cleanly, `npm run pack`.

- [x] **Step 4: Document any local npm blocker**

Local npm was unavailable initially. Node.js/npm were installed through winget, then `electron`, `package-lock.json`, audit fixes, lint, unit tests, e2e tests, audit, and pack were completed.

## Task 6: Visual Polish And Screenshot Audit

**Files:**
- Modify: `electron-control.html`
- Modify: `e2e/app.spec.js`

- [x] **Step 1: Capture baseline screenshots**

Launch the Electron control panel with Playwright and save screenshots for the initial panel plus each settings drawer tab under `artifacts/visual-audit/`.

- [x] **Step 2: Fix control panel overflow**

Ensure the closed settings drawer does not increase `.app-shell` horizontal scroll width, and ensure narrow control windows do not crop button labels.

- [x] **Step 3: Fix cramped release-facing labels**

Use compact visible labels where needed while preserving full descriptive `title` text for the control buttons.

- [x] **Step 4: Align e2e with real UI selectors**

Update Playwright checks to target the actual timer display element (`#controlTime`) so visual smoke tests fail only on real UI regressions.

- [x] **Step 5: Re-capture screenshots and verify**

Re-run the visual screenshot script, compare overflow findings, and run `npm run test:e2e` outside the sandbox because Electron GUI tests need process control.

## Task 7: Control Chrome And Circular Centering Polish

**Files:**
- Modify: `constants.js`
- Modify: `electron-main.js`
- Modify: `electron-control.html`
- Modify: `electron-widget.html`
- Create: `tests/visual-source.test.js`

- [x] **Step 1: Reproduce visual clipping and center drift**

Capture `control`, `widget circle`, and `display circle` screenshots plus DOM metrics under `artifacts/visual-fix-circle/`. Baseline widget digits were offset from the ring center by `dx=+10`, `dy=-13`, while the control panel had only a 4px side inset.

- [x] **Step 2: Give the control window enough visual breathing room**

Raise the default control width to 400px, minimum width to 380px, add a 12px shell safe area, and increase the resize height budget so the rounded glass panel and shadow no longer feel cut off.

- [x] **Step 3: Center positive timer digits**

Change empty `.tm-sign` slots to `width: 0` and reserve sign width only when the sign is present.

- [x] **Step 4: Center circular widget digits independently from status**

Use a 3-row grid in `.center-content` so the time sits on the ring center and the status chip sits below it without pulling the time upward.

- [x] **Step 5: Add source regression coverage**

Add `tests/visual-source.test.js` to guard the control safe area, empty sign-slot behavior, and circular widget centering rules.

- [x] **Step 6: Re-capture screenshots and verify metrics**

Final metrics: control digits `dx=0/dy=0`, widget circle digits `dx=0/dy=0`, display circle digits `dx=0/dy=0`; control panel inset is now 12px horizontally and 35px vertically.

## Task 8: Full Visual Sweep And Release Doc Cleanup

**Files:**
- Create: `scripts/visual-audit.js`
- Modify: `package.json`
- Modify: `electron-control.html`
- Modify: `electron-clock-widget.html`
- Modify: `tests/visual-source.test.js`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/PERFORMANCE.md`
- Modify: `.github/workflows/release.yml`

- [x] **Step 1: Add repeatable visual audit tooling**

Add `npm run visual:audit`, which launches Electron with Playwright, opens control/widget/clock/display windows, captures 40 screenshots, and writes DOM metrics to `artifacts/visual-full-audit/latest/metrics.json`.

- [x] **Step 2: Sweep all major visual surfaces**

Verify control default/min/wide, all drawer tabs, reset modal, widget styles, clock styles, and display styles at min/default/max or 720p/1080p sizes.

- [x] **Step 3: Fix remaining visual polish**

Make the sound drawer row wide enough for "Перерасход" to render fully, and pin circular clock time to the geometric center so date/timezone badges cannot shift it.

- [x] **Step 4: Clean release-facing docs**

Update Electron badges to 42, test counts to 141, and replace docs that advised editing `devTools: true` with the supported `npm run dev` flow.

- [x] **Step 5: Add regression coverage**

Extend visual source tests for clock centering and release docs so Electron 41/production DevTools guidance cannot silently return.

- [x] **Step 6: Verify visual sweep**

`npm run visual:audit` now reports 40 scenarios, 40 PNGs, no viewport overflow, and no center-drift failures. Remaining clip warnings are font/transform/native-control metrics inspected visually.

## Deferred Follow-Ups

- Split `electron-control.html` into focused renderer modules. This is intentionally deferred because it is a broad refactor with high UI regression risk.
- Re-evaluate `build/after-pack.js` license mutation policy with a legal/compliance decision. Do not silently remove it in this remediation pass because release notes currently document the behavior.
- Run full Windows/macOS/Linux smoke checks after the Electron 42 package update lands.

## Final Verification

- [x] Run: `node --test`
- [x] Run lint/build/e2e when `npm` and `node_modules` are available: `npm run lint`, `npm run visual:audit`, `npm run test:e2e`, `npm run pack`
- [x] Confirm `git status --short` contains only intentional files.
- [x] Summarize remaining unverified checks if local npm is still unavailable.
