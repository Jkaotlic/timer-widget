'use strict';

/**
 * main-window-closing.js — закрывающееся окно и отложенное открытие.
 *
 * Правило (docs/lessons.md, «A closing window is not an open window»):
 * «открыть» спрашивает не «есть ли объект», а «будет ли он жив»; отложенное
 * открытие — ОДИН реестр на все окна; метку закрытия ставят и пути мимо IPC,
 * включая трей. Всё это — здесь, в одном месте; обработчики каналов и трей
 * только зовут эти функции.
 *
 * Модуль не требует electron: окна и их события приходят объектами.
 */

/**
 * Сколько ждать выхода из полноэкранного режима, прежде чем закрывать окно
 * (или выходить из приложения) всё равно. Пользователей два — закрытие
 * дисплея и `before-quit` (main-lifecycle.js), поэтому константа
 * экспортируется, а не повторяется.
 */
const FULLSCREEN_EXIT_TIMEOUT_MS = 2000;

/**
 * Страховка отложенного открытия: сколько ждать события `closed`, прежде чем
 * открыть окно всё равно.
 *
 * Та же логика, что у страховки выхода из полноэкранного режима: защита,
 * превращающая окно в НЕоткрываемое, хуже той беды, от которой защищались.
 */
const WINDOW_REOPEN_TIMEOUT_MS = 3000;

/**
 * @param {object} deps
 * @param {object} deps.windows — реестр окон (main-state.js)
 */
