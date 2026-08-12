'use strict';

/**
 * Проход 6 (30.07.2026): чтение разметки панели и control.css глазами.
 *
 * Тема прохода — не «работает ли логика», а «можно ли до функции дотянуться».
 * Три предыдущих прохода по логике и один по доступности этого не поймали, потому
 * что до кода претензий нет: обвязка полная, тесты зелёные, а контрола в UI нет.
 *
 * Найдено пять вещей, и все проверяются здесь в ОБЕ стороны — что правильное
 * поведение есть и что старого сломанного не осталось:
 *
 *  1. #syncClockStyle лежал в блоке display:none. Логику «assignment .value не
 *     порождает change» починили проходом раньше, но контрол в UI не вернули, и
 *     e2e/clock-style-sync.spec.js ставит .checked кодом — поэтому был зелёным.
 *     Тест на логику не доказывает достижимость.
 *  2. Там же прятались секунды, 24-часовой формат и часовой пояс часов — при
 *     полностью живой обвязке (listener → pushClockSettings → localStorage →
 *     окно, где _onClockSettings их реально применяет).
 *  3. Вопрос справки был <div> с обработчиком клика: мышью аккордеон работал, а
 *     с клавиатуры — нет (нет фокуса, нет Enter), состояние открыт/закрыт не
 *     сообщалось никак, и стрелки-индикатора в разметке не было, хотя CSS для
 *     неё лежал. Плюс лимит `max-height: 500px` молча обрезал бы длинный ответ.
 *     ВАЖНО про ошибку в ходе этого же прохода: сначала я решил, что обработчика
 *     нет вовсе, и добавил второй. Два обработчика на одном элементе ломают
 *     аккордеон насмерть (первый ставит класс, второй видит его как «уже
 *     открыт» и снимает со всей секции), поэтому здесь есть проверка на
 *     единственность обработчика.
 *  4. Справка описывала интерфейс, которого нет несколько версий: вкладки
 *     «Время»/«Фон», пресеты «1–5», режим фона «По URL», «три события» звуков,
 *     ползунки масштаба у виджета и часов, версия v2.1.1 при фактической 2.3.2.
 *     Держалось долго потому, что в аккордеоне ответы закрыты по умолчанию.
 *  5. Скрытая кнопка #soundToggleBtn осталась мёртвым кодом после того, как
 *     мастер-чекбокс стал единственным источником правды.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'electron-control.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'control.css'), 'utf8');
const PKG = require(path.join(ROOT, 'package.json'));

// Проверять надо КОД, а не прозу о коде: комментарии в этих файлах намеренно
// перечисляют удалённые селекторы и старые формулировки («здесь было max-height:
// 500px», «режим фона По URL»), и без вырезания комментариев тест падал на
// собственных объяснениях.
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML_CODE = HTML.replace(/<!--[\s\S]*?-->/g, '');

// Вырезает тег с данным id, чтобы проверять его атрибуты целиком.
function tagById(id) {
    const m = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(HTML);
    assert.ok(m, `элемент #${id} не найден в разметке`);
    return m[0];
}

test('настройки часов достижимы из UI, а не спрятаны через display:none', () => {
    for (const id of ['syncClockStyle', 'clockShowSeconds', 'clockFormat24h', 'clockShowTimezone']) {
        const tag = tagById(id);
        assert.ok(
            !/display\s*:\s*none/.test(tag),
            `#${id} снова спрятан через inline display:none — функция недостижима мышью`
        );
        assert.match(
            HTML,
            new RegExp(`<label class="toggle-label" for="${id}">`),
            `#${id} обязан иметь видимую подпись <label for> — иначе у чекбокса нет доступного имени`
        );
    }
    assert.ok(
        !/kept for JS compatibility/i.test(HTML_CODE),
        'вернулся блок «hidden elements kept for JS compatibility» — там прячутся недостижимые функции'
    );
});

test('окно часов реально исполняет то, что теперь можно включить', () => {
    const clock = fs.readFileSync(path.join(ROOT, 'electron-clock-widget.html'), 'utf8');
    for (const key of ['showSeconds', 'format24h', 'showTimezone']) {
        assert.match(
            clock,
            new RegExp(`settings\\.${key} !== undefined`),
            `окно часов не применяет ${key} — контрол в панели был бы пустышкой`
        );
    }
});

test('мёртвая скрытая кнопка звука удалена вместе с обвязкой', () => {
    assert.ok(!/soundToggleBtn/.test(HTML_CODE), '#soundToggleBtn вернулся — это мёртвый код');
    assert.ok(
        !/\.quick-window-btn\.sound\.muted/.test(CSS_CODE),
        'правило .quick-window-btn.sound.muted описывает кнопку, которой нет'
    );
    // Единственный источник правды для мастер-флага остаётся на месте.
    assert.match(HTML, /setSoundEnabled\(/, 'setSoundEnabled() — единая точка правды, она нужна');
    assert.match(HTML, /id="soundMasterEnabled"[^>]*aria-label=/, 'мастер-чекбокс звука без доступного имени');
});

test('справка раскрывается: кнопки, aria-expanded, обработчик', () => {
    const questions = HTML.match(/class="faq-question"/g) || [];
    const answers = HTML.match(/class="faq-answer"/g) || [];
    assert.ok(questions.length >= 10, `вопросов справки слишком мало: ${questions.length}`);
    assert.equal(questions.length, answers.length, 'число вопросов и ответов справки расходится');

    // Каждый вопрос — настоящая кнопка с состоянием, а не <div>.
    assert.ok(
        !/<div class="faq-question"/.test(HTML_CODE),
        'вопрос справки снова <div>: он не получает фокус и не открывается с клавиатуры'
    );
    const buttons = HTML.match(/<button class="faq-question" type="button" aria-expanded="false">/g) || [];
    assert.equal(
        buttons.length,
        questions.length,
        'не у всех вопросов справки есть type="button" и aria-expanded'
    );

    // Обработчик ровно ОДИН. Два обработчика на одном элементе гасят друг друга:
    // первый ставит `open`, второй читает его как «уже открыт», снимает класс со
    // всей секции и обратно не возвращает — ответ мигает и остаётся закрытым.
    const handlers = (HTML_CODE.match(/faqQuestions\.forEach/g) || []).length;
    assert.equal(handlers, 1, `обработчиков аккордеона справки должно быть ровно 1, найдено ${handlers}`);
    assert.match(HTML_CODE, /item\.classList\.add\('open'\)/, 'класс .open никто не ставит — ответы не раскроются');
    assert.match(
        HTML_CODE,
        /setAttribute\('aria-expanded', 'true'\)/,
        'aria-expanded не выставляется при раскрытии'
    );
    assert.match(
        HTML_CODE,
        /setAttribute\('aria-expanded', 'false'\)/,
        'aria-expanded не сбрасывается у закрытых вопросов секции'
    );
});

test('CSS справки не прячет ответы навсегда', () => {
    // Старая схема: max-height: 0 в .faq-answer, открываемая только .faq-item.open.
    const answerRule = /\.faq-answer\s*\{([^}]*)\}/.exec(CSS_CODE);
    assert.ok(answerRule, 'правило .faq-answer не найдено');
    assert.ok(
        !/max-height\s*:\s*0/.test(answerRule[1]),
        '.faq-answer снова скрыт через max-height: 0 — при потере обработчика справка опять станет пустой'
    );
    assert.match(answerRule[1], /display\s*:\s*none/, '.faq-answer должен скрываться через display');
    assert.match(CSS_CODE, /\.faq-item\.open \.faq-answer \{ display: block; \}/, 'нет правила раскрытия ответа');
    // Лимит 500px обрезал бы длинные ответы, и этого никто бы не увидел.
    assert.ok(!/max-height\s*:\s*500px/.test(CSS_CODE), 'вернулся обрезающий лимит max-height: 500px');
    // Кнопка-вопрос обязана быть сброшена к виду обычной строки списка.
    const qRule = /\.faq-question\s*\{([^}]*)\}/.exec(CSS_CODE)[1];
    for (const prop of ['background', 'border', 'font-family', 'text-align', 'width']) {
        assert.match(qRule, new RegExp(prop), `.faq-question как <button> обязана задавать ${prop}`);
    }
});

test('справка описывает интерфейс, который есть сейчас', () => {
    const body = HTML_CODE.slice(HTML_CODE.indexOf('<div class="faq-body">'), HTML_CODE.indexOf('<div class="faq-footer">'));
    const lies = [
        [/вкладке <strong>Время/, 'вкладки «Время» не существует'],
        [/вкладке <strong>Фон/, 'вкладки «Фон» не существует'],
        [/Клавиши 1–5/, 'пресетов на 1–5 нет, их восемь'],
        [/По URL/, 'режим фона «по URL» удалён'],
        [/три события/, 'звуковых событий четыре'],
        [/Слайдер внизу/, 'у виджета и часов нет ползунка масштаба'],
        [/Загрузить звук/, 'кнопки «Загрузить звук» нет, это зона перетаскивания'],
        [/до 10 МБ/, 'лимит аудио 5 МБ'],
    ];
    for (const [re, why] of lies) {
        assert.ok(!re.test(body), `справка снова врёт: ${why}`);
    }

    // Пресеты в справке обязаны совпадать с кнопками панели.
    const presets = [...HTML.matchAll(/class="quick-preset" data-minutes="(\d+)"/g)].map((m) => +m[1]);
    assert.deepEqual(presets, [5, 10, 15, 20, 25, 30, 45, 60], 'состав кнопок пресетов изменился');
    assert.match(body, /Пресеты: 5, 10, 15, 20, 25, 30, 45, 60 мин/, 'справка не перечисляет реальные пресеты');
    assert.match(body, /Клавиши 1–8/, 'справка не упоминает клавиши 1–8');

    // Клавиша S существует в панели и на дисплее — значит про неё можно писать.
    assert.match(HTML, /event\.code === 'KeyS'/, 'обработчик клавиши S исчез, а справка о нём пишет');
});

test('версия в подвале справки совпадает с package.json', () => {
    const m = /<span id="appVersion">TimerWidget v([\d.]+)<\/span>/.exec(HTML);
    assert.ok(m, 'в подвале справки нет #appVersion — версию снова нельзя проверить');
    assert.equal(
        m[1],
        PKG.version,
        `справка показывает v${m[1]}, а package.json — ${PKG.version}`
    );
});

test('у каждого чекбокса панели есть доступное имя', () => {
    // Имя у чекбокса берётся из одного из трёх источников:
    //   1) aria-label на самом input;
    //   2) <label for="id"> где-либо в документе;
    //   3) ОБЁРТЫВАЮЩИЙ <label>, если внутри него есть текст.
    // Третий случай раньше держал звуковые чекбоксы: они лежали в
    // <label class="sound-check"> со <span class="sound-name">Старт</span>.
    // Теперь это переключатели, подпись вынесена из <label> наружу, и имя им
    // даёт aria-label — то есть первый случай. Обёртка .toggle-switch имени НЕ
    // даёт: внутри неё только пустой
    // span-ползунок, и title на <label> именем вложенного input не становится —
    // именно так шесть переключателей панели оставались безымянными.
    const checkboxes = [...HTML_CODE.matchAll(/<input type="checkbox"[^>]*>/g)];
    assert.ok(checkboxes.length >= 10, `чекбоксов найдено подозрительно мало: ${checkboxes.length}`);

    // Текст обёртывающего <label>, если он есть: ищем ближайший <label ...> слева
    // и его закрывающий тег справа от input.
    function wrappingLabelText(index) {
        const before = HTML_CODE.lastIndexOf('<label', index);
        if (before === -1) { return ''; }
        const close = HTML_CODE.indexOf('</label>', index);
        if (close === -1) { return ''; }
        const inner = HTML_CODE.slice(before, close);
        // Открылся ли внутри ещё один label — тогда наш input не в этом.
        if (inner.slice(1).includes('<label')) { return ''; }
        return inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    const unnamed = [];
    for (const m of checkboxes) {
        const tag = m[0];
        const id = (/\bid="([^"]+)"/.exec(tag) || [])[1];
        if (/aria-label=/.test(tag)) { continue; }
        if (id && new RegExp(`<label[^>]*for="${id}"`).test(HTML_CODE)) { continue; }
        if (wrappingLabelText(m.index)) { continue; }
        unnamed.push(id || tag);
    }
    assert.deepEqual(unnamed, [], `чекбоксы без доступного имени: ${unnamed.join(', ')}`);
});

test('мёртвые правила CSS удалены', () => {
    const dead = [
        ['.time-input', 'разметка использует .manual-time-input'],
        ['.adjust-btn', 'разметка использует .adjust-main-btn'],
        ['.window-btn', 'разметка использует .quick-window-btn'],
        ['.sound-row', 'разметка использует .sound-item'],
        ['.sound-group', 'такого класса нет нигде'],
        ['.faq-shortcut ', 'есть только .faq-shortcuts и .shortcut'],
    ];
    for (const [sel, why] of dead) {
        assert.ok(
            !CSS_CODE.includes(`${sel} {`) && !CSS_CODE.includes(`${sel},`) && !CSS_CODE.includes(`${sel}.`),
            `мёртвое правило ${sel} вернулось в control.css (${why})`
        );
    }
    assert.ok(!/@keyframes slideDown/.test(CSS_CODE), 'анимация slideDown никем не используется');
    assert.ok(
        !/\.win-btn:nth-child\(3\)/.test(CSS_CODE),
        'правило для третьей кнопки титлбара — в титлбаре их две'
    );
    // А вот .arrow теперь ЖИВОЙ класс: стрелка появилась в разметке справки.
    assert.match(HTML, /<span class="arrow" aria-hidden="true">/, 'стрелка аккордеона исчезла из разметки');
    assert.match(CSS, /\.faq-question \.arrow/, 'стиль стрелки аккордеона исчез');
});

test('кнопки режима полосы достижимы и названы', () => {
    // Кнопка без доступного имени — это кнопка, которой нет для скринридера.
    // Шеврон нарисован глифом, поэтому имя обязано быть в aria-label.
    for (const id of ['miniBarToggle', 'miniBarExpand']) {
        const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(HTML_CODE);
        assert.ok(tag, `кнопки #${id} нет в разметке`);
        assert.match(tag[0], /aria-label="[^"]+"/, `#${id} без доступного имени`);
    }

    // Полоса не прячется инлайновым стилем: состояние несёт класс на <body>,
    // иначе его нельзя перекрыть из CSS и невозможно проверить кликом.
    const bar = /<div[^>]*id="miniBar"[^>]*>/.exec(HTML_CODE);
    assert.ok(bar, 'блока #miniBar нет в разметке');
    assert.doesNotMatch(bar[0], /style="[^"]*display:\s*none/);
});

test('каждая буквенная горячая клавиша панели описана в обеих справках', () => {
    // Списков справки ДВА — накладка по F1 (shortcuts-help.js) и раздел в
    // модалке справки (разметка панели), — и оба ведутся руками. Клавиша,
    // которой нет в списке, — это клавиша, о которой никто не узнает; клавиша
    // в одном списке из двух — это ещё и расхождение между ними.
    //
    // Источник правды — сам обработчик: из него и берётся набор букв.
    const handled = [...HTML_CODE.matchAll(/event\.code === 'Key([A-Z])'/g)].map((m) => m[1]);
    assert.ok(handled.length >= 5, `буквенных клавиш найдено подозрительно мало: ${handled.length}`);

    const overlay = fs.readFileSync(path.join(ROOT, 'shortcuts-help.js'), 'utf8');
    const missingOverlay = handled.filter((k) => !new RegExp(`\\['${k}',`).test(overlay));
    assert.deepStrictEqual(missingOverlay, [], `нет в накладке F1: ${missingOverlay.join(', ')}`);

    const missingModal = handled.filter(
        (k) => !new RegExp(`<span class="key">${k}</span>`).test(HTML_CODE)
    );
    assert.deepStrictEqual(missingModal, [], `нет в справке панели: ${missingModal.join(', ')}`);
});
