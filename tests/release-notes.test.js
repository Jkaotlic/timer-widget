'use strict';

/**
 * Описание релиза собирается из CHANGELOG.md — и обязано это делать.
 *
 * Предыстория. Тело релиза было ЗАХАРДКОЖЕНО в .github/workflows/release.yml:
 * ~70 строк markdown, написанных под версию 2.3. К моменту 2.4.0 оно врало в
 * трёх местах:
 *
 *   1. «## Что нового в v2.3» — раздел про предыдущую версию как про текущую;
 *   2. «Linux: chrome-sandbox без SUID-бита (0755), приложение с --no-sandbox» и
 *      «user namespaces не требуются» — в 2.4.0 ровно наоборот: deb получает
 *      SUID-помощника, а флаг остался только у AppImage;
 *   3. инструкция для macOS «правый клик → Открыть» — Apple убрала этот путь,
 *      теперь разрешать надо в «Конфиденциальность и безопасность».
 *
 * Это тот же класс дефекта, что была врущая справка внутри приложения: текст
 * живёт отдельно от кода и расходится с ним молча. Поэтому источник теперь один
 * (CHANGELOG), а тест сторожит и генерацию, и отсутствие старых обещаний.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { extractSection, build } = require(path.join(ROOT, 'scripts', 'release-notes.js'));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('раздел версии вырезается из CHANGELOG до следующего заголовка', () => {
    const fake = [
        '# Changelog',
        '',
        '## [9.9.9] - 2099-01-01',
        '',
        'Сводка новой версии.',
        '',
        '### Fixed',
        '- что-то починили',
        '',
        '## [9.9.8] - 2098-01-01',
        '',
        '- старое, попадать не должно'
    ].join('\n');

    const section = extractSection(fake, '9.9.9');
    assert.match(section, /Сводка новой версии/);
    assert.match(section, /что-то починили/);
    assert.ok(!section.includes('старое, попадать не должно'), 'захвачен раздел следующей версии');
    assert.equal(extractSection(fake, '1.2.3'), null, 'для отсутствующей версии обязан быть null');
});

test('описание для текущей версии собирается и содержит нужные части', () => {
    const notes = build(PKG.version);
    assert.match(notes, new RegExp(`# TimerWidget v${PKG.version.replace(/\./g, '\\.')}`));
    assert.match(notes, /## Что изменилось/, 'нет раздела с изменениями');
    assert.match(notes, /## Скачать/, 'нет таблицы загрузок');
    assert.match(notes, /## Требования/, 'нет раздела требований');
    // Длинный список изменений обязан быть под сворачивающимся блоком: страница
    // релиза читается ради «что нового» и «скачать», а не ради полного разбора.
    assert.match(notes, /<details>[\s\S]*<\/details>/, 'подробности не убраны под details');
    // Версия тега с префиксом v обрабатывается так же.
    assert.equal(build(`v${PKG.version}`), notes, 'тег с префиксом v даёт другой результат');
});

test('отсутствие раздела в CHANGELOG — это ошибка, а не пустой релиз', () => {
    assert.throws(
        () => build('0.0.1-нет-такой'),
        /нет раздела для версии/,
        'генератор обязан падать, а не выпускать релиз с пустым описанием'
    );
});

test('таблица загрузок соответствует реальным целям сборки', () => {
    const notes = build(PKG.version);
    const targets = {
        'TimerWidget-Setup': PKG.build.win.target.includes('nsis'),
        'portable.exe': PKG.build.win.target.includes('portable'),
        'arm64.dmg': PKG.build.mac.target.includes('dmg'),
        '*.deb': PKG.build.linux.target.includes('deb'),
        '*.AppImage': PKG.build.linux.target.includes('AppImage')
    };
    for (const [needle, expected] of Object.entries(targets)) {
        assert.equal(
            notes.includes(needle),
            expected,
            `таблица загрузок расходится с build.target по «${needle}»`
        );
    }
    // Версия Electron берётся из package.json, а не пишется словами.
    const electron = String(PKG.devDependencies.electron).replace(/^[^0-9]*/, '');
    assert.ok(notes.includes(`Electron ${electron}`), `в описании нет актуальной версии Electron ${electron}`);
});

test('описание не повторяет устаревших обещаний', () => {
    // Проверяем ОБЕЩАНИЯ, а не исторические цитаты. Подробности под <details>
    // приходят из CHANGELOG и там законно цитируют то, что раньше было неверно
    // («описание врало, включая „chrome-sandbox без SUID“»). Ввести в заблуждение
    // может только текст, который что-то УТВЕРЖДАЕТ от имени этой версии, —
    // сводка сверху и постоянный подвал. Их и смотрим.
    const notes = build(PKG.version).replace(/<details>[\s\S]*?<\/details>/g, '');
    const lies = [
        [/chrome-sandbox.{0,40}без SUID/i, 'deb теперь ставит SUID-помощника'],
        [/user namespaces не требуются/i, 'для deb это больше не так'],
        [/правый клик.{0,20}Открыть/i, 'этот способ обхода Gatekeeper убран Apple'],
        [/Что нового в v2\.3/, 'заголовок предыдущей версии'],
    ];
    for (const [re, why] of lies) {
        assert.ok(!re.test(notes), `в описании релиза снова устаревшее утверждение: ${why}`);
    }
    // И то же самое — в самом workflow: тело больше не пишется там руками.
    // Комментарии вырезаются: шаг генерации намеренно объясняет, ЧТО именно врало
    // в захардкоженном теле, и цитирует старый заголовок.
    const workflowCode = WORKFLOW.split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
    assert.ok(
        !/Что нового в v2\.3/.test(workflowCode),
        'в release.yml вернулось захардкоженное тело релиза'
    );
    assert.match(WORKFLOW, /body_path: RELEASE_NOTES\.md/, 'релиз не берёт описание из файла');
    assert.match(
        WORKFLOW,
        /node scripts\/release-notes\.js/,
        'в release.yml нет шага генерации описания'
    );
});

test('тесты и линт стоят перед сборкой каждой платформы', () => {
    // Релизная сборка не должна выпускать артефакт, не прогнав проверки.
    // Переводы строк нормализуем: рабочее дерево держит LF через .gitattributes,
    // но у клона, сделанного до его появления, файл может лежать с CRLF — и тогда
    // разбиение по `\n  job:\n` находит один job вместо четырёх. Ровно на этом
    // проверка упала в релизной сборке на Windows.
    const jobs = WORKFLOW.replace(/\r\n/g, '\n')
        .split(/\n {2}[a-z-]+:\n/)
        .filter((j) => j.includes('electron-builder'));
    assert.ok(jobs.length >= 4, `сборочных job'ов найдено ${jobs.length}, ожидалось не меньше четырёх`);
    for (const job of jobs) {
        const lint = job.indexOf('npm run lint');
        const tests = job.indexOf('npm test');
        const buildStep = job.indexOf('electron-builder');
        assert.ok(lint !== -1 && lint < buildStep, 'линт не идёт перед сборкой');
        assert.ok(tests !== -1 && tests < buildStep, 'тесты не идут перед сборкой');
    }
});
