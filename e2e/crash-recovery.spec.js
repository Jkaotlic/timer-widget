const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { launchApp } = require('./launch');

/**
 * Восстановление после ПАДЕНИЯ — вживую, с убийством процесса.
 *
 * Что покрывалось до этого. `tests/recovery.test.js` проверяет чистые функции:
 * запись файла, чтение, валидацию возраста снимка. Но между ними лежит то, ради
 * чего всё написано: снимок пишется раз в 10 секунд И ТОЛЬКО пока таймер идёт;
 * при чистом выходе `before-quit` его удаляет, предварительно погасив таймер
 * сохранения (иначе тик успевал воссоздать файл после удаления — «фантомное
 * восстановление»); при старте главный процесс проверяет возраст и вливает снимок
 * в контроллер, НЕ запуская отсчёт. Ни одно из этих звеньев не проверял никто.
 *
 * Проверяем обе стороны, потому что поодиночке каждая ничего не доказывает:
 *   1. процесс убит SIGKILL (before-quit не отработал) → время восстановилось;
 *   2. приложение закрыто ЧИСТО → восстанавливать нечего, старт с нуля.
 *
 * Тест по необходимости небыстрый: снимок пишется раз в 10 с, поэтому таймер
 * должен реально прожить этот интервал. Ускорить нельзя — интервал в главном
 * процессе, а подмена его в тесте проверяла бы подменённый код.
 */

const PRESET = 420; // 7:00 — заметное значение, не совпадает ни с одним пресетом кнопок

async function readTimer(control) {
    return control.evaluate(() => ({
        remaining: window.timerController.remainingSeconds,
        total: window.timerController.totalSeconds,
        running: window.timerController.isRunning,
        text: (document.getElementById('controlTimeDigits') || {}).textContent
    }));
}

test('после падения время восстанавливается, после чистого выхода — нет', async () => {
    // Спека длинная по существу (замер 01.09.2026: 25.6 с на быстрой машине
    // при потолке Playwright 30 с). На руннере, который медленнее, она
    // упиралась бы в потолок и падала по времени, ничего не проверив.
    test.setTimeout(120000);
    // --- 1. Ставим таймер и даём ему прожить интервал сохранения ---
    const first = await launchApp();
    await first.control.evaluate((secs) => {
        window.ipcRenderer.send('timer-command', { type: 'reset' });
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: secs });
        window.ipcRenderer.send('timer-command', { type: 'start' });
    }, PRESET);

    // Снимок пишется раз в 10 с и только при isRunning — ждём с запасом.
    await first.control.waitForTimeout(12500);
    const before = await readTimer(first.control);
    expect(before.running, 'таймер должен идти, иначе снимок не пишется').toBe(true);
    expect(before.total).toBe(PRESET);
    expect(before.remaining).toBeLessThan(PRESET);

    // --- 2. Убиваем процесс жёстко: before-quit не отработает ---
    //
    // На Windows убивать один pid НЕЛЬЗЯ: Electron — это дерево процессов
    // (главный, рендереры, GPU), сигналов в привычном смысле там нет, и после
    // убийства одного главного остальные живут. Следующий запуск упирается в
    // single-instance lock, мгновенно выходит, и Playwright видит
    // «electron.launch: WebSocket error: read ECONNRESET» — ровно так этот тест
    // и упал в CI. taskkill с /T гасит всё поддерево.
    const pid = first.app.process().pid;
    if (process.platform === 'win32') {
        try {
            execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { /* процесс мог уже умереть — это не ошибка теста */ }
    } else {
        first.app.process().kill('SIGKILL');
    }
    // Даём операционной системе отпустить блокировку единственного экземпляра.
    await new Promise((r) => setTimeout(r, 4000));

    // --- 3. Поднимаем заново: снимок обязан подхватиться ---
    const second = await launchApp();
    await second.control.waitForTimeout(1500);
    const restored = await readTimer(second.control);

    // ...и пользователь должен об этом УЗНАТЬ. Главный процесс шлёт
    // 'timer-recovery-available' после did-finish-load; слушателя у канала не было
    // ни одного, поэтому на экране просто стояло время, взявшееся ниоткуда.
    const toast = await second.control.evaluate(() => {
        const el = document.querySelector('.toast-container .toast');
        return el ? { text: el.textContent, cls: el.className } : null;
    });
    expect(toast, 'после восстановления панель обязана сказать, откуда взялось время').not.toBeNull();
    expect(toast.text).toContain('восстановлено');
    // В сообщении стоит само время — иначе оно не отличимо от «что-то случилось».
    expect(toast.text).toMatch(/\d{2}:\d{2}/);

    expect(
        restored.total,
        `после падения ожидался пресет ${PRESET}, получено ${JSON.stringify(restored)}`
    ).toBe(PRESET);
    // Остаток восстанавливается тем, каким был на момент последнего снимка:
    // между ним и падением проходит до 10 с, поэтому сверяем окно, а не точку.
    expect(restored.remaining).toBeGreaterThan(PRESET - 25);
    expect(restored.remaining).toBeLessThan(PRESET);
    // Отсчёт НЕ возобновляется сам — приложение показывает, где остановилось.
    expect(restored.running, 'восстановление не должно само запускать таймер').toBe(false);

    // --- 4. Теперь закрываем ЧИСТО и проверяем, что снимка не осталось ---
    await second.control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await second.control.waitForTimeout(500);
    await second.app.close();
    await new Promise((r) => setTimeout(r, 1500));

    const third = await launchApp();
    await third.control.waitForTimeout(1500);
    const afterCleanExit = await readTimer(third.control);
    expect(
        afterCleanExit.total,
        `после чистого выхода восстанавливать нечего, получено ${JSON.stringify(afterCleanExit)}`
    ).not.toBe(PRESET);

    await third.app.close();
});
