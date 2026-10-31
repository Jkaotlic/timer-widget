const { test, expect } = require('./fixtures');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchApp, USER_DATA_DIR } = require('./launch');
const { panelRoundTrip } = require('./window-ready');

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

const SNAPSHOT_FILE = path.join(USER_DATA_DIR, 'last-state.json');

/** Снимок восстановления на диске (recovery.js) или null. */
function readSnapshot() {
    try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { return null; }
}

/**
 * Запуск, который ждёт, пока прежний экземпляр ОТПУСТИТ блокировку
 * единственного экземпляра (было: сон 4000 / 1500 мс «дать ОС отпустить»).
 * Условие — сам запуск: второй экземпляр при занятой блокировке выходит сразу,
 * и Playwright видит обрыв (`ECONNRESET`, «Process failed to launch»). Повтор
 * до срока; неудача по сроку — последняя ошибка.
 */
async function launchWhenLockFree(timeout = 30000) {
    const deadline = Date.now() + timeout;
    for (let attempt = 1; ; attempt++) {
        try {
            return await launchApp();
        } catch (err) {
            if (Date.now() > deadline) { throw err; }
            console.log(`   запуск ${attempt} не удался (${String(err.message).split('\n')[0]}) — блокировка ещё занята?`);
        }
    }
}

/** Процесс прежнего экземпляра завершился (событие `exit` или уже мёртв). */
function exited(child) {
    if (child.exitCode !== null || child.signalCode !== null) { return Promise.resolve(); }
    return new Promise((resolve) => child.once('exit', () => resolve()));
}

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
    // --- 1. Ставим таймер и даём ему прожить интервал сохранения ---
    const startedAt = Date.now();
    const first = await launchApp();
    await first.control.evaluate((secs) => {
        window.ipcRenderer.send('timer-command', { type: 'reset' });
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: secs });
        window.ipcRenderer.send('timer-command', { type: 'start' });
    }, PRESET);

    // Снимок пишется раз в 10 с и только при isRunning (было: пауза 12500 мс
    // «с запасом»). Ждём сам снимок, нужный проверке: свежий, наш пресет, идёт,
    // и остаток уже меньше пресета — то есть записан ТИКОМ интервала, а не
    // командой `start` (та пишет полный остаток).
    await expect.poll(() => {
        const snap = readSnapshot();
        return !!snap && snap.savedAt >= startedAt && snap.totalSeconds === PRESET
            && snap.isRunning === true && snap.remainingSeconds < PRESET;
    }, { message: `снимок восстановления с идущим таймером не появился в ${SNAPSHOT_FILE}`, timeout: 25000 }).toBe(true);
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
    await exited(first.app.process());

    // --- 3. Поднимаем заново: снимок обязан подхватиться ---
    const second = await launchWhenLockFree();
    // Восстановление main вливает в контроллер ДО окна, а сообщение шлёт по
    // `did-finish-load` панели (было: пауза 1500 мс). Ждём тост; не пришёл —
    // решают утверждения ниже со своими сообщениями.
    await second.control.waitForSelector('.toast-container .toast', { timeout: 10000 }).catch(() => {});
    await panelRoundTrip(second.control);
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
    // main обработал сброс (было 500 мс): посылки панели он берёт по порядку.
    await panelRoundTrip(second.control);
    await second.app.close();

    const third = await launchWhenLockFree();
    // Восстановление — синхронно на старте main, до окна панели; состояние
    // панель получает по загрузке. Круг панели после стартовой рассылки
    // (launchApp) доказывает, что всё посланное main на старте отработано
    // (было: пауза 1500 мс).
    await panelRoundTrip(third.control);
    const afterCleanExit = await readTimer(third.control);
    expect(
        afterCleanExit.total,
        `после чистого выхода восстанавливать нечего, получено ${JSON.stringify(afterCleanExit)}`
    ).not.toBe(PRESET);

    await third.app.close();
});
