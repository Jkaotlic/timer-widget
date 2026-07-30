'use strict';

/**
 * sound-bank.js — банк встроенных звуков, синтезируемых через Web Audio API.
 *
 * Вынесен из inline-скрипта electron-control.html: это была самая крупная
 * самодостаточная часть панели (≈470 строк из ~3100) — чистый синтез без единого
 * обращения к DOM, состоянию таймера или настройкам. Держать её внутри
 * god-файла не было причин, а её присутствие мешало видеть остальную логику.
 *
 * Модуль НЕ владеет AudioContext: контекст создаёт и переиспользует вызывающая
 * сторона (браузеры ограничивают число одновременных контекстов ~6, поэтому он
 * там один на всё окно). Сюда он приходит аргументом уже «разбуженным».
 *
 * Пользовательские звуки (`custom:<имя>`) остаются в панели — они читают
 * localStorage и играются через <audio>, а не через осцилляторы.
 *
 * Двойной экспорт как у utils.js: window.SoundBank в рендерере, module.exports
 * в Node для тестов.
 */

// Имена всех встроенных пресетов. Держится рядом с реализацией, чтобы список в
// <select> и набор веток switch нельзя было незаметно рассинхронизировать.
const BUILT_IN_PRESETS = [
    'beep-short', 'beep-long', 'triple', 'chirp', 'bell', 'ding', 'whoosh',
    'click', 'alarm', 'fanfare', 'gong', 'tick', 'soft-alert', 'chime',
    'pulse', 'rising', 'drop', 'notification', 'countdown-tick', 'complete',
    'cymbal', 'deep-gong', 'air-horn', 'siren', 'church-bell', 'drum-roll',
    'ship-horn', 'metal-strike', 'epic-brass'
];

/**
 * Проигрывает встроенный пресет в переданном AudioContext.
 *
 * @param {AudioContext} ctx — уже созданный и возобновлённый контекст
 * @param {string} name — имя пресета; неизвестное имя даёт короткий бип
 */
