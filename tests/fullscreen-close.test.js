'use strict';

/**
 * Полноэкранное окно закрывают, СНАЧАЛА выйдя из полноэкранного режима.
 *
 * Найдено 28.08.2026 по системным отчётам macOS о падениях: одиннадцать из
 * тринадцати за день — один и тот же `EXC_BAD_ACCESS` по адресу
 * 0xefefefefefefeff7 (байт-отравитель освобождённой памяти в аллокаторе
 * Chromium). Поток CrBrowserMain, стек снизу вверх:
 *
 *   _NSExitFullScreenTransitionController _doSucceededToExitFullScreen
 *     → _updateFullScreenPresentationOptionsForInstance
 *       → enumerateWindowsWithOptions → -[NSWindow _adjustWindowToScreen]
 *         → NSNotificationCenter → Electron → обращение к ОСВОБОЖДЁННОМУ окну
 *
 * Что происходит: окно дисплея создаётся `fullscreen: true`, а `close-display`
 * звал `.close()` без оговорок. macOS запускает анимацию выхода из
 * полноэкранного режима на окне, которое Electron в этот момент разрушает, и
 * обходит при этом ВСЕ окна приложения. Падает не окно — падает ПРИЛОЖЕНИЕ,
 * целиком, вместе с идущим таймером.
 *
 * Дефект старше правок того дня: самые ранние отчёты сняты за полтора часа до
 * первой строчки. Он не проявлялся в CI, потому что там один headless-экран, а
 * в живой работе это «закрыл дисплей клавишей D посреди доклада».
 *
 * Проверка source-level: обработчики живут в electron-main.js и в Node не
 * импортируются. Утверждается И наличие правильного поведения, И отсутствие
 * старого — голый `.close()` на полноэкранном окне.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan');

const MAIN = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'electron-main.js'), 'utf8'));

test('окно дисплея по-прежнему открывается полноэкранным', () => {
    // Само-проверка предпосылки: если бы окно перестало быть полноэкранным,
    // весь этот тест сторожил бы несуществующую опасность и был бы зелёным
    // по ложной причине.
    assert.match(MAIN, /fullscreen:\s*!__screenshotMode/,
        'окно дисплея больше не полноэкранное — проверка ниже потеряла смысл');
});

test('закрытие дисплея идёт через ОДНОГО помощника, а не два похожих .close()', () => {
    assert.match(MAIN, /function closeDisplayWindow\(/,
        'нет единого помощника закрытия дисплея');

    // Мест, где окно закрывается, два: команда «закрыть» и смена монитора.
    // Обе обязаны идти одной дорогой — вторая манера закрывать это вторая
    // манера падать.
    const bare = MAIN.match(/displayWindow\.close\(\)/g) || [];
    assert.equal(bare.length, 0,
        `голый displayWindow.close() остался в ${bare.length} месте(ах) — окно закроют полноэкранным`);
    const calls = MAIN.match(/closeDisplayWindow\(/g) || [];
    assert.ok(calls.length >= 3,
        `помощник объявлен, но зовут его ${calls.length - 1} раз(а) вместо двух`);
});

test('помощник выходит из полноэкранного и ЖДЁТ события, а не паузы', () => {
    const at = MAIN.indexOf('function closeDisplayWindow(');
    const body = MAIN.slice(at, MAIN.indexOf('\n}', at));

    assert.match(body, /isFullScreen\(\)/,
        'помощник не спрашивает, полноэкранное ли окно');
    assert.match(body, /setFullScreen\(false\)/,
        'помощник не выводит окно из полноэкранного режима перед закрытием');
    assert.match(body, /once\(\s*'leave-full-screen'/,
        'выход из полноэкранного ждут не по СОБЫТИЮ — пауза это ставка на скорость машины');
    // Страховка обязательна: если событие не придёт, окно всё равно должно
    // закрыться, иначе «защита от падения» превращается в незакрываемое окно.
    assert.match(body, /setTimeout/,
        'нет страховки по времени — не пришло событие, и окно не закроется никогда');
});