function createWindowClosing({ windows }) {
    /**
     * Отложенные открытия окон: ключ окна → чем его создать, когда старое уйдёт.
     *
     * Зачем это вообще нужно. Окно закрывается не мгновенно: `close()` разрушает
     * его сразу, а событие `closed` — то, что обнуляет ссылку здесь, в главном
     * процессе, — приходит следующим оборотом цикла (у полноэкранного дисплея
     * зазор ещё длиннее: сначала выход из полноэкранного режима). Команда
     * «открыть», попавшая в этот зазор, видела живую ссылку, считала окно
     * работающим и уходила в `focus()`. Потом закрытие доводилось до конца, и окна
     * не оставалось совсем.
     *
     * Замерено 09.09.2026 на всех трёх окнах: `close` и `open` без паузы между
     * ними оставляли приложение с одним окном — панелью. Сценарий человеческий:
     * нажать клавишу закрытия и тут же клавишу открытия.
     *
     * Владелец у отложенного открытия ОДИН, поэтому здесь Map, а не флаг на
     * каждое окно: два запроса «открыть», пришедшие пока окно закрывается, обязаны
     * дать ОДНО окно. Второе стало бы неуправляемым — ссылка (`widgetWindow` и
     * прочие) указывает только на последнее созданное.
     */
    const pendingOpens = new Map();

    /** Пометить окно закрывающимся. Ставится ВЕЗДЕ, где зовётся close(). */
    function markClosing(win) {
        if (win && !win.isDestroyed()) { win._closing = true; }
        return win;
    }

    /** Окно, которое можно показать: оно есть, не закрывается и не разрушено. */
    function isUsableWindow(win) {
        return !!win && !win._closing && !win.isDestroyed();
    }

    /**
     * Запланировать открытие окна на момент, когда закрывающееся уйдёт.
     *
     * @param {string} key — какое окно ('widget' | 'clock' | 'display')
     * @param {object|null} closing — закрывающееся окно; null, если запрос просто
     *        присоединяется к уже запланированному
     * @param {Function} create — чем создать новое окно
     * @returns {boolean} true — запланировано, звонящий обязан выйти
     */
    function queueOpenAfterClose(key, closing, create) {
        // Уже запланировано: последний запрос побеждает — пока окно закрывалось,
        // человек мог выбрать другой монитор.
        if (pendingOpens.has(key)) {
            pendingOpens.set(key, create);
            return true;
        }
        if (!closing) { return false; }

        pendingOpens.set(key, create);
        const run = () => {
            // Пусто — значит пришла команда «закрыть»: человек передумал.
            if (!pendingOpens.has(key)) { return; }
            const make = pendingOpens.get(key);
            pendingOpens.delete(key);
            make();
        };
        closing.once('closed', run);
        setTimeout(run, WINDOW_REOPEN_TIMEOUT_MS);
        return true;
    }

    /** Отменить отложенное открытие: «закрыть» отменяет «открыть». */
    function cancelQueuedOpen(key) { pendingOpens.delete(key); }

    /**
     * Закрыть окно дисплея БЕЗОПАСНО: сперва выйти из полноэкранного режима.
     *
     * Найдено 28.08.2026 по системным отчётам macOS: одиннадцать падений из
     * тринадцати за день — один и тот же `EXC_BAD_ACCESS` по адресу
     * 0xefefefefefefeff7, то есть обращение к освобождённой памяти. Стек снизу
     * вверх:
     *
     *   _doSucceededToExitFullScreen → _updateFullScreenPresentationOptions
     *     → enumerateWindows → -[NSWindow _adjustWindowToScreen]
     *       → NSNotificationCenter → Electron → уже освобождённое окно
     *
     * Окно дисплея создаётся `fullscreen: true`, а закрывали его голым `.close()`.
     * macOS запускает анимацию выхода из полноэкранного режима на окне, которое
     * Electron в этот момент разрушает, и обходит при этом ВСЕ окна приложения.
     * Падало не окно — падало приложение целиком, вместе с идущим таймером.
     *
     * Поэтому: выйти из полноэкранного, ДОЖДАТЬСЯ события `leave-full-screen` и
     * только потом закрывать. Ждать паузой нельзя — длительность анимации зависит
     * от машины и нагрузки; ровно на этом сгорела первая попытка починить то же
     * самое в тестах.
     *
     * Страховка по времени обязательна и закреплена тестом: не пришло событие —
     * окно всё равно закрывается. Защита от падения, превращающая окно в
     * незакрываемое, хуже падения.
     */
    function closeDisplayWindow() {
        const win = windows.displayWindow;
        if (!win || win.isDestroyed()) { return; }
        // Второе нажатие «закрыть» посреди перехода — это тот же выстрел в то же
        // окно: `isFullScreen()` к тому моменту уже false, а обход окон системой
        // ещё идёт, и голый close() снова попал бы в середину. Метка на окне, а не
        // переменная модуля: окон дисплея за жизнь приложения много.
        if (win._closingFullScreen) { return; }
        // Метка «этому окну жить осталось недолго» ставится ВО ВСЕХ ветках, включая
        // мгновенную: `close()` возвращает управление сразу, а событие `closed`
        // приходит следующим оборотом цикла. Между ними ссылка `displayWindow` ещё
        // указывает на окно, и без метки команда «открыть» приняла бы его за
        // работающее (см. обработчик `open-display`).
        win._closing = true;
        if (!win.isFullScreen()) {
            win.close();
            return;
        }
        win._closingFullScreen = true;

        let done = false;
        const finish = () => {
            if (done) { return; }
            done = true;
            if (!win.isDestroyed()) { win.close(); }
        };
        const timer = setTimeout(finish, FULLSCREEN_EXIT_TIMEOUT_MS);
        win.once('leave-full-screen', () => {
            clearTimeout(timer);
            // Ещё один оборот цикла событий: `leave-full-screen` приходит в начале
            // завершения перехода, а обход окон системой идёт следом за ним.
            setTimeout(finish, 120);
        });
        win.setFullScreen(false);
    }

    return { markClosing, isUsableWindow, queueOpenAfterClose, cancelQueuedOpen, closeDisplayWindow };
}

module.exports = { createWindowClosing, FULLSCREEN_EXIT_TIMEOUT_MS, WINDOW_REOPEN_TIMEOUT_MS };
