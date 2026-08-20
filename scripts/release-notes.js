#!/usr/bin/env node
'use strict';

/**
 * Собирает описание релиза из CHANGELOG.md.
 *
 * Зачем. Раньше тело релиза было ЗАХАРДКОЖЕНО в .github/workflows/release.yml —
 * ~70 строк markdown под версию 2.3. К моменту 2.4.0 оно врало в трёх местах:
 * заголовок «Что нового в v2.3», обещание «Linux: chrome-sandbox без SUID,
 * приложение с --no-sandbox» (в 2.4.0 ровно наоборот: deb получает SUID, флаг
 * остался только у AppImage) и устаревшая инструкция для macOS «правый клик →
 * Открыть», которую Apple убрала. Ровно тот же класс дефекта, что и врущая
 * справка в самом приложении: текст живёт отдельно от кода и тихо расходится
 * с ним.
 *
 * Теперь единственный источник — CHANGELOG.md. Всё, что не выводится из него
 * (таблица загрузок, требования, оговорки про подпись и песочницу), собирается
 * здесь из package.json — версия Electron и список целей сборки не переписываются
 * руками.
 *
 * Использование:
 *   node scripts/release-notes.js            # для версии из package.json
 *   node scripts/release-notes.js v2.4.0     # для конкретного тега
 *   node scripts/release-notes.js --out FILE # записать в файл
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Вырезает из CHANGELOG раздел одной версии: от её заголовка `## [X.Y.Z]` до
 * следующего заголовка того же уровня.
 * @param {string} changelog
 * @param {string} version  например '2.4.0'
 * @returns {string|null}
 */
function extractSection(changelog, version) {
    const lines = changelog.split('\n');
    const escaped = version.replace(/\./g, '\\.');
    const startRe = new RegExp(`^##\\s*\\[${escaped}\\]`);
    const start = lines.findIndex((l) => startRe.test(l));
    if (start === -1) { return null; }

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start + 1, end).join('\n').trim();
}

/**
 * Постоянная часть: как скачать и что важно знать. Значения, которые могут
 * разъехаться с реальностью (версия Electron, набор целей), берутся из
 * package.json, а не пишутся словами.
 */
function footer(pkg) {
    const electron = String(pkg.devDependencies.electron).replace(/^[^0-9]*/, '');
    const rows = [];
    if (pkg.build.win.target.includes('nsis')) {
        rows.push('| Windows | `TimerWidget-Setup-*.exe` | Установщик, права администратора не нужны |');
    }
    if (pkg.build.win.target.includes('portable')) {
        rows.push('| Windows | `TimerWidget-*-portable.exe` | Портативная версия, без установки |');
    }
    if (pkg.build.mac.target.includes('dmg')) {
        rows.push('| macOS Apple Silicon | `*-arm64.dmg` | Для M1 и новее |');
        rows.push('| macOS Intel | `*-x64.dmg` | Для Intel Mac |');
    }
    if (pkg.build.linux.target.includes('deb')) {
        rows.push('| Linux | `*.deb` | Debian / Ubuntu, с работающей песочницей |');
    }
    if (pkg.build.linux.target.includes('AppImage')) {
        rows.push('| Linux | `*.AppImage` | Универсальный, запуск без установки |');
    }

    return `## Скачать

| Платформа | Файл | Описание |
|:----------|:-----|:---------|
${rows.join('\n')}

**macOS.** Сборки не подписаны сертификатом разработчика. При первом запуске
система сообщит, что не может проверить разработчика: откройте «Системные
настройки» → «Конфиденциальность и безопасность», найдите сообщение о
заблокированном приложении и нажмите «Открыть всё равно». Способ через правый
клик в свежих версиях macOS больше не работает.

**Linux.** У пакета \`.deb\` песочница Chromium работает: вспомогательный бинарник
получает SUID-бит при установке. У \`.AppImage\` установочного шага нет, поэтому он
запускается с \`--no-sandbox\` — если песочница важна, ставьте \`.deb\`.

## Требования

- Windows 10/11 (x64)
- macOS 11+ (Intel или Apple Silicon)
- Linux (glibc 2.28+)

Приложение работает **полностью офлайн**: шрифты лежат в пакете, звуки
синтезируются через Web Audio API, служебные обращения Chromium отключены. Ни
одного внешнего адреса в поставляемых файлах — это проверяется тестом на каждой
сборке. Автообновления нет.

## Первый запуск

Сборки **не подписаны сертификатом разработчика** — у проекта его нет. Система
об этом предупредит, и это ожидаемо, а не признак повреждённого файла:

- **Windows** — SmartScreen покажет «Windows защитила ваш компьютер»:
  «Подробнее» → «Выполнить в любом случае».
- **macOS** — при первом запуске «не удаётся проверить разработчика»: откройте
  «Системные настройки» → «Конфиденциальность и безопасность», найдите там
  сообщение о заблокированном приложении и нажмите «Открыть всё равно».
- **Linux** — для AppImage нужен бит запуска: \`chmod +x TimerWidget-*.AppImage\`.

Проверить, что файл дошёл без изменений, можно по контрольным суммам из
\`SHA256SUMS.txt\` рядом с загрузками.

Подробности о данных, правах и изоляции — [SECURITY.md](https://github.com/Jkaotlic/timer-widget/blob/main/SECURITY.md).

---
Electron ${electron} · Vanilla JS · \`node --test\` · полный [CHANGELOG](https://github.com/Jkaotlic/timer-widget/blob/main/CHANGELOG.md)`;
}

function build(version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const clean = String(version || pkg.version).replace(/^v/, '');

    const section = extractSection(changelog, clean);
    if (!section) {
        throw new Error(
            `в CHANGELOG.md нет раздела для версии ${clean} — заполните его до выпуска тега`
        );
    }

    // Раздел версии в этом CHANGELOG начинается со сводного абзаца, а дальше идут
    // подразделы `### Security`, `### Fixed` и т.д. — иногда на несколько сотен
    // строк. Сводку выносим наверх, подробности убираем под сворачивающийся блок:
    // читателю страницы релиза нужны «что нового» и «скачать», а не полный разбор.
    // Источник при этом один — CHANGELOG, поэтому разойтись с ним нечему.
    const firstSub = section.search(/^###\s/m);
    const summary = (firstSub === -1 ? section : section.slice(0, firstSub)).trim();
    const details = firstSub === -1 ? '' : section.slice(firstSub).trim();

    let body = `# TimerWidget v${clean}\n\n`
        + 'Прозрачный таймер для презентаций и рабочего стола: панель управления, '
        + 'мини-виджет, часы и полноэкранный режим — четыре стиля в каждом окне.\n\n';
    if (summary) { body += `## Что изменилось\n\n${summary}\n\n`; }
    if (details) {
        body += '<details>\n<summary>Полный список изменений</summary>\n\n'
            + `${details}\n\n</details>\n\n`;
    }
    return `${body}${footer(pkg)}\n`;
}

function main() {
    const args = process.argv.slice(2);
    const outIndex = args.indexOf('--out');
    const out = outIndex === -1 ? null : args[outIndex + 1];
    const version = args.find((a) => a !== '--out' && a !== out);

    const text = build(version);
    if (out) {
        fs.writeFileSync(path.join(ROOT, out), text, 'utf8');
        console.log(`[release-notes] записано ${out} (${text.length} символов)`);
    } else {
        process.stdout.write(text);
    }
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`[release-notes] ${err.message}`);
        process.exit(1);
    }
}

module.exports = { extractSection, footer, build };
