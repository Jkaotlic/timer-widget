'use strict';

/**
 * Выгрузка отчёта о перелимите — весь путь до файла на диске.
 *
 * Что здесь проверяется и почему не unit-тестами. Сборку CSV полностью
 * закрывает `tests/event-report.test.js` (модуль чистый), а запись файла —
 * `tests/electron-main-load.test.js` на подставке. Не закрыто ими одно: доходит
 * ли КЛИК человека до файла. Между кнопкой и диском лежат кнопка панели, канал,
 * белые списки в двух файлах, главный процесс и системный диалог — и любое
 * звено может молча не сработать, оставив оба набора тестов зелёными.
 *
 * Системный диалог подменяется В ГЛАВНОМ ПРОЦЕССЕ (`app.evaluate`): иначе тест
 * требовал бы человека с мышью, то есть не запускался бы на CI вовсе.
 * Подменяется ровно он — файл пишется настоящий, настоящим `fs`, и читается
 * тестом с диска.
 */

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./launch');

/** Разблокировка — ОДНИМ жестом: она смотрит на event.detail. */
async function unlock(control) {
    await control.locator('#panelFooter').click({ clickCount: 3 });
    await expect(control.locator('#floor47Section')).toBeVisible();
}

async function relock(control) {
    await control.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
        stored.floor47Unlocked = false;
        localStorage.setItem('displayExtSettings', JSON.stringify(stored));
    }).catch(() => {});
}

async function openDisplayTab(control) {
    await control.click('.tab-btn[data-tab="display"]');
    await control.waitForTimeout(600);
}

/**
 * Подменить системный диалог сохранения.
 *
 * @returns {Promise<void>}
 */
async function stubSaveDialog(app, filePath) {
    await app.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, filePath);
}

/** Увести таймер в минус ПО-НАСТОЯЩЕМУ: перелимит должен знать главный процесс. */
async function makeOverrun(control, ms = 6000) {
    await control.evaluate(() => window.ipcRenderer.send('timer-command',
        { type: 'set', seconds: 1, allowNegative: true }));
    await control.waitForTimeout(300);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(ms);
}

