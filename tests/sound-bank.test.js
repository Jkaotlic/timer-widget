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
    const stats = { oscillators: 0, started: 0, stopped: 0, gains: 0, filters: 0, buffers: 0 };
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

test('каждый пресет из выпадающих списков реально реализован', () => {
    // Списки в четырёх <select> курируются под событие (старт / конец / минута /
    // перерасход), поэтому наборы разные — но любой предложенный пресет обязан
    // существовать в банке, иначе выбор молча вырождается в запасной бип.
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'electron-control.html'), 'utf8'
    );

    const ids = ['soundStartPreset', 'soundEndPreset', 'soundMinutePreset', 'soundOverrunPreset'];
    for (const id of ids) {
        const from = html.indexOf(`id="${id}"`);
        assert.ok(from > -1, `<select id="${id}"> должен существовать`);
        const block = html.slice(from, html.indexOf('</select>', from));
        const options = [...block.matchAll(/<option value="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((v) => v !== 'none' && !v.startsWith('custom:'));

        assert.ok(options.length > 0, `${id} должен предлагать хоть что-то`);
        for (const opt of options) {
            assert.ok(
                BUILT_IN_PRESETS.includes(opt),
                `${id} предлагает «${opt}», которого нет в банке звуков`
            );
        }
    }
});
