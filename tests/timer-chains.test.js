'use strict';

/**
 * timer-chains.test.js
 *
 * Случайные цепочки команд поверх НАСТОЯЩИХ timer-controller + timer-engine на
 * поддельных часах. timer-controller.test.js проверяет сценарии, которые кто-то
 * придумал; здесь — порядок, который никто не придумал: «пауза из финиша, потом
 * сон, потом снижение лимита». При падении fast-check сам ужимает цепочку до
 * минимальной и печатает её вместе с seed.
 *
 * Seed закреплён: красный CI воспроизводится локально. Поиск вширь — разово:
 *   FC_SEED=$RANDOM FC_RUNS=200000 node --test tests/timer-chains.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const engine = require('../timer-engine');
const { createTimerController } = require('../timer-controller');

const { MAX_SECONDS } = engine;
const FC_OPTS = {
    seed: Number(process.env.FC_SEED) || 20261102,
    numRuns: Number(process.env.FC_RUNS) || 3000
};

function makeWorld() {
    const world = { wall: 1_000_000, mono: 0, states: [], events: [] };
    world.controller = createTimerController({
        engine,
        now: () => world.wall,
        monotonic: () => world.mono,
        onState: (s) => world.states.push(s),
        onEvent: (n) => world.events.push(n)
    });
    return world;
}

// Команды — ровно те, что доступны главному процессу (main-timer.js).
const opArb = fc.oneof(
    fc.record({ op: fc.constant('advance'), ms: fc.integer({ min: 0, max: 200_000 }) }),
    fc.record({ op: fc.constant('tick') }),
    fc.record({ op: fc.constant('start') }),
    fc.record({ op: fc.constant('pause') }),
    fc.record({ op: fc.constant('reset') }),
    fc.record({ op: fc.constant('set'), seconds: fc.oneof(fc.integer({ min: 0, max: 7200 }), fc.constant(MAX_SECONDS)) }),
    fc.record({ op: fc.constant('adjust'), delta: fc.oneof(fc.integer({ min: -600, max: 600 }), fc.constant(MAX_SECONDS), fc.constant(-MAX_SECONDS)) }),
    fc.record({ op: fc.constant('config'), allowNegative: fc.boolean() }),
    fc.record({ op: fc.constant('limit'), seconds: fc.integer({ min: 0, max: 600 }) }),
    fc.record({ op: fc.constant('interval'), minutes: fc.integer({ min: 1, max: 10 }) }),
    fc.record({ op: fc.constant('sleep'), ms: fc.integer({ min: 0, max: 500_000 }) }),
    fc.record({ op: fc.constant('wallJump'), ms: fc.integer({ min: -3_600_000, max: 3_600_000 }) })
);

function apply(world, cmd) {
    const c = world.controller;
    switch (cmd.op) {
    case 'advance': world.mono += cmd.ms; world.wall += cmd.ms; break;
    case 'tick': c.reconcile(); break;
    case 'start': c.start(); break;
    case 'pause': c.pause(); break;
    case 'reset': c.reset(); break;
    case 'set': c.setPreset(cmd.seconds); break;
    case 'adjust': c.adjust(cmd.delta); break;
    case 'config': c.setConfig({ allowNegative: cmd.allowNegative }); break;
    case 'limit': c.setConfig({ overrunLimitSeconds: cmd.seconds }); break;
    case 'interval': c.setConfig({ overrunIntervalMinutes: cmd.minutes }); break;
    case 'sleep': c.suspend(); world.wall += cmd.ms; c.resume(); break;
    case 'wallJump': world.wall += cmd.ms; break;
    default: throw new Error(`неизвестная команда ${cmd.op}`);
    }
}

function assertSane(world) {
    const s = world.controller.getState();
    for (const key of ['totalSeconds', 'remainingSeconds', 'presetSeconds']) {
        assert.ok(Number.isSafeInteger(s[key]), `${key} не целое: ${s[key]}`);
    }
    assert.ok(s.remainingSeconds <= MAX_SECONDS, `остаток выше потолка: ${s.remainingSeconds}`);
    assert.ok(s.remainingSeconds >= -MAX_SECONDS, `минус ниже потолка формата: ${s.remainingSeconds}`);
    assert.ok(s.totalSeconds >= 0 && s.totalSeconds <= MAX_SECONDS, `тотал вне диапазона: ${s.totalSeconds}`);
    assert.ok(!(s.isRunning && s.isPaused), 'идёт и на паузе одновременно');
    assert.ok(!(s.finished && (s.isRunning || s.isPaused)), 'закончен, но идёт или на паузе');
    const next = world.controller.msUntilNextSecond();
    if (s.isRunning) {
        assert.ok(next > 0 && next <= 1000, `до следующей секунды ${next} мс`);
    } else {
        assert.equal(next, null);
    }
}

test('любая цепочка: состояние остаётся допустимым, счётчик рассылок только растёт', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 60 }), (cmds) => {
        const world = makeWorld();
        for (const cmd of cmds) {
            apply(world, cmd);
            assertSane(world);
        }
        world.states.forEach((s, i) => {
            if (i > 0) { assert.equal(s.updateCounter, world.states[i - 1].updateCounter + 1); }
        });
    }), FC_OPTS);
});

test('сверка без хода времени ничего не меняет и никого не будит', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (cmds) => {
        const world = makeWorld();
        for (const cmd of cmds) { apply(world, cmd); }
        world.controller.reconcile();
        const emitted = world.states.length;
        const events = world.events.length;
        world.controller.reconcile();
        assert.equal(world.states.length, emitted);
        assert.equal(world.events.length, events);
    }), FC_OPTS);
});

test('сброс из любого состояния: стоит, на значении пресета, без защёлки финиша', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (cmds) => {
        const world = makeWorld();
        for (const cmd of cmds) { apply(world, cmd); }
        world.controller.reset();
        const s = world.controller.getState();
        assert.equal(s.isRunning, false);
        assert.equal(s.isPaused, false);
        assert.equal(s.finished, false);
        assert.equal(s.remainingSeconds, s.totalSeconds);
    }), FC_OPTS);
});

test('без минуса таймер, запущенный из плюса, не уходит ниже нуля', () => {
    const noNegative = opArb.filter((c) => c.op !== 'config');
    fc.assert(fc.property(fc.array(noNegative, { maxLength: 60 }), (cmds) => {
        const world = makeWorld();
        for (const cmd of cmds) {
            apply(world, cmd);
            assert.ok(world.controller.getState().remainingSeconds >= 0);
        }
    }), FC_OPTS);
});

// Модель времени: сколько таймер шёл на САМОМ деле — считает сам тест. Паузы,
// поправки, перевод часов и сон не должны ни терять, ни дарить ни секунды.
test('отсчёт точен: табло = пресет + поправки − прошедшее время в ходе', () => {
    const timeOp = fc.oneof(
        fc.record({ op: fc.constant('advance'), ms: fc.integer({ min: 0, max: 5000 }) }),
        fc.record({ op: fc.constant('tick') }),
        fc.record({ op: fc.constant('start') }),
        fc.record({ op: fc.constant('pause') }),
        fc.record({ op: fc.constant('adjust'), delta: fc.integer({ min: -60, max: 60 }) }),
        fc.record({ op: fc.constant('sleep'), ms: fc.integer({ min: 0, max: 30_000 }) }),
        fc.record({ op: fc.constant('wallJump'), ms: fc.integer({ min: -3_600_000, max: 3_600_000 }) })
    );
    fc.assert(fc.property(fc.array(timeOp, { maxLength: 80 }), (cmds) => {
        const world = makeWorld();
        const c = world.controller;
        c.setConfig({ allowNegative: true });
        c.setPreset(100_000);
        let ranMs = 0;
        let adjusted = 0;
        for (const cmd of cmds) {
            const running = c.getState().isRunning;
            if (cmd.op === 'advance' && running) { ranMs += cmd.ms; }
            if (cmd.op === 'sleep' && running) { ranMs += cmd.ms; }
            if (cmd.op === 'adjust') { adjusted += cmd.delta; }
            apply(world, cmd);
        }
        c.reconcile();
        assert.equal(c.getState().remainingSeconds, 100_000 + adjusted - Math.floor(ranMs / 1000));
    }), FC_OPTS);
});

test('ход без команд: табло только убывает, ноль пересекается один раз', () => {
    const stepsArb = fc.array(fc.integer({ min: 1, max: 90_000 }), { minLength: 1, maxLength: 40 });
    fc.assert(fc.property(fc.integer({ min: 1, max: 600 }), stepsArb, (seconds, steps) => {
        const world = makeWorld();
        const c = world.controller;
        c.setConfig({ allowNegative: true });
        c.setPreset(seconds);
        c.start();
        let prev = c.getState().remainingSeconds;
        for (const ms of steps) {
            world.mono += ms;
            world.wall += ms;
            c.reconcile();
            const cur = c.getState().remainingSeconds;
            assert.ok(cur <= prev, `табло выросло: ${prev} → ${cur}`);
            prev = cur;
        }
        const zero = world.events.filter((n) => n === 'timer-reached-zero').length;
        assert.equal(zero, prev <= 0 ? 1 : 0);
    }), FC_OPTS);
});

test('лимит перелимита: идущий таймер всегда выше границы, дошедший — закончен', () => {
    fc.assert(fc.property(
        fc.integer({ min: 1, max: 600 }), fc.integer({ min: 1, max: 600 }),
        fc.array(fc.integer({ min: 1, max: 90_000 }), { minLength: 1, maxLength: 40 }),
        (seconds, limit, steps) => {
            const world = makeWorld();
            const c = world.controller;
            c.setConfig({ allowNegative: true, overrunLimitSeconds: limit });
            c.setPreset(seconds);
            c.start();
            for (const ms of steps) {
                world.mono += ms;
                c.reconcile();
                const s = c.getState();
                if (s.isRunning) { assert.ok(s.remainingSeconds > -limit); } else { assert.ok(s.finished); }
            }
        }
    ), FC_OPTS);
});

// Лимит могут снизить посреди перелимита (MAIN-04): таймер встаёт на ТЕКУЩЕМ
// минусе, а не отматывается к новой границе.
test('снижение лимита посреди хода не отматывает табло назад', () => {
    const stepArb = fc.record({
        ms: fc.integer({ min: 1, max: 90_000 }),
        limit: fc.option(fc.integer({ min: 1, max: 600 }), { nil: undefined })
    });
    fc.assert(fc.property(fc.integer({ min: 1, max: 60 }), fc.array(stepArb, { minLength: 1, maxLength: 40 }), (seconds, steps) => {
        const world = makeWorld();
        const c = world.controller;
        c.setConfig({ allowNegative: true });
        c.setPreset(seconds);
        c.start();
        let prev = c.getState().remainingSeconds;
        for (const { ms, limit } of steps) {
            if (limit !== undefined) { c.setConfig({ overrunLimitSeconds: limit }); }
            world.mono += ms;
            c.reconcile();
            const cur = c.getState().remainingSeconds;
            assert.ok(cur <= prev, `табло выросло: ${prev} → ${cur}`);
            prev = cur;
        }
    }), FC_OPTS);
});

// Найдено этим файлом 02.11.2026: adjust минус ограничивал, а ход секунд — нет.
test('минус на потолке формата: таймер встаёт на −99:59:59, а не уходит ниже', () => {
    const world = makeWorld();
    const c = world.controller;
    c.setConfig({ allowNegative: true });
    c.adjust(-MAX_SECONDS);
    c.start();
    world.mono += 5000;
    c.reconcile();
    const s = c.getState();
    assert.equal(s.remainingSeconds, -MAX_SECONDS);
    assert.equal(s.isRunning, false);
    assert.equal(s.finished, true);
});
