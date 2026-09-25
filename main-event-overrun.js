'use strict';

/**
 * main-event-overrun.js — накопитель перелимита мероприятия (скрытый режим
 * «47-й этаж»): доклады, журнал, выход и сбой посреди доклада, выгрузка CSV и
 * каналы «Завершить» / «Новое мероприятие» / «Выгрузить».
 *
 * Всё состояние накопителя живёт ЗДЕСЬ и только здесь: каналы, которые его
 * меняют, зарегистрированы этим же модулем, а наружу уходят функции, а не
 * переменные. Хранилище на диске — event-overrun-store.js, арифметика денег —
 * money-meter.js, сборка CSV — event-report.js (все три чистые).
 *
 * Модуль не требует electron: окна, диалог и путь к профилю приходят
 * параметрами.
 */

const fs = require('fs');
const path = require('path');
const MoneyMeter = require('./money-meter');
const OverrunStore = require('./event-overrun-store');
const EventReport = require('./event-report');

/** Покой: остаток равен тоталу, таймер не идёт и не на паузе. Так выглядят и сброс, и новый пресет. */
function isAtRest(state) {
    return !!state && !state.isRunning && !state.isPaused && !state.finished
        && Number(state.remainingSeconds) === Number(state.totalSeconds);
}

/**
 * @param {object} deps
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.relay — память ретрансляторов (main-state.js): ставка,
 *        период и название мероприятия лежат в lastDisplaySettings
 * @param {() => object} deps.getTimerState — зеркало состояния таймера
 * @param {Function} deps.safelySendToWindow
 * @param {object} deps.log
 * @param {() => string} deps.getUserDataPath — app.getPath('userData')
 * @param {object} deps.dialog — electron.dialog (метод зовётся на объекте:
 *        e2e подменяет showSaveDialog прямо на нём)
 */
