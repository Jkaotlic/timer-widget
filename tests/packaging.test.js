// Guard against the "works in dev, breaks in the installer" class of bugs.
// Every local file referenced from our HTML pages (via <link> / <script src>)
// and from our main-process JS (via require('./…')) must be listed in
// package.json `build.files`. Otherwise electron-builder won't pack it into
// app.asar, and the packaged app loads a renderer where half the CSS custom
// properties are undefined or a module is missing at runtime.
//
// Historical incident: v2.3.0 shipped without design-tokens.css in `files`.
// Packaged app rendered the control panel on a white BrowserWindow surface
// (Electron's default) because every --tw-* token was empty. Dev runs worked
// because file:// reads go straight from the working directory.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mainProcessFiles, readMainSource } = require('./helpers/main-source');

const repoRoot = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const filesPatterns = Array.isArray(pkg.build && pkg.build.files) ? pkg.build.files : [];

/**
 * Crude but sufficient check: do any of the patterns in `files` match the
 * exact bare-name asset? We only ever list assets as either their bare name
 * (e.g. "design-tokens.css") or a glob ("fonts/**\/*"). That's enough for
 * this project — we don't need full electron-builder minimatch semantics.
 */
function isPacked(assetPath) {
    if (filesPatterns.includes(assetPath)) { return true; }
    // Match top-level glob directories (e.g. "sounds/**/*" covers "sounds/x.mp3")
    for (const pattern of filesPatterns) {
        const [dir] = pattern.split('/');
        if (assetPath.startsWith(dir + '/') && pattern.includes('**')) { return true; }
    }
    return false;
}

