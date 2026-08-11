'use strict';

/**
 * onboarding.js — первое знакомство и ссылка на релизы.
 *
 * Два маленьких, ничем не связанных с TimerController поведения панели:
 *
 *   1. Подсказка при первом запуске. Приложение управляется горячими клавишами
 *      (Space, R, 1—8, W/C/D) и Ctrl+колесом, но открывается пустым: узнать об
 *      этом было неоткуда, кроме как нажать F1, о котором тоже нигде не
 *      сказано. Полоска controlsHint существует только на полноэкранном окне,
 *      то есть в режиме, до которого ещё надо добраться.
 *
 *   2. «Проверить обновления». Это ССЫЛКА, а не запрос: приложение не ходит в
 *      сеть само (CSP `connect-src 'self'`, автообновлятель запрещён релизным
 *      гейтом). Кнопка просит main-процесс открыть страницу релизов в браузере
 *      пользователя. Адрес живёт КОНСТАНТОЙ в main и сюда не передаётся —
 *      канал умеет только «открой», но не «открой ЧТО»: shell.openExternal с
 *      URL из рендерера означал бы выполнение произвольного адреса руками ОС.
 *
 * Почему отдельным файлом, а не строчками в панели: inline-скрипт
 * electron-control.html упирается в потолок, который стережёт
 * tests/control-decomposition.test.js. Потолок сработал ровно на этой правке —
 * и это правильный исход, а не помеха: правило проекта гласит «трогаешь
 * самодостаточный блок — выноси его», и обе функции ниже самодостаточны
 * полностью (ни `this`, ни доступа к контроллеру).
 *
 * Зависимости передаются аргументами, а не берутся из глобалей, поэтому модуль
 * проверяется в Node на поддельных document/localStorage — как
 * settings-schema.js и window-geometry.js.
 */

(function (root) {
    /**
     * Показывает подсказку про F1 ровно один раз за профиль.
     *
     * @param {object} deps
     *   - storage : { getItem, setItem } — обычно localStorage
     *   - notify  : (text) => void — обычно Toast.show
     *   - schedule: (fn, ms) => void — обычно setTimeout
     *   - storageKey: имя флага в хранилище. Имя ПАРАМЕТРА выбрано не
     *                произвольно: реестр ключей в tests/storage-keys.test.js
     *                умеет засчитывать ключ, переданный модулю именно под этим
     *                именем (так же устроена геометрия окон). Пример здесь не
     *                приводится намеренно — тот сканер читает и комментарии,
     *                и выдуманное имя в примере он засчитал бы как настоящий
     *                ключ, которого нет в реестре.
     * @returns {boolean} показали ли подсказку в этот раз
     */
    function showFirstRunHint(deps) {
        const storage = deps && deps.storage;
        const notify = deps && deps.notify;
        const schedule = (deps && deps.schedule) || ((fn) => fn());
        const key = (deps && deps.storageKey) || 'onboardingShown';
        const delayMs = (deps && deps.delayMs) !== undefined ? deps.delayMs : 1200;

        if (!storage || typeof notify !== 'function') { return false; }

        try {
            if (storage.getItem(key)) { return false; }
            // Флаг ставится ДО показа, а не после: перезапуск, случившийся в
            // течение задержки, иначе показал бы подсказку второй раз — а
            // обещание «ровно один раз» перестало бы быть правдой именно у тех
            // пользователей, у кого приложение падает.
            storage.setItem(key, '1');
        } catch {
            // Приватный режим или переполненное хранилище. Подсказка не
            // критична: молча пропускаем. Падать из-за неё приложение не должно.
            return false;
        }

        schedule(() => { notify('F1 — список горячих клавиш'); }, delayMs);
        return true;
    }

    /**
     * Вешает на кнопку открытие страницы релизов.
     *
     * @param {object} deps
     *   - button : элемент кнопки (может отсутствовать — тогда no-op)
     *   - send   : (channel) => void — обычно ipcRenderer.send. Имя канала
     *              подставляет МОДУЛЬ, а не вызывающий: канал — часть контракта
     *              этой функции, и tests/ipc-liveness.test.js ищет отправителя
     *              по литералу
     *   - notify : (text) => void — необязательно
     * @returns {boolean} привязались ли
     */
    function bindReleasesLink(deps) {
        const button = deps && deps.button;
        const send = deps && deps.send;
        if (!button || typeof send !== 'function') { return false; }

        button.addEventListener('click', () => {
            // Вызов записан как `deps.send(...)`, а не через локальную
            // переменную: реестр каналов (tests/ipc-liveness.test.js) ищет
            // отправителя по форме `.send('имя-канала')`, и голый вызов
            // функции он бы не увидел — канал выглядел бы разрешённым, но
            // мёртвым. Ровно такие три канала здесь уже находили.
            //
            // Без payload — намеренно: канал умеет только «открой», но не
            // «открой ЧТО». Адрес живёт константой в main-процессе.
            deps.send('open-releases-page');
            if (typeof deps.notify === 'function') {
                deps.notify('Страница релизов открыта в браузере');
            }
        });
        return true;
    }

    /**
     * Единая точка входа: панель вызывает ОДИН раз и не хранит подробностей.
     * Зависимости по-прежнему приходят снаружи, поэтому обе функции выше
     * остаются проверяемыми в Node на поддельных document/localStorage.
     */
    function init(deps) {
        const d = deps || {};
        // Значения по умолчанию берутся из глобалей окна, поэтому в панели
        // вызов занимает одну строку: она упирается в потолок размера из
        // tests/control-decomposition.test.js, и десять строк проводки там —
        // это ровно то разрастание, которое потолок и должен предотвращать.
        // Возможность передать зависимости явно сохранена: на ней держится
        // проверяемость модуля в Node на поддельных document/localStorage.
        const storage = d.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        const doc = d.document || (typeof document !== 'undefined' ? document : null);
        const toast = d.notify || ((text, ms) => {
            if (root && root.Toast) { root.Toast.show(text, 'info', ms); }
        });
        const send = d.send || ((channel) => {
            if (root && root.ipcRenderer) { root.ipcRenderer.send(channel); }
        });
        const button = d.releasesButton
            || (doc ? doc.getElementById('checkUpdatesBtn') : null);

        const shown = showFirstRunHint({
            storage,
            notify: (text) => toast(text, 6000),
            schedule: d.schedule || setTimeout,
            storageKey: 'onboardingShown'
        });
        const bound = bindReleasesLink({ button, send, notify: (text) => toast(text) });
        return { hintShown: shown, releasesBound: bound };
    }

    const api = { showFirstRunHint, bindReleasesLink, init };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.Onboarding = api;
    }
})(typeof window !== 'undefined' ? window : null);
