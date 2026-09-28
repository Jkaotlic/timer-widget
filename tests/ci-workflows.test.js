'use strict';

/**
 * Что обязаны делать workflow CI — проверки, которых нет в самом приложении.
 *
 * Зачем тест на YAML. Шаг CI, который «проверяет» пакет, исчезает бесследно:
 * удалённый шаг не краснеет, он просто перестаёт что-либо утверждать. ПСИ
 * 28.09.2026 ловила ровно то, чего в CI не было (lintian, запуск с
 * `--no-sandbox`, purge, обновление с опубликованной версии), поэтому здесь
 * закреплено, что эти шаги есть и стоят в нужных job.
 *
 * Разбор — срезами текста по отступам, без парсера YAML: зависимость ради
 * двух файлов не нужна, а структура workflow (job — два пробела, шаг — «- »)
 * в проекте стабильна. Срез проверяется сам на себе в первом тесте.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');

/** Строки YAML без комментариев: пояснение «здесь нет lintian» не должно
 *  засчитываться как шаг. Комментарий — `#` в начале или после пробела. */
function yamlCode(src) {
    return src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

/** Тело job `name` (до следующего job того же отступа). */
function jobBlock(src, name) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l === `  ${name}:`);
    if (start === -1) { return null; }
    let end = start + 1;
    while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) { end++; }
    return lines.slice(start, end).join('\n');
}