function readHtml(file) {
    return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function extractLocalAssets(html) {
    const assets = new Set();
    // <link rel="stylesheet" href="...">  — treat any href ending in .css as local
    const linkRe = /<link[^>]+href\s*=\s*["']([^"']+\.css)["']/gi;
    // <script src="...">                   — treat any src ending in .js as local
    const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+\.js)["']/gi;
    for (const re of [linkRe, scriptRe]) {
        let match;
        while ((match = re.exec(html)) !== null) {
            const asset = match[1];
            // Skip absolute URLs — those are CDN/data, not bundled
            if (/^(https?:|data:|file:)/i.test(asset)) { continue; }
            assets.add(asset.replace(/^\.\//, ''));
        }
    }
    return assets;
}

test('every <link>/<script src> in HTML is listed in package.json build.files', () => {
    const htmlFiles = [
        'electron-control.html',
        'electron-widget.html',
        'electron-clock-widget.html',
        'display.html'
    ];

    const missing = [];
    for (const htmlFile of htmlFiles) {
        const html = readHtml(htmlFile);
        for (const asset of extractLocalAssets(html)) {
            // Must exist on disk and be packed
            const diskPath = path.join(repoRoot, asset);
            if (!fs.existsSync(diskPath)) {
                missing.push(`${htmlFile} references ${asset} which doesn't exist on disk`);
                continue;
            }
            if (!isPacked(asset)) {
                missing.push(`${htmlFile} references ${asset} — not in package.json build.files`);
            }
        }
    }

    assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('runtime app icon (build/icon.png) ships via extraResources', () => {
    // electron-main.js loads the icon at runtime from process.resourcesPath when
    // packaged. That only works if electron-builder copies build/icon.png into the
    // resources dir via `extraResources`. Guard against the icon silently
    // disappearing from the packaged app (blank tray/window icon).
    const mainSrc = readMainSource();
    if (!/process\.resourcesPath/.test(mainSrc)) {
        return; // icon not resolved from resources — nothing to guard here
    }
    const extra = (pkg.build && pkg.build.extraResources) || [];
    const flat = extra.map((e) => (typeof e === 'string' ? e : (e && (e.from || e.filter)) || ''));
    const covered = flat.some((p) => String(p).replace(/\\/g, '/').includes('build/icon.png') || String(p).includes('build'));
    assert.ok(
        covered,
        'electron-main.js reads the icon from process.resourcesPath but build/icon.png is not in package.json build.extraResources'
    );
    // And the source file must actually exist to be copied.
    assert.ok(fs.existsSync(path.join(repoRoot, 'build', 'icon.png')), 'build/icon.png missing on disk');
});

test('every local require() in main-process JS is listed in package.json build.files', () => {
    const mainJsFiles = [
        ...mainProcessFiles(),
        'preload.js',
        'recovery.js',
        'timer-engine.js',
        'utils.js',
        'security.js',
        'constants.js',
        'ipc-compat.js'
    ];

    const missing = [];
    for (const jsFile of mainJsFiles) {
        const code = fs.readFileSync(path.join(repoRoot, jsFile), 'utf8');
        // require('./foo') or require('./foo/bar')
        const re = /require\s*\(\s*['"](\.\/[^'"]+)['"]/g;
        let match;
        while ((match = re.exec(code)) !== null) {
            let target = match[1].replace(/^\.\//, '');
            // dev-only tooling — not shipped, acceptable
            if (target.startsWith('scripts/')) { continue; }
            // Resolve bare names (require('./foo') → foo.js)
            const candidates = [target, `${target}.js`, `${target}/index.js`];
            const onDisk = candidates.find(c => fs.existsSync(path.join(repoRoot, c)));
            if (!onDisk) {
                missing.push(`${jsFile} requires '${match[1]}' — not resolvable on disk`);
                continue;
            }
            if (!isPacked(onDisk)) {
                missing.push(`${jsFile} requires '${match[1]}' (${onDisk}) — not in package.json build.files`);
            }
        }
    }

    assert.deepStrictEqual(missing, [], missing.join('\n'));
});

// build.files — это ещё и список того, что пользователь СКАЧИВАЕТ. Файл,
// который в рантайме не читает никто, платить за себя не должен.
//
// История: sbom.json (812 КБ) лежал в build.files и ехал внутрь app.asar,
// занимая 36% всего кода приложения — при том, что ни один require(), ни один
// <script src>, ни одна строка main-процесса его не открывает. Это артефакт
// цепочки поставки: его место в release assets (там он теперь и есть, см.
// .github/workflows/release.yml), а не в бандле.
//
// NOTICE остаётся намеренно: атрибуции лицензий MIT/BSD обязаны
// распространяться ВМЕСТЕ с бинарником, это юридическое требование, а не
// удобство.
test('в build.files не попадают файлы, которые рантайм не читает', () => {
    const runtimeReadsNothing = ['sbom.json', 'package-lock.json', 'CHANGELOG.md', 'README.md'];
    const leaked = runtimeReadsNothing.filter(f => filesPatterns.includes(f));
    assert.deepStrictEqual(
        leaked, [],
        `эти файлы попадают в сборку, но их никто не читает в рантайме: ${leaked.join(', ')}`
    );
});

test('каждый модуль, который требует главный процесс, лежит в build.files', () => {
    // Дыра, найденная 09.09.2026. Проверка выше перечисляет только то, что
    // подключено из HTML тегом <script src>. Модули главного процесса
    // подключаются через require, в HTML не встречаются вовсе — и любой из них
    // мог не попасть в сборку, оставшись зелёным во всех тестах: в рабочем
    // дереве файл на месте, а `require` в собранном приложении падает уже у
    // пользователя, на старте.
    //
    // Ловится только упаковкой: `npm start` и все тесты читают файлы прямо из
    // каталога проекта.
    //
    // Обход ТРАНЗИТИВНЫЙ, от точки входа: с 25.09.2026 главный процесс разбит
    // на модули main-*.js, и чистые модули требует уже не electron-main.js, а
    // они. Чтение одной точки входа нашло бы только модули main-*.js.
    const missing = [];
    const seen = new Set();

    // Инструменты разработки в сборку не идут НАМЕРЕННО: стенд съёмки нужен
    // только при `npm run screenshot`, а в собранном приложении этого режима
    // нет. Исключение названо адресом каталога, а не именем файла: любой
    // будущий инструмент оттуда попадёт под то же правило.
    const DEV_ONLY_PREFIX = 'scripts/';

    const requireRe = /require\(\s*'\.\/([^']+)'\s*\)/g;
    const queue = ['electron-main.js'];
    while (queue.length) {
        const from = queue.shift();
        const src = fs.readFileSync(path.join(repoRoot, from), 'utf8');
        let match;
        while ((match = requireRe.exec(src)) !== null) {
            const name = match[1].endsWith('.js') ? match[1] : `${match[1]}.js`;
            if (seen.has(name)) { continue; }
            seen.add(name);
            if (name.startsWith(DEV_ONLY_PREFIX)) { continue; }
            if (!fs.existsSync(path.join(repoRoot, name))) {
                missing.push(`${from} требует ${name}, которого нет на диске`);
                continue;
            }
            if (!isPacked(name)) {
                missing.push(`${name} требуется главным процессом (из ${from}), но не перечислен в build.files`);
            }
            queue.push(name);
        }
    }
    // Само-проверка обхода: без транзитивности модуль, требуемый только
    // модулем (atomic-write — из recovery и event-overrun-store), в счёт бы
    // не попал.
    assert.ok(seen.has('atomic-write.js'), 'обход не транзитивный — зонд видит только точку входа');

    assert.ok(seen.size > 0, 'зонд не нашёл НИ ОДНОГО require — регулярка сломана, и зелёный тут ничего не значит');
    assert.deepStrictEqual(missing, [], missing.join('\n'));
});

// ПСИ 28.09.2026: lintian по опубликованному deb 2.11.0 давал error-теги,
// которые чинит конфиг, а не обёртка: нет /usr/share/doc/<пакет>/copyright
// (Debian Policy 12.5), пустой synopsis в Description, `Section: default` и
// Recommends на libappindicator3-1, которого нет ни в Debian 12, ни в Ubuntu
// 24.04. Сам lintian гоняется в CI (job linux-sandbox) по собранному пакету;
// здесь — то, что видно без сборки, чтобы откат ловился за секунды.
const DOC_COPYRIGHT = '/usr/share/doc/timer-widget/copyright';
const LINTIAN_OVERRIDES = '/usr/share/lintian/overrides/timer-widget';

/** Пары «источник=назначение» из deb.fpm — так fpm кладёт лишние файлы. */
function fpmMappings() {
    return (pkg.build.deb.fpm || [])
        .filter((a) => !a.startsWith('-') && a.includes('='))
        .map((a) => { const i = a.indexOf('='); return { src: a.slice(0, i), dest: a.slice(i + 1) }; });
}

test('deb: непустой synopsis, раздел utils, Recommends без libappindicator3-1', () => {
    const { linux, deb } = pkg.build;
    assert.ok(typeof linux.synopsis === 'string' && linux.synopsis.trim().length > 0,
        'build.linux.synopsis пуст — первая строка Description в control будет пустой');
    assert.ok(linux.synopsis.length <= 80, 'synopsis длиннее 80 символов (Debian Policy 3.4.1)');
    assert.ok(!/\.$/.test(linux.synopsis.trim()), 'synopsis не заканчивается точкой (Debian Policy 3.4.1)');
    assert.ok(typeof linux.description === 'string' && linux.description.trim() !== linux.synopsis.trim(),
        'длинное описание обязано отличаться от synopsis — иначе Description повторяет сам себя');
    // Description в control. electron-builder склеивает его как
    // `${synopsis}\n ${description}` — пробел в начале длинного описания
    // (W: description-starts-with-leading-spaces), а всё описание одной
    // строкой (W: extended-description-line-too-long). Поэтому поле целиком
    // задано ключом --description в deb.fpm: fpm берёт последнее значение.
    const descArg = (deb.fpm || []).find((a) => a.startsWith('--description='));
    assert.ok(descArg, 'в deb.fpm нет --description=… — Description собирает electron-builder с пробелом и одной строкой');
    const [first, ...extended] = descArg.slice('--description='.length).split('\n');
    assert.strictEqual(first, linux.synopsis, 'первая строка Description обязана быть synopsis');
    assert.ok(extended.length >= 1 && extended.length <= 3, 'длинное описание — 1–3 строки');
    for (const line of extended) {
        assert.ok(line.length > 0 && !/^\s/.test(line), `строка описания пустая или с пробелом в начале: «${line}»`);
        assert.ok(line.length <= 80, `строка описания длиннее 80 символов: «${line}»`);
    }
    // lintian (fields/description) считает synopsis продублированным, если
    // первая строка описания совпадает с ним после удаления всего, кроме
    // [a-zA-Z0-9]. Русский текст сводится к пустой строке с обеих сторон —
    // CI 28.09.2026: E: description-synopsis-is-duplicated. Первой строке
    // нужны латинские буквы или цифры, которых нет в synopsis.
    const asciiCore = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
    assert.notStrictEqual(asciiCore(extended[0]), asciiCore(first),
        'lintian сочтёт первую строку описания повтором synopsis (сравнение по [a-z0-9])');
    assert.strictEqual(asciiCore('Таймер для зала'), asciiCore('Прозрачный таймер'), 'зонд сравнения lintian сломан');
    assert.strictEqual(deb.packageCategory, 'utils', 'Section в control обязан быть utils, а не default');
    // CI 28.09.2026: E: missing-dependency-on-libc (chrome-sandbox и ещё 5
    // ELF-файлов). Штатный список electron-builder libc6 не называет, а
    // deb.depends его ЗАМЕНЯЕТ, а не дополняет.
    assert.ok((deb.depends || []).some((d) => /^libc6\b/.test(d)), 'в deb.depends нет libc6 — lintian: missing-dependency-on-libc');
    const recommends = [].concat(deb.recommends || []);
    assert.ok(recommends.length > 0,
        'deb.recommends не задан — electron-builder подставит свой libappindicator3-1');
    assert.ok(!recommends.some((r) => /(^|[\s|])libappindicator3-1\b/.test(r)),
        'Recommends ссылается на libappindicator3-1 — его нет в Debian 12 и Ubuntu 24.04');
});

test('deb: copyright в формате DEP-5 ложится в /usr/share/doc/timer-widget/', () => {
    const mappings = fpmMappings();
    const copyright = mappings.find((m) => m.dest === DOC_COPYRIGHT);
    assert.ok(copyright, `в deb.fpm нет пары «файл=${DOC_COPYRIGHT}»`);
    const text = fs.readFileSync(path.join(repoRoot, copyright.src), 'utf8');
    assert.match(text, /^Format: https:\/\/www\.debian\.org\/doc\/packaging-manuals\/copyright-format\/1\.0\/\n/,
        'первая строка — заголовок DEP-5');
    assert.match(text, /^Files: \*\nCopyright: [^\n]*Jkaotlic\nLicense: MIT\n/m, 'нет стансы MIT для приложения');
    // Текст MIT — тот же, что в LICENSE репозитория, а не пересказ.
    const mitBody = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8')
        .split('\n').slice(4).join('\n').trim().split('\n')[0];
    assert.ok(text.includes(mitBody), 'текст MIT в copyright расходится с LICENSE');
    assert.match(text, /\/opt\/TimerWidget\/LICENSE\.electron\.txt/, 'нет ссылки на лицензию Electron');
    assert.match(text, /\/opt\/TimerWidget\/LICENSES\.chromium\.html/, 'нет ссылки на лицензии Chromium');
    // fpm перестаёт разбирать ключи на первом позиционном аргументе, а
    // electron-builder добавляет свои пары ПОСЛЕ deb.fpm: ключ за парой молча
    // стал бы путём к файлу.
    const fpm = pkg.build.deb.fpm;
    const firstPair = fpm.findIndex((a) => !a.startsWith('-') && a.includes('='));
    assert.ok(fpm.slice(firstPair).every((a) => !a.startsWith('-')), 'ключ fpm стоит после пары файлов — fpm его не прочтёт');
    // Проверка себя: зонд пар видит пару там, где она есть.
    assert.deepStrictEqual(
        ['--x', 'a=b'].filter((a) => !a.startsWith('-') && a.includes('=')), ['a=b'],
        'зонд пар fpm сломан');
});

test('deb: переопределения lintian — в пакете, и у каждого тега причина', () => {
    const overrides = fpmMappings().find((m) => m.dest === LINTIAN_OVERRIDES);
    assert.ok(overrides, `в deb.fpm нет пары «файл=${LINTIAN_OVERRIDES}» — теги Electron уронят lintian`);
    const lines = fs.readFileSync(path.join(repoRoot, overrides.src), 'utf8').split('\n');
    const tags = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim() && !l.trim().startsWith('#'));
    assert.ok(tags.length > 0, 'файл переопределений пуст — уберите его из deb.fpm');
    for (const { l, i } of tags) {
        assert.match(l, /^timer-widget: [a-z0-9-]+/, `строка ${i + 1}: не «пакет: тег»`);
        assert.ok(i > 0 && lines[i - 1].trim().startsWith('#'), `строка ${i + 1} (${l}): у тега нет комментария-причины`);
    }
});