function createEventOverrun({ windows, relay, getTimerState, safelySendToWindow, log, getUserDataPath, dialog }) {
    /**
     * Накопитель перелимита мероприятия — скрытый режим «47-й этаж».
     *
     * Здесь лежит единственная величина, которую нельзя пересчитать заново:
     * секунды перелимита ЗАКРЫТЫХ докладов. Текущий перелимит в неё не входит —
     * его дисплей считает сам из remainingSeconds, иначе одна и та же секунда
     * оказалась бы посчитана дважды.
     *
     * `liveOverrunSeconds` — сколько секунд текущий доклад успел пробыть в
     * минусе. Как только таймер выходит из минуса, эта величина ПЕРЕЕЗЖАЕТ в
     * накопитель, и общая сумма при этом не дёргается: у дисплея из неё уходит
     * ровно столько, сколько приходит.
     */
    let eventOverrun = { overrunSeconds: 0, finished: false, talks: [] };
    let liveOverrunSeconds = 0;

    /**
     * Отсечка текущего минуса — сколько секунд перелимита уже натикало к моменту
     * «Нового мероприятия».
     *
     * Без неё обнуление накопителя не очищало экран (жалоба 27.08.2026 «нельзя
     * скинуть итог»): накопитель становился нулём, а дисплей прибавлял к нему
     * текущий перелимит, потому что таймер всё ещё был в минусе. Отсечка гасит и
     * «Перелимит», и «Итого» — новое мероприятие начинается с чистого листа.
     *
     * Снимается сама, как только таймер выходит из минуса: следующий доклад
     * считается целиком.
     */
    let excludedLiveSeconds = 0;

    /**
     * ОДНА сборка payload накопителя на все отправки.
     *
     * Была не одна: рассылка добавляла отсечку, а гидратация окна дисплея слала
     * голый `eventOverrun` — и окно, переоткрытое посреди мероприятия, показывало
     * сумму, которую «Новое мероприятие» уже стёрло. Ровно тот случай, про который
     * записано «перед добавлением поля в payload соберите payload в одном месте».
     */
    function eventOverrunPayload() {
        // Панели уходит СЧЁТЧИК записей, а не сам журнал: он бывает на пятьсот
        // строк, а рассылается это состояние каждую секунду. Всё, что панели нужно
        // от журнала, — знать, есть ли что выгружать; сам отчёт собирает главный
        // процесс, у которого журнал и лежит.
        return Object.assign(
            { excludedLiveSeconds, talksCount: eventOverrun.talks.length },
            eventOverrun,
            { talks: undefined }
        );
    }

    /**
     * Адресатов два, и знают они РАЗНОЕ.
     *
     * Дисплей показывает деньги залу. Панель деньги не показывает — она
     * отчитывается оператору строкой «Идёт · итог …» / «Завершено · итог
     * заморожен: …», потому что нажимает кнопки мероприятия он, а сумму до
     * 28.08.2026 читал с проекционного экрана. Второго места, где живёт накопитель,
     * при этом не заводится: панель ничего не хранит и не пишет — она получает
     * состояние и собирает из него ту же сводку, что дисплей.
     */
    function broadcastEventOverrun() {
        safelySendToWindow(windows.displayWindow, 'event-overrun-state', eventOverrunPayload());
        safelySendToWindow(windows.controlWindow, 'event-overrun-state', eventOverrunPayload());
    }

    function persistEventOverrun() {
        OverrunStore.saveStore(getUserDataPath(), eventOverrun, log);
    }

    /**
     * Учёт перелимита на каждом тике состояния таймера.
     *
     * Доклад «закрывается» при ЛЮБОМ выходе таймера из минуса: сброс, установка
     * нового времени, применение пресета. Отдельного сигнала «доклад кончился» в
     * приложении нет, и заводить его не нужно — выход из минуса и есть он.
     *
     * После завершения мероприятия накопитель заморожен: перелимиты в него больше
     * не идут, пока не начато новое.
     */
    /**
     * Текущий доклад: шёл ли таймер, прошла ли хоть секунда, сколько перелимита
     * доклад уже набрал.
     *
     * Отдельного сигнала «доклад начался / кончился» в приложении нет, и заводить
     * его не нужно: конец доклада — это возврат ЗАПУЩЕННОГО таймера в покой. Сброс
     * и новый пресет дают одно и то же состояние (см. isAtRest). Пресет, который
     * поставили и не запускали, докладом не считается — иначе журнал наполнялся бы
     * строками от перебора пресетов; старт и тут же сброс — тоже, секунда не прошла.
     *
     * Перелимит копится ЗДЕСЬ, а не пишется в журнал сразу при выходе из минуса:
     * время можно добавить прямо в перелимите, таймер выйдет из минуса, а доклад
     * продолжится. Одна запись на доклад, её перелимит — сумма.
     *
     * `skip` — доклад, шедший в момент «Нового мероприятия»: к новому он не
     * относится, по тому же принципу, что и отсечка минуса (excludedLiveSeconds).
     */
    function freshTalk() {
        return { active: false, elapsed: false, overrun: 0, skip: false };
    }
    let currentTalk = freshTalk();

    function trackTalk(state) {
        if (state.isRunning) { currentTalk.active = true; }
        if (currentTalk.active && Number(state.remainingSeconds) < Number(state.totalSeconds)) {
            currentTalk.elapsed = true;
        }
    }

    /**
     * Дописать закрытый доклад в журнал.
     *
     * Зовётся из ДВУХ мест — тика (доклад вышел из минуса) и «Завершить
     * мероприятие», — и потому существует отдельно: два экземпляра этой арифметики
     * разошлись бы номерами.
     *
     * Потолок тот же, что в хранилище: журнал пишется на диск синхронно. Итог при
     * обрезке не страдает — он живёт отдельным числом.
     */
    function appendTalk(seconds) {
        // Ноль — законная запись: доклад уложился в срок.
        const overrun = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
        const talks = eventOverrun.talks.concat([{
            n: eventOverrun.talks.length + 1,
            endedAt: new Date().toISOString(),
            overrunSeconds: overrun
        }]);
        return talks.slice(-OverrunStore.MAX_TALKS).map((talk, i) => ({
            n: i + 1,
            endedAt: talk.endedAt,
            overrunSeconds: talk.overrunSeconds
        }));
    }

    /**
     * Получит ли текущий доклад строку журнала, если закрыть его сейчас.
     *
     * ОДНО условие на всех, кто закрывает доклад не выходом из минуса:
     * «Завершить мероприятие», выход из приложения, сбой и черновая строка
     * выгрузки. Копии этого условия разошлись бы, и отчёт перестал бы сходиться
     * с итогом по-разному в каждом из путей.
     */
    function currentTalkRecordable() {
        return !eventOverrun.finished && !currentTalk.skip
            && (currentTalk.elapsed || liveOverrunSeconds > 0);
    }

    /**
     * Выход из приложения посреди доклада (BUG-04).
     *
     * Живой перелимит лежит только в памяти — в накопитель он переезжает, когда
     * таймер выходит из минуса. Выход посреди перелимита терял его целиком: итог,
     * объявленный залу, после перезапуска оказывался меньше. Здесь доклад
     * закрывается так же, как «Завершить мероприятие», но итог НЕ замораживается.
     *
     * Закрывается ОДИН раз: пока приложение доделывает выход, таймер тикает
     * дальше, а before-quit бывает повторным (app.quit() из страховки, второй
     * выход) — строка журнала уже записана, и секунды после неё в отчёте
     * повисли бы без строки. Текущий минус заодно отсекается, как «Новым
     * мероприятием», чтобы дисплей до закрытия не прибавлял их к итогу.
     */
    let talkClosedOnQuit = false;
    function closeTalkOnQuit() {
        if (talkClosedOnQuit) { return; }
        talkClosedOnQuit = true;
        const record = currentTalkRecordable();
        if (!record && liveOverrunSeconds <= 0) { return; }
        eventOverrun = Object.assign({}, eventOverrun, {
            overrunSeconds: eventOverrun.overrunSeconds + liveOverrunSeconds,
            talks: record ? appendTalk(currentTalk.overrun + liveOverrunSeconds) : eventOverrun.talks
        });
        liveOverrunSeconds = 0;
        excludedLiveSeconds = MoneyMeter.overrunSeconds(getTimerState().remainingSeconds);
        currentTalk = Object.assign(freshTalk(), { active: true, skip: true });
        persistEventOverrun();
    }

    /**
     * Сбой посреди перелимита (BUG-04): живые секунды — на диск, в поле
     * `pending`, итог в памяти не трогаем.
     *
     * Сложить их в итог здесь нельзя: после uncaughtException процесс может жить
     * дальше, и конец доклада посчитал бы те же секунды второй раз. Следующий
     * запуск складывает pending ровно один раз (OverrunStore.foldPending), а
     * любая штатная запись до того просто его перезаписывает — секунды к тому
     * моменту ещё в памяти.
     */
    function persistPendingOverrun() {
        if (liveOverrunSeconds <= 0 || eventOverrun.finished) { return; }
        const pending = {
            liveSeconds: liveOverrunSeconds,
            talkSeconds: currentTalkRecordable() ? currentTalk.overrun + liveOverrunSeconds : null,
            endedAt: new Date().toISOString()
        };
        OverrunStore.saveStore(getUserDataPath(), Object.assign({}, eventOverrun, { pending }), log);
    }

    function accrueOverrun(state) {
        trackTalk(state);
        // Считается перелимит ЗА ВЫЧЕТОМ отсечки: секунды, натикавшие до «Нового
        // мероприятия», к нему не относятся.
        const live = MoneyMeter.liveOverrun(state.remainingSeconds, excludedLiveSeconds);
        if (live > 0) {
            liveOverrunSeconds = eventOverrun.finished ? 0 : live;
            return;
        }
        // Таймер вышел из минуса — отсечка своё отработала, следующий доклад
        // считается целиком.
        if (excludedLiveSeconds > 0 && MoneyMeter.overrunSeconds(state.remainingSeconds) <= 0) {
            excludedLiveSeconds = 0;
            broadcastEventOverrun();
        }

        let changed = false;
        if (liveOverrunSeconds > 0) {
            // Итог растёт СРАЗУ — он виден на экране. Доклад же свой перелимит
            // только копит: запись о нём появится, когда он кончится.
            eventOverrun = Object.assign({}, eventOverrun, {
                overrunSeconds: eventOverrun.overrunSeconds + liveOverrunSeconds
            });
            currentTalk.overrun += liveOverrunSeconds;
            // Перелимит без запущенного доклада невозможен; помечаем явно, чтобы
            // секунды итога никогда не остались без строки в журнале.
            currentTalk.active = true;
            currentTalk.elapsed = true;
            liveOverrunSeconds = 0;
            changed = true;
        }
        if (currentTalk.active && isAtRest(state)) {
            if (currentTalk.elapsed && !currentTalk.skip && !eventOverrun.finished) {
                eventOverrun = Object.assign({}, eventOverrun, { talks: appendTalk(currentTalk.overrun) });
                changed = true;
            }
            currentTalk = freshTalk();
        }
        if (!changed) { return; }
        persistEventOverrun();
        broadcastEventOverrun();
    }

    /**
     * Накопитель мероприятия читается ДО открытия окон: гидратация окна
     * дисплея снимает ему уже прочитанное значение.
     */
    function loadOnStart() {
        eventOverrun = OverrunStore.loadStore(getUserDataPath(), log);
    }

    /**
     * Живой перелимит, записанный при сбое (BUG-04), — в итог ровно один раз.
     * Поднятый в минусе таймер продолжает прерванный доклад: его минус уже
     * в итоге и становится отсечкой, а строку журнала допишет конец доклада.
     *
     * @param {number|null} restoredRemaining — остаток восстановленного таймера,
     *        null — восстановления не было
     */
    function foldPendingOnStart(restoredRemaining) {
        const folded = OverrunStore.foldPending(eventOverrun, { restoredRemaining });
        eventOverrun = folded.store;
        if (folded.resumed) {
            excludedLiveSeconds = folded.excludedLiveSeconds;
            currentTalk = folded.resumeTalk
                ? Object.assign(freshTalk(), { active: true, elapsed: true, overrun: folded.resumeTalk.overrun })
                : Object.assign(freshTalk(), { active: true, skip: true });
        }
        if (folded.changed) { persistEventOverrun(); }
    }

    function registerIpc(ipcMain) {
        // Завершить мероприятие принудительно: закрыть текущий перелимит и заморозить
        // итог. Полезной нагрузки нет — это ДЕЙСТВИЕ, а не настройка: величину знает
        // главный процесс, и присланная окном спорила бы с ней.
        ipcMain.on('event-finish', () => {
            // Последний доклад тоже запись: иначе он окажется в итоге, но не в
            // разбивке, и суммы в отчёте разойдутся без всякой причины. Записывается
            // он, только если шёл, — завершение из покоя доклада не выдумывает.
            const record = currentTalkRecordable();
            eventOverrun = {
                overrunSeconds: eventOverrun.overrunSeconds + liveOverrunSeconds,
                finished: true,
                talks: record ? appendTalk(currentTalk.overrun + liveOverrunSeconds) : eventOverrun.talks
            };
            liveOverrunSeconds = 0;
            currentTalk = freshTalk();
            persistEventOverrun();
            broadcastEventOverrun();
        });

        // Выгрузить отчёт о перелимите файлом.
        //
        // Payload нет: и журнал, и итог живут ЗДЕСЬ, а ставка с названием мероприятия
        // приходят в `lastDisplaySettings` тем же каналом, что и остальные настройки
        // дисплея. Присланные окном значения спорили бы с этими — и отчёт разошёлся бы
        // с тем, что показано на экране.
        //
        // Ответ обязателен в любом исходе. Кнопка, после которой ничего не происходит
        // и ничего не сказано, читается как сломанное окно; молчаливый выход в этом
        // проекте уже стоил отдельной сессии разбора.
        //
        // Ответ — ОДИН и только панели (BUG-17). Канал шлёт лишь панель (SEC-07), так
        // что «ответить ещё и спросившему» значило ответить ей дважды — два тоста.
        //
        // Диалог — дочерний окну панели и один: без родителя он уходил за окна и не
        // блокировал панель, и каждый клик открывал ещё один. Повтор, пока диалог
        // открыт, проглатывается без ответа — ответит тот, первый.
        let eventExportBusy = false;
        ipcMain.on('event-export', async () => {
            if (eventExportBusy) { return; }
            eventExportBusy = true;
            const answer = (payload) => {
                safelySendToWindow(windows.controlWindow, 'event-export-done', payload);
            };

            try {
                const settings = relay.lastDisplaySettings || {};
                const report = EventReport.buildReportCSV({
                    talks: eventOverrun.talks,
                    // Итог берётся тот же, что показан на экране: накопленное плюс
                    // текущий минус, если мероприятие ещё идёт.
                    overrunSeconds: MoneyMeter.totalSeconds(
                        eventOverrun.overrunSeconds,
                        eventOverrun.finished ? 0 : getTimerState().remainingSeconds,
                        excludedLiveSeconds
                    ),
                    finished: eventOverrun.finished,
                    title: settings.eventTitle,
                    price: settings.overrunPrice,
                    period: settings.overrunPeriod,
                    // Фильтр — такая же настройка дисплея, как ставка: у просьбы о
                    // выгрузке payload нет, и отдельного источника у него быть не должно.
                    onlyOverruns: settings.reportOnlyOverruns === true,
                    // Идущий доклад — строкой «идёт» (BUG-15): его перелимит уже в
                    // итоге выше, и без строки отчёт посреди доклада всегда кончался
                    // ложным «журнал обрезан». Условие строки — то же, что у закрытия.
                    current: currentTalkRecordable()
                        ? { overrunSeconds: currentTalk.overrun + liveOverrunSeconds }
                        : null,
                    now: new Date()
                });

                const stamp = new Date().toISOString().slice(0, 10);
                const result = await dialog.showSaveDialog(windows.controlWindow, {
                    title: 'Сохранить отчёт о перелимите',
                    defaultPath: `перелимит-${stamp}.csv`,
                    filters: [{ name: 'CSV', extensions: ['csv'] }]
                });

                if (!result || result.canceled || !result.filePath) {
                    answer({ ok: false, canceled: true });
                    return;
                }

                fs.writeFileSync(result.filePath, report.csv, 'utf8');
                // В журнал — только ИМЯ файла (SEC-11): полный путь почти всегда содержит
                // имя учётной записи, а журнал уходит в поддержку и на сканер ПСИ.
                log.info(`[export] отчёт записан: ${path.basename(result.filePath)} (${report.rows} строк)`);
                answer({ ok: true, canceled: false, path: result.filePath, rows: report.rows });
            } catch (err) {
                // Сообщение fs несёт путь целиком («ENOENT: …, open '/Users/<имя>/…'»),
                // поэтому в журнал — только код ошибки. Полный текст уходит в панель:
                // он нужен человеку, который выбирал этот путь сам.
                log.error(`[export] отчёт не записан: ${(err && (err.code || err.name)) || 'ошибка'}`);
                answer({ ok: false, canceled: false, error: (err && err.message) || String(err) });
            } finally {
                eventExportBusy = false;
            }
        });

        // Начать новое мероприятие: обнулить накопитель. Необратимо — подтверждение
        // спрашивает панель, здесь его повторять негде.
        ipcMain.on('event-reset', () => {
            eventOverrun = { overrunSeconds: 0, finished: false, talks: [] };
            liveOverrunSeconds = 0;
            // Текущий минус к новому мероприятию не относится — отсекаем его целиком,
            // иначе на экране осталась бы прежняя сумма.
            excludedLiveSeconds = MoneyMeter.overrunSeconds(getTimerState().remainingSeconds);
            // И текущий ДОКЛАД к нему не относится по тому же принципу. Из покоя
            // «Новое мероприятие» ничего не отсекает: следующий доклад — уже его.
            currentTalk = Object.assign(freshTalk(), {
                active: !isAtRest(getTimerState()),
                skip: !isAtRest(getTimerState())
            });
            persistEventOverrun();
            broadcastEventOverrun();
        });
    }

    return {
        eventOverrunPayload, broadcastEventOverrun, accrueOverrun,
        closeTalkOnQuit, persistPendingOverrun, loadOnStart, foldPendingOnStart, registerIpc
    };
}

module.exports = { createEventOverrun, isAtRest };