/** Шаг по началу имени: от `- name: …` до следующего `- ` того же отступа. */
function stepBlock(job, namePrefix) {
    const lines = job.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^\\s*- name: ${namePrefix}`).test(l));
    if (start === -1) { return null; }
    const indent = lines[start].indexOf('-');
    let end = start + 1;
    while (end < lines.length && !(lines[end].indexOf('- ') === indent && /^\s*- /.test(lines[end]))) { end++; }
    return lines.slice(start, end).join('\n');
}

const NODEJS = read('nodejs.yml');

test('срезы job и шага режут по структуре (проверка себя)', () => {
    const sample = 'jobs:\n  a:\n    steps:\n      - name: One\n        run: x\n      - name: Two\n        run: y\n  b:\n    steps: []\n';
    assert.equal(jobBlock(sample, 'b'), '  b:\n    steps: []\n');
    assert.match(jobBlock(sample, 'a'), /Two/);
    assert.doesNotMatch(jobBlock(sample, 'a'), /steps: \[\]/);
    assert.equal(stepBlock(jobBlock(sample, 'a'), 'One'), '      - name: One\n        run: x');
    assert.equal(yamlCode('run: a # lintian\n# lintian'), 'run: a\n');
    assert.ok(jobBlock(NODEJS, 'linux-sandbox'), 'в nodejs.yml нет job linux-sandbox — срез сломан или job переименован');
});

const LINTIAN_CHECK = fs.readFileSync(path.join(ROOT, 'scripts', 'lintian-check.sh'), 'utf8');
const lintianCode = LINTIAN_CHECK.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('lintian-check.sh: error валит, вывод полный, код выхода печатается', () => {
    assert.match(lintianCode, /apt-get install[^\n]*\blintian\b/, 'скрипт не ставит lintian');
    assert.match(lintianCode, /lintian --fail-on error\b[^\n]*--info\b[^\n]*"\$DEB"/,
        'lintian без --fail-on error / --info или не по переданному deb');
    assert.match(lintianCode, /--show-overrides/, 'не видно, какие переопределения сработали');
    assert.match(lintianCode, /exit "?\$RC"?/, 'код lintian не возвращается наружу');
});

// Один скрипт на CI и релиз: тело шага, скопированное в два workflow,
// расходится при первой правке — релиз проверял бы пакет не так, как CI.
for (const [file, jobName, buildCmd] of [
    ['nodejs.yml', 'linux-sandbox', 'electron-builder --linux deb'],
    ['release.yml', 'build-linux', 'electron-builder --linux']
]) {
    test(`${file} ${jobName}: lintian по собранному deb — после сборки, до выкладки`, () => {
        const job = yamlCode(jobBlock(read(file), jobName) || '');
        assert.ok(job, `нет job ${jobName}`);
        const step = stepBlock(job, 'lintian');
        assert.ok(step, `в ${jobName} нет шага lintian`);
        assert.match(step, /bash scripts\/lintian-check\.sh "?\$\(ls dist\/\*\.deb\)"?/, 'шаг не зовёт общий scripts/lintian-check.sh по собранному deb');
        assert.doesNotMatch(step, /continue-on-error:\s*true/, 'шаг lintian неблокирующий');
        const build = job.indexOf(buildCmd);
        const lint = job.indexOf('lintian-check.sh');
        const upload = job.indexOf('upload-artifact');
        assert.ok(build > -1 && build < lint && lint < upload,
            'lintian обязан идти после сборки и до выкладки deb — битый пакет не должен уезжать дальше');
    });
}

// ── P3: установленный deb на живой системе ──────────────────────────────────
const LAUNCH_CHECK = fs.readFileSync(path.join(ROOT, 'scripts', 'linux-launch-check.sh'), 'utf8');
/** Скрипт без строк-комментариев: пояснение не засчитывается как проверка. */
const launchCode = LAUNCH_CHECK.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('launch-check умеет требовать ОТКАЗ собранного приложения от ключа', () => {
    assert.match(launchCode, /--expect-refuse-switch\)/, 'нет разбора --expect-refuse-switch');
    // Ограничение по времени обязательно: без него «принял ключ и работает»
    // выглядело бы как зависший шаг, а не как провал проверки.
    assert.match(launchCode, /timeout[^\n]*\b20\b[^\n]*"\/usr\/bin\/\$EXE" "--\$/, 'запуск с ключом не ограничен timeout 20');
    assert.match(launchCode, /runuser -u "\$APP_USER"[^\n]*\\\n\s*timeout /, 'отказ проверяется не от обычного пользователя');
    // Ожидается ровно 1: 124 — timeout (ключ принят, приложение работало),
    // 0 — вышло «успешно», иное — упало. Все три — провал.
    assert.match(launchCode, /"\$RC" = 1/, 'код отказа не сверяется с 1');
    assert.match(launchCode, /\b124[|)]/, 'код 124 (timeout) не разобран отдельно');
    // Код 1 бывает и у падения: отказ подтверждается строкой гарда.
    assert.match(launchCode, /ослабляет изоляцию/, 'код 1 не сверен с сообщением гарда electron-main.js');
    const guard = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');
    assert.match(guard, /ослабляет изоляцию собранного приложения — выход/, 'сообщение гарда изменилось — launch-check ищет старое');
});

const RUNNER = yamlCode(jobBlock(NODEJS, 'deb-launch-runner') || '');

test('deb-launch-runner: --no-sandbox отвергается собранным приложением', () => {
    assert.ok(RUNNER, 'нет job deb-launch-runner');
    assert.match(RUNNER, /linux-launch-check\.sh --expect-refuse-switch no-sandbox/, 'нет шага отказа от --no-sandbox');
    const launch = RUNNER.indexOf('--expect ${{ matrix.path }}');
    const refuse = RUNNER.indexOf('--expect-refuse-switch no-sandbox');
    assert.ok(launch > -1 && launch < refuse, 'отказ проверяется до успешного запуска — «код 1» мог бы значить «не стартует вовсе»');
});

test('deb-launch-runner: purge убирает профиль AppArmor и ссылку, но не трогает $HOME', () => {
    const purge = stepBlock(RUNNER, 'Purge');
    assert.ok(purge, 'нет шага Purge');
    assert.match(purge, /apt-get purge -y timer-widget/, 'шаг не делает apt-get purge');
    assert.match(purge, /\/etc\/apparmor\.d\/timer-widget/, 'после purge не проверяется профиль AppArmor');
    assert.match(purge, /\/usr\/bin\/timer-widget/, 'после purge не проверяется /usr/bin/timer-widget');
    assert.match(purge, /update-alternatives --query timer-widget/, 'после purge не проверяется alternatives');
    // purge по пакету, которого dpkg уже не помнит, «проходит», ничего не
    // запустив. До purge пакет обязан быть установлен, и это проверено.
    const status = purge.indexOf("'install ok installed'");
    assert.ok(status > -1 && status < purge.indexOf('apt-get purge'), 'до purge не проверено, что пакет установлен');
    // P2 на живой системе: метка в ~/.config/timer-widget переживает purge.
    assert.match(purge, /\.config\/timer-widget\/[^\s"]+/, 'не проверено, что purge не тронул настройки пользователя');
});

test('deb-launch-runner: обновление с опубликованного 2.11.0 — отдельная ячейка матрицы', () => {
    assert.match(RUNNER, /install: \[fresh\]/, 'нет оси install в матрице');
    assert.match(RUNNER, /include:\s*\n\s*- path: userns\s*\n\s*install: upgrade/, 'нет ячейки install: upgrade');
    const base = stepBlock(RUNNER, 'Install published');
    assert.ok(base, 'нет шага установки опубликованной версии');
    assert.match(base, /if: matrix\.install == 'upgrade'/, 'база обновления ставится не только в своей ячейке');
    assert.match(base, /gh release download v2\.11\.0[^\n]*-p 'TimerWidget-2\.11\.0-amd64\.deb'/, 'не качается опубликованный deb 2.11.0');
    assert.match(base, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'gh без GH_TOKEN не скачает релиз');
    assert.match(base, /sha256sum -c/, 'опубликованный deb не сверен с SHA256SUMS.txt');
    const upgrade = stepBlock(RUNNER, 'Upgrade');
    assert.ok(upgrade, 'нет шага обновления до собранного deb');
    assert.match(upgrade, /if: matrix\.install == 'upgrade'/);
    // Обновление доказывается СОДЕРЖИМЫМ: app.asar на диске = из нового deb.
    assert.match(upgrade, /app\.asar/, 'не проверено, что на диске оказался новый app.asar');
    const fresh = stepBlock(RUNNER, 'Install deb');
    assert.match(fresh, /if: matrix\.install == 'fresh'/, 'чистая установка идёт и в ячейке обновления');
});

// ── P4: сторонние actions закреплены SHA ─────────────────────────────────────
// Тег (`@v7`) — изменяемая ссылка: владелец action или тот, кто угнал его
// репозиторий, передвигает тег, и следующий прогон CI и релиза исполняет чужой
// код с токеном репозитория. Полный SHA коммита неизменяем; комментарий
// `# vX.Y.Z` — для человека и для Dependabot, который обновляет и SHA, и его.
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

/** Все `uses:` workflow, кроме локальных (`./`) и docker://. */
function thirdPartyUses(src) {
    return src.split('\n')
        .map((l) => l.match(/^\s*(?:- )?uses:\s*(.+?)\s*$/))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((u) => !u.startsWith('./') && !u.startsWith('docker://'));
}

test('каждая сторонняя action закреплена полным SHA с комментарием-версией', () => {
    // Проверка себя: зонд находит `uses:` в обеих формах и отличает тег от SHA.
    const sample = '      - uses: actions/checkout@v7\n        uses: a/b@0123456789abcdef0123456789abcdef01234567 # v1.2.3\n      - uses: ./local\n';
    const found = thirdPartyUses(sample);
    assert.deepEqual(found, ['actions/checkout@v7', 'a/b@0123456789abcdef0123456789abcdef01234567 # v1.2.3']);
    assert.equal(found.filter((u) => !PINNED.test(u)).length, 1, 'зонд не видит незакреплённую action');
    assert.ok(!PINNED.test('a/b@0123456789abcdef0123456789abcdef01234567'), 'SHA без комментария-версии засчитан');

    const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    let total = 0;
    const loose = [];
    for (const f of files) {
        for (const u of thirdPartyUses(read(f))) {
            total++;
            if (!PINNED.test(u)) { loose.push(`${f}: ${u}`); }
        }
    }
    assert.ok(total >= 10, `найдено всего ${total} uses — зонд сломан`);
    assert.deepEqual(loose, [], `не закреплены SHA:\n${loose.join('\n')}`);
});
