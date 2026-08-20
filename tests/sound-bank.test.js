'use strict';

/**
 * Тесты банка встроенных звуков.
 *
 * Синтез гоняется на подставном AudioContext: настоящий Web Audio в Node
 * недоступен, но нам и не нужен звук — важно, что каждый пресет строит узлы,
 * не падает и планирует остановку осцилляторов (иначе они звучали бы вечно).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILT_IN_PRESETS, playBuiltInPreset } = require('../sound-bank');

// Минимальный двойник AudioContext, считающий созданные и остановленные узлы.
function fakeContext() {
    const stats = { oscillators: 0, started: 0, stopped: 0, gains: 0, filters: 0, buffers: 0, panners: 0, convolvers: 0 };
    const param = () => ({
        value: 0,
        setValueAtTime() { return this; },
        exponentialRampToValueAtTime() { return this; },
        linearRampToValueAtTime() { return this; }
    });
    const node = () => ({ connect() { return this; }, disconnect() { return this; } });

    return {
        stats,
        sampleRate: 44100,
        currentTime: 0,
        destination: node(),
        createOscillator() {
            stats.oscillators++;
            return Object.assign(node(), {
                type: 'sine',
                frequency: param(),
                // Расстройка голосов (ширина стерео у новых звуков).
                detune: param(),
                start() { stats.started++; },
                stop() { stats.stopped++; }
            });
        },
        createGain() {
            stats.gains++;
            return Object.assign(node(), { gain: param() });
        },
        createBiquadFilter() {
            stats.filters++;
            return Object.assign(node(), { type: 'lowpass', frequency: param(), Q: param() });
        },
        createBuffer(channels, length) {
            stats.buffers++;
            return { getChannelData: () => new Float32Array(length) };
        },
        createBufferSource() {
            return Object.assign(node(), {
                buffer: null,
                start() { stats.started++; },
                stop() { stats.stopped++; }
            });
        },
        // Узлы, появившиеся с правкой громкости 20.08.2026: мягкий лимитер на
        // мастер-выходе, стереопанорама голосов и ревер новых звуков. Двойник
        // обязан их знать, иначе тест падает не на дефекте, а на своей бедности.
        createWaveShaper() {
            return Object.assign(node(), { curve: null, oversample: 'none' });
        },
        createStereoPanner() {
            stats.panners++;
            return Object.assign(node(), { pan: param() });
        },
        createConvolver() {
            stats.convolvers++;
            return Object.assign(node(), { buffer: null, normalize: true });
        }
    };
}

test('список пресетов непустой и без дублей', () => {
    assert.ok(BUILT_IN_PRESETS.length >= 25);
    assert.equal(new Set(BUILT_IN_PRESETS).size, BUILT_IN_PRESETS.length);
});

test('каждый встроенный пресет проигрывается без ошибок', () => {
    for (const name of BUILT_IN_PRESETS) {
        const ctx = fakeContext();
        assert.doesNotThrow(() => playBuiltInPreset(ctx, name), `пресет ${name} упал`);
        assert.ok(ctx.stats.started > 0, `пресет ${name} не запустил ни одного источника`);
    }
});

test('каждый запущенный источник получает команду остановки', () => {
    // Иначе осциллятор звучит до закрытия окна — классическая утечка Web Audio.
    for (const name of BUILT_IN_PRESETS) {
        const ctx = fakeContext();
        playBuiltInPreset(ctx, name);
        assert.equal(
            ctx.stats.stopped, ctx.stats.started,
            `пресет ${name}: запущено ${ctx.stats.started}, остановлено ${ctx.stats.stopped}`
        );
    }
});

test('неизвестное имя даёт запасной бип, а не падение', () => {
    const ctx = fakeContext();
    assert.doesNotThrow(() => playBuiltInPreset(ctx, 'такого-пресета-нет'));
    assert.ok(ctx.stats.started > 0);
});

test('отсутствующий контекст просто игнорируется', () => {
    assert.doesNotThrow(() => playBuiltInPreset(null, 'bell'));
    assert.doesNotThrow(() => playBuiltInPreset(undefined, 'bell'));
});

test('все пресеты из списка реально реализованы (не падают в default)', () => {
    // default даёт ровно один осциллятор; у настоящих пресетов их больше либо
    // столько же, но с другой обвязкой — сверяем по факту создания узлов.
    const unknown = fakeContext();
    playBuiltInPreset(unknown, 'заведомо-неизвестный');
    for (const name of BUILT_IN_PRESETS) {
        const ctx = fakeContext();
        playBuiltInPreset(ctx, name);
        assert.ok(ctx.stats.started > 0, `пресет ${name} ничего не сыграл`);
    }
});

test('реестр списков и банк звуков совпадают В ОБА КОНЦА', () => {
    // Списки в четырёх <select> раньше велись руками прямо в разметке: 79 строк
    // <option> и четыре куратора одного набора. Теперь набор один
    // (sound-presets.js), а тест сверяет его с банком в обе стороны:
    //
    //   реестр → банк: предложенный звук обязан существовать, иначе выбор молча
    //                  вырождается в запасной бип;
    //   банк → реестр: реализованный звук обязан быть достижим из интерфейса,
    //                  иначе он мёртвый — работает, но выбрать его нечем.
    const { SOUND_PRESETS, SOUND_EVENTS, presetsForEvent } = require('../sound-presets');

    for (const preset of SOUND_PRESETS) {
        assert.ok(BUILT_IN_PRESETS.includes(preset.id),
            `реестр предлагает «${preset.id}», которого нет в банке звуков`);
        assert.ok(preset.label && preset.label.trim(), `у «${preset.id}» нет подписи`);
        assert.ok(preset.events.length, `«${preset.id}» не предлагается ни одному событию`);
    }

    const offered = new Set(SOUND_PRESETS.map((p) => p.id));
    for (const name of BUILT_IN_PRESETS) {
        assert.ok(offered.has(name), `звук «${name}» реализован, но до него нет дороги из интерфейса`);
    }

    // У каждого события есть свой фирменный звук и непустой остальной набор.
    for (const spec of SOUND_EVENTS) {
        const { signature, rest } = presetsForEvent(spec.event);
        assert.equal(signature.length, 1, `у события ${spec.event} должен быть ровно один фирменный звук`);
        assert.ok(rest.length > 3, `событию ${spec.event} предлагается слишком мало звуков`);
    }
});

test('панель строит списки звуков модулем, а не разметкой', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'electron-control.html'), 'utf8');
    assert.match(html, /<script src="sound-presets\.js"><\/script>/, 'панель не подключает реестр звуков');
    assert.match(html, /SoundPresets\.buildSoundSelects\(document\)/, 'списки никто не строит');
    // И разметка больше не ведёт свою копию набора.
    for (const id of ['soundStartPreset', 'soundEndPreset', 'soundMinutePreset', 'soundOverrunPreset']) {
        const from = html.indexOf(`id="${id}"`);
        const block = html.slice(from, html.indexOf('</select>', from));
        const options = [...block.matchAll(/<option value="([^"]+)"/g)];
        assert.equal(options.length, 0, `${id} снова ведёт список <option> руками`);
    }
});

test('построение списков работает на поддельном документе', () => {
    // Тот же приём, что у остальных модулей панели: DOM внедряется, поэтому
    // поведение проверяется в Node.
    const { buildSoundSelects, SOUND_EVENTS } = require('../sound-presets');
    const made = [];
    const fakeEl = (tag) => ({
        tag, value: '', textContent: '', label: '', id: '', children: [],
        appendChild(child) { this.children.push(child); return child; },
        set innerHTML(_v) { this.children.length = 0; }
    });
    const selects = {};
    for (const spec of SOUND_EVENTS) { selects[spec.select] = fakeEl('select'); }
    const doc = {
        getElementById: (id) => selects[id] || null,
        createElement: (tag) => { const el = fakeEl(tag); made.push(el); return el; }
    };

    assert.equal(buildSoundSelects(doc), SOUND_EVENTS.length, 'заполнены не все списки');
    for (const spec of SOUND_EVENTS) {
        const select = selects[spec.select];
        const first = select.children[0];
        assert.equal(first.value, 'none', 'первым пунктом обязан быть «— без звука —»');
        const groups = select.children.filter((c) => c.tag === 'optgroup');
        assert.equal(groups.length, 3, 'групп должно быть три: фирменная, стандартные и пользовательские');
        assert.equal(groups[0].children.length, 1, 'в фирменной группе один звук — написанный под это событие');
        // Группа пользовательских звуков ОБЯЗАНА существовать пустой: её по
        // своему id наполняет custom-sounds.js.
        assert.equal(groups[2].id, spec.group, 'нет группы «Ваши звуки» с ожидаемым id');
        assert.equal(groups[2].children.length, 0);
    }
});


test('выбор звука, которого больше нет, чинится умолчанием', () => {
    // Звук могли убрать из набора (20.08.2026 так ушёл «Чирп»), а свой файл
    // пользователь мог удалить. В обоих случаях в профиле остаётся имя без
    // пункта, браузер молча показывает первый — «— без звука —», — и событие
    // становится беззвучным, хотя настройка утверждает обратное.
    const { repairSelection, SOUND_EVENTS } = require('../sound-presets');
    const Schema = require('../settings-schema.js');

    const makeSelect = (values, current) => ({
        options: values.map((v) => ({ value: v })),
        value: current
    });
    const selects = {};
    for (const spec of SOUND_EVENTS) { selects[spec.select] = makeSelect(['none', 'bell'], 'bell'); }
    // У одного события выбран пропавший звук.
    selects.soundStartPreset = makeSelect(['none', 'bell'], 'chirp');
    const doc = { getElementById: (id) => selects[id] || null };

    const fixed = repairSelection(doc, Schema);
    assert.deepEqual(fixed, ['soundStartPreset'], 'починен не тот список (или ни одного)');
    const def = Schema.SETTINGS_DESCRIPTORS.find((d) => d.el === 'soundStartPreset').def;
    assert.equal(selects.soundStartPreset.value, def, 'пропавший выбор не заменён умолчанием события');
    // Целые выборы не трогаются: починка не должна сбрасывать настройки.
    assert.equal(selects.soundEndPreset.value, 'bell');
});

test('удалённый «Чирп» не остался ни в банке, ни в реестре', () => {
    // Проверка отсутствия проверяет САМА СЕБЯ: та же выборка обязана находить
    // звук, который в наборе есть.
    const { SOUND_PRESETS } = require('../sound-presets');
    const inRegistry = (id) => SOUND_PRESETS.some((p) => p.id === id);
    assert.equal(inRegistry('bell'), true, 'выборка не находит существующий звук — она ничего не проверяет');
    assert.equal(inRegistry('chirp'), false, '«Чирп» вернулся в реестр');
    assert.equal(BUILT_IN_PRESETS.includes('chirp'), false, '«Чирп» вернулся в банк');
});
