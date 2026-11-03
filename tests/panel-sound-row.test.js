'use strict';

/**
 * Подпись строки «Звуки» и подсказка в подвале панели — ОТЧЁТЫ о настройках
 * звука, а не реклама (визуальный аудит 03.11.2026).
 *
 * Было: строка «Звуки» всегда говорила «сигналы старта, минуты и финиша» —
 * текст из разметки, хотя по умолчанию включено одно окончание, а «минута» —
 * это сигнал за минуту до конца. Подвал в перерасходе обещал «Уведомление
 * каждые 1 мин» при ВЫКЛЮЧЕННОМ звуке перерасхода (умолчание) и при
 * выключенном мастер-звуке, и склонял «каждые 1».
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { soundRowSubtitle, panelFooterText } = require('../panel-state.js');

const ALL_OFF = { master: true, start: false, end: false, minute: false, overrun: false };

test('soundRowSubtitle: умолчание — только окончание', () => {
    assert.equal(soundRowSubtitle({ ...ALL_OFF, end: true }), 'окончание');
});

test('soundRowSubtitle: включённые сигналы перечислены в порядке таймера', () => {
    assert.equal(
        soundRowSubtitle({ master: true, start: true, end: true, minute: true, overrun: true }),
        'старт · за минуту · окончание · перерасход'
    );
    assert.equal(soundRowSubtitle({ ...ALL_OFF, overrun: true, start: true }), 'старт · перерасход');
});

test('soundRowSubtitle: мастер выключен — так и сказано, каким бы ни был выбор', () => {
    assert.equal(soundRowSubtitle({ master: false, start: true, end: true, minute: true, overrun: true }), 'звук выключен');
});

test('soundRowSubtitle: ни одного сигнала — не пустая строка', () => {
    assert.equal(soundRowSubtitle(ALL_OFF), 'сигналы не выбраны');
});

test('soundRowSubtitle: мусор не роняет панель', () => {
    assert.equal(soundRowSubtitle(null), '');
    assert.equal(soundRowSubtitle(undefined), '');
});

test('panelFooterText: уведомление обещано, только когда оно прозвучит', () => {
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: 5 }), 'Уведомление каждые 5 мин');
    // Звук перерасхода или мастер выключен — вызывающий передаёт null.
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: null }), 'Space — стоп · R — сброс');
});

test('panelFooterText: «каждую минуту», а не «каждые 1 мин»', () => {
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: 1 }), 'Уведомление каждую минуту');
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: 2 }), 'Уведомление каждые 2 мин');
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: 21 }), 'Уведомление каждую 21 мин');
    assert.equal(panelFooterText({ mode: 'overtime', paused: false, overrunEvery: 11 }), 'Уведомление каждые 11 мин');
});

test('panelFooterText: остальные состояния не изменились', () => {
    assert.equal(panelFooterText({ mode: 'overtime', paused: true, overrunEvery: 5 }), 'Space — продолжить · R — сброс');
    assert.equal(panelFooterText({ mode: 'running', paused: true, overrunEvery: null }), 'Space — продолжить · R — сброс');
    assert.equal(panelFooterText({ mode: 'running', paused: false, overrunEvery: 5 }), 'Space — пауза · R — сброс');
    assert.equal(panelFooterText({ mode: 'idle', paused: false, overrunEvery: 5 }), 'Space — старт · R — сброс · 1–4 — пресеты');
    assert.equal(panelFooterText({ mode: 'input', paused: false, overrunEvery: null }), 'Space — старт · R — сброс · 1–4 — пресеты');
});