test('клик по «Выгрузить отчёт» создаёт файл с итогом и строками докладов', async () => {
    const { app, control } = await launchApp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-export-'));
    const target = path.join(dir, 'отчёт.csv');
    try {
        await openDisplayTab(control);
        await unlock(control);
        await control.fill('#overrunPrice', '1000');
        await control.fill('#overrunPeriod', '3');
        await control.fill('#eventTitleInput', 'Открытие сезона');
        await control.waitForTimeout(400);

        await stubSaveDialog(app, target);
        await makeOverrun(control);

        // «Завершить мероприятие» закрывает текущий доклад — именно он и
        // обязан появиться в журнале строкой.
        await control.locator('#eventFinishBtn').click();
        await expect(control.locator('#eventFinish')).toBeVisible();
        await control.locator('#eventFinishConfirm').click();
        await control.waitForTimeout(800);

        await expect(control.locator('#eventExportBtn')).toBeEnabled();
        await control.locator('#eventExportBtn').click();

        await expect.poll(() => fs.existsSync(target), {
            message: 'файл отчёта не появился на диске за отведённое время'
        }).toBe(true);

        const csv = fs.readFileSync(target, 'utf8');
        console.log(`   отчёт:\n${csv.replace(/^/gm, '   | ')}`);

        expect(csv.charCodeAt(0), 'без BOM Excel прочтёт кириллицу как мусор').toBe(0xFEFF);
        expect(csv, 'название мероприятия обязано быть в шапке').toContain('Открытие сезона');
        expect(csv, 'итог обязан быть в отчёте').toContain('Итого');
        expect(csv, 'завершённое мероприятие названо').toContain('Завершено');
        // Строка доклада: номер, время окончания, перелимит.
        expect(csv, 'строки докладов не попали в отчёт').toMatch(/\r\n1;\d{2}:\d{2}:\d{2};00:00:\d{2}/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await control.evaluate(() => {
            window.ipcRenderer.send('timer-command', { type: 'reset' });
            window.ipcRenderer.send('event-reset');
        }).catch(() => {});
        await relock(control);
        await app.close();
    }
});

test('зонд проверяет себя: без подмены диалога файла не появляется', async () => {
    // Без этой пары зелёный тест выше означал бы и «клик дошёл до диска», и
    // «мы случайно прочитали файл, лежавший там раньше». Здесь диалог НЕ
    // подменён — он отвечает отменой (в headless-прогоне окна диалога нет), и
    // файла быть не должно.
    const { app, control } = await launchApp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-export-'));
    const target = path.join(dir, 'не-должен-появиться.csv');
    try {
        await openDisplayTab(control);
        await unlock(control);
        await app.evaluate(({ dialog }) => {
            dialog.showSaveDialog = async () => ({ canceled: true });
        });
        await makeOverrun(control, 4500);

        await control.locator('#eventExportBtn').click();
        await control.waitForTimeout(1500);

        expect(
            fs.existsSync(target),
            'файл появился там, куда его никто не просил класть — зонд не различает исходы'
        ).toBe(false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await control.evaluate(() => {
            window.ipcRenderer.send('timer-command', { type: 'reset' });
            window.ipcRenderer.send('event-reset');
        }).catch(() => {});
        await relock(control);
        await app.close();
    }
});

/** Тумблер — кликом по ползунку: сам чекбокс спрятан вёрсткой. */
async function setToggle(control, id, on) {
    const box = control.locator(`#${id}`);
    if (await box.isChecked() === on) { return; }
    await control.locator(`#${id} + .toggle-slider`).click();
    await expect(box).toBeChecked({ checked: on });
}

/** Строки докладов отчёта — те, что начинаются с номера. */
const numbered = (csv) => csv.split('\r\n').filter((line) => /^\d+;/.test(line));

test('уложившиеся доклады — в отчёте, а фильтр их скрывает', async () => {
    const { app, control } = await launchApp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-export-'));
    const full = path.join(dir, 'все.csv');
    const filtered = path.join(dir, 'с-перелимитом.csv');
    try {
        await openDisplayTab(control);
        await unlock(control);
        await control.fill('#overrunPrice', '1000');
        await control.fill('#overrunPeriod', '3');
        await setToggle(control, 'reportOnlyOverruns', false);

        // Доклад 1 — уложился: запущен, прошла секунда с лишним, сброшен.
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 30 }));
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
        await control.waitForTimeout(1600);
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
        await control.waitForTimeout(400);

        // Доклад 2 — с перелимитом, закрыт «Завершить».
        await makeOverrun(control);
        await control.locator('#eventFinishBtn').click();
        await control.locator('#eventFinishConfirm').click();
        await control.waitForTimeout(800);

        // Без фильтра — оба доклада.
        await stubSaveDialog(app, full);
        await control.locator('#eventExportBtn').click();
        await expect.poll(() => fs.existsSync(full)).toBe(true);
        const all = fs.readFileSync(full, 'utf8');
        console.log(`   без фильтра:\n${all.replace(/^/gm, '   | ')}`);
        const allRows = numbered(all);
        expect(allRows.length, 'без фильтра в отчёте ВСЕ доклады').toBe(2);
        expect(allRows[0], 'уложившийся доклад печатается нулём').toMatch(/^1;\d{2}:\d{2}:\d{2};00:00:00;/);
        expect(all, 'полный отчёт не несёт оговорки о фильтре').not.toContain('Показаны;');

        // С фильтром — только доклад с перелимитом, и отчёт об этом говорит.
        await setToggle(control, 'reportOnlyOverruns', true);
        await control.waitForTimeout(300);
        await stubSaveDialog(app, filtered);
        await control.locator('#eventExportBtn').click();
        await expect.poll(() => fs.existsSync(filtered)).toBe(true);
        const only = fs.readFileSync(filtered, 'utf8');
        console.log(`   с фильтром:\n${only.replace(/^/gm, '   | ')}`);
        const onlyRows = numbered(only);
        expect(onlyRows.length, 'фильтр оставляет только доклады с перелимитом').toBe(1);
        expect(onlyRows[0], 'номер доклада фильтр не меняет').toMatch(/^2;/);
        expect(only).toContain('Показаны;только доклады с перелимитом');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        // Профиль e2e общий на прогон: фильтр возвращается к УМОЛЧАНИЮ.
        await control.evaluate(() => {
            const stored = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            stored.reportOnlyOverruns = false;
            localStorage.setItem('displayExtSettings', JSON.stringify(stored));
            window.ipcRenderer.send('timer-command', { type: 'reset' });
            window.ipcRenderer.send('event-reset');
        }).catch(() => {});
        await relock(control);
        await app.close();
    }
});