function playBuiltInPreset(ctx, name) {
    if (!ctx) { return; }
            const g = ctx.createGain();
            g.connect(ctx.destination);
            g.gain.value = 0.0001;
            const now = ctx.currentTime;

            const beep = (freq, start, dur, type = 'sine') => {
                const o = ctx.createOscillator();
                o.type = type;
                o.frequency.value = freq;
                o.connect(g);
                g.gain.setValueAtTime(0.0001, start);
                g.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
                o.start(start);
                g.gain.exponentialRampToValueAtTime(0.0001, start + dur - 0.01);
                o.stop(start + dur);
            };

            switch (name) {
                case 'beep-short': 
                    beep(880, now, 0.15); 
                    break;
                case 'beep-long': 
                    beep(660, now, 0.4); 
                    break;
                case 'triple': 
                    beep(880, now, 0.12);
                    beep(980, now + 0.16, 0.12);
                    beep(1100, now + 0.32, 0.18);
                    break;
                case 'chirp': {
                    const o = ctx.createOscillator();
                    o.type = 'sawtooth';
                    o.connect(g);
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
                    o.frequency.setValueAtTime(400, now);
                    o.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
                    o.start(now);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.27);
                    o.stop(now + 0.28);
                    break;
                }
                case 'bell': {
                    // Колокольчик
                    [1975, 2637, 3520].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        o.frequency.value = freq;
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.15 / (i + 1), now + 0.01);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
                        o.start(now);
                        o.stop(now + 0.85);
                    });
                    break;
                }
                case 'ding': {
                    // Динь
                    const o = ctx.createOscillator();
                    o.type = 'sine';
                    o.frequency.value = 2093;
                    o.connect(g);
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.exponentialRampToValueAtTime(0.3, now + 0.005);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
                    o.start(now);
                    o.stop(now + 0.65);
                    break;
                }
                case 'whoosh': {
                    // Свист
                    const o = ctx.createOscillator();
                    o.type = 'sawtooth';
                    const filter = ctx.createBiquadFilter();
                    filter.type = 'bandpass';
                    filter.Q.value = 2;
                    o.connect(filter);
                    filter.connect(g);
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.exponentialRampToValueAtTime(0.15, now + 0.05);
                    o.frequency.setValueAtTime(200, now);
                    o.frequency.exponentialRampToValueAtTime(2000, now + 0.3);
                    filter.frequency.setValueAtTime(500, now);
                    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.3);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
                    o.start(now);
                    o.stop(now + 0.4);
                    break;
                }
                case 'click': {
                    // Клик
                    const o = ctx.createOscillator();
                    o.type = 'square';
                    o.frequency.value = 1000;
                    o.connect(g);
                    g.gain.setValueAtTime(0.3, now);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
                    o.start(now);
                    o.stop(now + 0.04);
                    break;
                }
                case 'alarm': {
                    // Будильник
                    for (let i = 0; i < 4; i++) {
                        beep(880, now + i * 0.25, 0.12);
                        beep(660, now + i * 0.25 + 0.12, 0.12);
                    }
                    break;
                }
                case 'fanfare': {
                    // Фанфары
                    const notes = [523, 659, 784, 1047, 784, 1047];
                    notes.forEach((freq, i) => {
                        beep(freq, now + i * 0.15, 0.14);
                    });
                    break;
                }
                case 'gong': {
                    // Гонг
                    const o1 = ctx.createOscillator();
                    const o2 = ctx.createOscillator();
                    o1.type = 'sine';
                    o2.type = 'sine';
                    o1.frequency.value = 110;
                    o2.frequency.value = 165;
                    const gongGain = ctx.createGain();
                    o1.connect(gongGain);
                    o2.connect(gongGain);
                    gongGain.connect(ctx.destination);
                    gongGain.gain.setValueAtTime(0.0001, now);
                    gongGain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
                    gongGain.gain.exponentialRampToValueAtTime(0.0001, now + 2);
                    o1.start(now);
                    o2.start(now);
                    o1.stop(now + 2.1);
                    o2.stop(now + 2.1);
                    break;
                }
                case 'tick': {
                    // Тик
                    const o = ctx.createOscillator();
                    o.type = 'square';
                    o.frequency.value = 800;
                    o.connect(g);
                    g.gain.setValueAtTime(0.2, now);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
                    o.start(now);
                    o.stop(now + 0.06);
                    break;
                }
                case 'soft-alert': {
                    // Мягкий сигнал
                    [440, 554, 659].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        o.frequency.value = freq;
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        env.gain.setValueAtTime(0.0001, now + i * 0.1);
                        env.gain.exponentialRampToValueAtTime(0.1, now + i * 0.1 + 0.02);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.3);
                        o.start(now + i * 0.1);
                        o.stop(now + i * 0.1 + 0.35);
                    });
                    break;
                }
                case 'chime': {
                    // Колокольный перезвон
                    [1318, 1175, 1046, 784].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now + i * 0.2);
                        env.gain.exponentialRampToValueAtTime(0.12, now + i * 0.2 + 0.01);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.2 + 0.6);
                        o.start(now + i * 0.2);
                        o.stop(now + i * 0.2 + 0.65);
                    });
                    break;
                }
                case 'pulse': {
                    // Пульсирующий бип
                    for (let i = 0; i < 5; i++) {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        o.frequency.value = 660;
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        env.gain.setValueAtTime(0.0001, now + i * 0.12);
                        env.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.08);
                        o.start(now + i * 0.12);
                        o.stop(now + i * 0.12 + 0.1);
                    }
                    break;
                }
                case 'rising': {
                    // Нарастающий тон
                    const o = ctx.createOscillator();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(300, now);
                    o.frequency.exponentialRampToValueAtTime(1200, now + 0.5);
                    o.connect(g);
                    g.gain.setValueAtTime(0.15, now);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
                    o.start(now);
                    o.stop(now + 0.6);
                    break;
                }
                case 'drop': {
                    // Падающий тон
                    const o = ctx.createOscillator();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(1200, now);
                    o.frequency.exponentialRampToValueAtTime(200, now + 0.4);
                    o.connect(g);
                    g.gain.setValueAtTime(0.15, now);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
                    o.start(now);
                    o.stop(now + 0.5);
                    break;
                }
                case 'notification': {
                    // iOS-стиль нотификация
                    [880, 1109, 1319].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'triangle';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now + i * 0.08);
                        env.gain.exponentialRampToValueAtTime(0.1, now + i * 0.08 + 0.01);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.2);
                        o.start(now + i * 0.08);
                        o.stop(now + i * 0.08 + 0.25);
                    });
                    break;
                }
                case 'countdown-tick': {
                    // Тик-так обратный отсчёт
                    for (let i = 0; i < 3; i++) {
                        const o = ctx.createOscillator();
                        o.type = 'square';
                        o.frequency.value = i < 2 ? 600 : 900;
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        env.gain.setValueAtTime(0.0001, now + i * 0.3);
                        env.gain.exponentialRampToValueAtTime(i < 2 ? 0.08 : 0.15, now + i * 0.3 + 0.01);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.3 + 0.06);
                        o.start(now + i * 0.3);
                        o.stop(now + i * 0.3 + 0.08);
                    }
                    break;
                }
                case 'complete': {
                    // Аккорд завершения
                    [523, 659, 784, 1047].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
                        o.start(now + i * 0.05);
                        o.stop(now + 1.3);
                    });
                    break;
                }
                case 'cymbal': {
                    // Тарелки (крэш) — белый шум через bandpass
                    const bufSize = ctx.sampleRate * 1.5;
                    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
                    const data = buf.getChannelData(0);
                    for (let i = 0; i < bufSize; i++) { data[i] = Math.random() * 2 - 1; }
                    const noise = ctx.createBufferSource();
                    noise.buffer = buf;
                    const hp = ctx.createBiquadFilter();
                    hp.type = 'highpass';
                    hp.frequency.value = 5000;
                    const bp = ctx.createBiquadFilter();
                    bp.type = 'bandpass';
                    bp.frequency.value = 8000;
                    bp.Q.value = 0.8;
                    const env = ctx.createGain();
                    noise.connect(hp);
                    hp.connect(bp);
                    bp.connect(env);
                    env.connect(ctx.destination);
                    env.gain.setValueAtTime(0.0001, now);
                    env.gain.exponentialRampToValueAtTime(0.35, now + 0.005);
                    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
                    noise.start(now);
                    noise.stop(now + 1.5);
                    break;
                }
                case 'deep-gong': {
                    // Глубокий гонг — низкие частоты с долгим затуханием
                    [65, 98, 131, 196].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.2 / (i + 1), now + 0.02);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 3);
                        o.start(now);
                        o.stop(now + 3.1);
                    });
                    break;
                }
                case 'air-horn': {
                    // Воздушный рожок — мощный гудок
                    [220, 277, 330].forEach((freq) => {
                        const o = ctx.createOscillator();
                        o.type = 'sawtooth';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.15, now + 0.05);
                        env.gain.setValueAtTime(0.15, now + 0.8);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
                        o.start(now);
                        o.stop(now + 1.3);
                    });
                    break;
                }
                case 'siren': {
                    // Сирена — волнообразный тон
                    const o = ctx.createOscillator();
                    o.type = 'sawtooth';
                    const filter = ctx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 2000;
                    o.connect(filter);
                    filter.connect(g);
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
                    for (let i = 0; i < 4; i++) {
                        o.frequency.setValueAtTime(500, now + i * 0.5);
                        o.frequency.exponentialRampToValueAtTime(1000, now + i * 0.5 + 0.25);
                        o.frequency.setValueAtTime(1000, now + i * 0.5 + 0.25);
                        o.frequency.exponentialRampToValueAtTime(500, now + i * 0.5 + 0.5);
                    }
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 2);
                    o.start(now);
                    o.stop(now + 2.1);
                    break;
                }
                case 'church-bell': {
                    // Церковный колокол — глубокий с обертонами
                    const fundamentals = [220, 440, 554, 660, 880];
                    fundamentals.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(ctx.destination);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.2 / (i + 1), now + 0.01);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 2.5 - i * 0.3);
                        o.start(now);
                        o.stop(now + 2.6);
                    });
                    break;
                }
                case 'drum-roll': {
                    // Барабанная дробь
                    const bufSize2 = ctx.sampleRate * 2;
                    const buf2 = ctx.createBuffer(1, bufSize2, ctx.sampleRate);
                    const data2 = buf2.getChannelData(0);
                    for (let i = 0; i < bufSize2; i++) { data2[i] = Math.random() * 2 - 1; }
                    const noise2 = ctx.createBufferSource();
                    noise2.buffer = buf2;
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.value = 300;
                    const env2 = ctx.createGain();
                    noise2.connect(lp);
                    lp.connect(env2);
                    env2.connect(ctx.destination);
                    // Нарастающая дробь
                    env2.gain.setValueAtTime(0.0001, now);
                    env2.gain.exponentialRampToValueAtTime(0.05, now + 0.1);
                    env2.gain.exponentialRampToValueAtTime(0.3, now + 1.2);
                    env2.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
                    noise2.start(now);
                    noise2.stop(now + 1.6);
                    break;
                }
                case 'ship-horn': {
                    // Корабельный гудок — глубокий низкий гул
                    [82, 110, 123].forEach((freq) => {
                        const o = ctx.createOscillator();
                        o.type = 'sawtooth';
                        const filter2 = ctx.createBiquadFilter();
                        filter2.type = 'lowpass';
                        filter2.frequency.value = 400;
                        const env3 = ctx.createGain();
                        o.connect(filter2);
                        filter2.connect(env3);
                        env3.connect(ctx.destination);
                        o.frequency.value = freq;
                        env3.gain.setValueAtTime(0.0001, now);
                        env3.gain.exponentialRampToValueAtTime(0.15, now + 0.1);
                        env3.gain.setValueAtTime(0.15, now + 1.5);
                        env3.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
                        o.start(now);
                        o.stop(now + 2.3);
                    });
                    break;
                }
                case 'metal-strike': {
                    // Металлический удар
                    [800, 1200, 2400, 3600].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = i < 2 ? 'square' : 'sine';
                        const env4 = ctx.createGain();
                        o.connect(env4);
                        env4.connect(ctx.destination);
                        o.frequency.value = freq;
                        env4.gain.setValueAtTime(0.0001, now);
                        env4.gain.exponentialRampToValueAtTime(0.2 / (i + 1), now + 0.003);
                        env4.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
                        o.start(now);
                        o.stop(now + 0.55);
                    });
                    break;
                }
                case 'epic-brass': {
                    // Эпичная труба — мажорный аккорд
                    const brass = [262, 330, 392, 523];
                    brass.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sawtooth';
                        const filter3 = ctx.createBiquadFilter();
                        filter3.type = 'lowpass';
                        filter3.frequency.value = 1200;
                        filter3.frequency.exponentialRampToValueAtTime(3000, now + 0.3);
                        const env5 = ctx.createGain();
                        o.connect(filter3);
                        filter3.connect(env5);
                        env5.connect(ctx.destination);
                        o.frequency.value = freq;
                        env5.gain.setValueAtTime(0.0001, now + i * 0.05);
                        env5.gain.exponentialRampToValueAtTime(0.1, now + i * 0.05 + 0.04);
                        env5.gain.setValueAtTime(0.1, now + 0.8);
                        env5.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
                        o.start(now + i * 0.05);
                        o.stop(now + 1.3);
                    });
                    break;
                }
                default:
                    beep(880, now, 0.15);
            }
}

const SoundBank = { BUILT_IN_PRESETS, playBuiltInPreset };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SoundBank;
}
if (typeof window !== 'undefined') {
    window.SoundBank = SoundBank;
}
