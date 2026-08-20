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
    // Четыре звука событий, написанных под КОНКРЕТНОЕ событие (20.08.2026).
    // Стоят первыми: они же умолчания в settings-schema.js.
    'start-boost', 'finish-chime', 'minute-mark', 'overrun-alert',
    'beep-short', 'beep-long', 'triple', 'bell', 'ding', 'whoosh',
    'click', 'alarm', 'fanfare', 'gong', 'tick', 'soft-alert', 'chime',
    'pulse', 'rising', 'drop', 'notification', 'countdown-tick', 'complete',
    'cymbal', 'deep-gong', 'air-horn', 'siren', 'church-bell', 'drum-roll',
    'ship-horn', 'metal-strike', 'epic-brass'
];

/**
 * ГРОМКОСТЬ — ЗАМЕРЕННАЯ, а не подобранная на слух.
 *
 * Жалоба 20.08.2026: «звуки убогие и тихие». Это оказалось не вкусовщиной:
 * рендер всех 29 пресетов в OfflineAudioContext дал пики −22…−6.5 dBFS и RMS
 * −47…−23 dBFS, тогда как уведомление должно жить на пике −3…−1 dBFS. То есть
 * банк звучал на 10–20 дБ ниже нормы — в 3–10 раз тише по восприятию.
 *
 * Почему не общий множитель: пики расходятся на 15 дБ, и один коэффициент либо
 * не спасает тихие, либо расплющивает громкие о лимитер. Здесь у каждого
 * пресета СВОЙ множитель, посчитанный как 0.7 / замеренный_пик.
 *
 * Таблица — производная от синтеза, и она может протухнуть: правка пресета
 * меняет его пик, а число здесь останется прежним. Поэтому проверяется не
 * таблица, а РЕЗУЛЬТАТ: e2e/sound-levels.spec.js рендерит каждый пресет и
 * требует пик в окне −6…−0.5 dBFS. Число, не подтверждённое замером, в этом
 * файле не живёт.
 */
const PRESET_GAIN = {
    'beep-short': 2.89, 'beep-long': 2.81, 'triple': 2.83,
    'bell': 2.66, 'ding': 2.35, 'whoosh': 8.77, 'click': 2.46,
    'alarm': 2.85, 'fanfare': 2.81, 'gong': 1.47, 'tick': 3.69,
    'soft-alert': 6.83, 'chime': 5.36, 'pulse': 4.71, 'rising': 4.72,
    'drop': 4.68, 'notification': 7.01, 'countdown-tick': 4.90,
    'complete': 5.11, 'air-horn': 1.98,
    'church-bell': 2.06, 'drum-roll': 8.04, 
    'metal-strike': 1.93, 'epic-brass': 2.19,
    // Новые написаны сразу в нужном уровне — им подъём не нужен.
    'start-boost': 1, 'finish-chime': 1, 'minute-mark': 1, 'overrun-alert': 1,
    // Переписаны 20.08.2026 сразу в нужном уровне.
    'ship-horn': 1, 'deep-gong': 1, 'cymbal': 1, 'siren': 1
};

/**
 * Мягкий лимитер: tanh вместо обрезки.
 *
 * Подъём уровня без него означал бы клиппинг — «щелчок» на пике, который в
 * колонках зала слышен как треск. tanh сжимает подходящие к единице значения
 * плавно, поэтому перегрузка звучит как насыщение, а не как поломка.
 */
function softClipCurve() {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = 2.2;
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
}

/**
 * Короткий алгоритмический ревер: шум с экспоненциальным затуханием как
 * импульсная характеристика. Именно хвост отличает «звук из приложения» от
 * «бипа осциллятора» — без него любой синтез звучит плоско и дёшево.
 */
function makeReverb(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            // Псевдослучайность БЕЗ Math.random: тот же ревер при каждом
            // запуске, иначе звук слегка отличался бы от раза к разу, а тест
            // уровня стал бы плавающим.
            const noise = Math.sin(i * (ch === 0 ? 12.9898 : 78.233)) * 43758.5453;
            data[i] = ((noise - Math.floor(noise)) * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
}

/**
 * Проигрывает встроенный пресет в переданном AudioContext.
 *
 * @param {AudioContext} ctx — уже созданный и возобновлённый контекст
 * @param {string} name — имя пресета; неизвестное имя даёт короткий бип
 */
function playBuiltInPreset(ctx, name) {
    if (!ctx) { return; }
            // МАСТЕР-ВЫХОД: громкость пресета → мягкий лимитер → колонки.
            // Все ветки ниже подключаются к `out`, а не к ctx.destination —
            // иначе подъём уровня пришлось бы вписывать в каждую из тридцати
            // трёх, то есть тридцать три раза не забыть.
            const out = ctx.createGain();
            out.gain.value = PRESET_GAIN[name] || 2.5;
            const limiter = ctx.createWaveShaper();
            limiter.curve = softClipCurve();
            const trim = ctx.createGain();
            trim.gain.value = 0.9;
            out.connect(limiter);
            limiter.connect(trim);
            trim.connect(ctx.destination);

            const g = ctx.createGain();
            g.connect(out);
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

            /**
             * Общие кирпичи новых звуков.
             *
             * У КАЖДОГО голоса свой gain-узел. В старых пресетах огибающие всех
             * нот писались на ОДИН общий `g`, и наложенные ноты перетирали
             * автоматизацию друг друга — отсюда часть «убогости»: аккорд звучал
             * как один невнятный тон со случайной громкостью.
             */
            const voice = (opts) => {
                const o = ctx.createOscillator();
                o.type = opts.type || 'sine';
                o.frequency.setValueAtTime(opts.freq, opts.at);
                if (opts.to) { o.frequency.exponentialRampToValueAtTime(opts.to, opts.at + (opts.sweep || opts.dur)); }
                if (opts.detune) { o.detune.value = opts.detune; }
                const env = ctx.createGain();
                env.gain.setValueAtTime(0.0001, opts.at);
                env.gain.exponentialRampToValueAtTime(opts.peak, opts.at + (opts.attack || 0.004));
                env.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.dur);
                o.connect(env);
                // Ширина: моно-сигнал в наушниках звучит «в голове», стерео —
                // вокруг. Панорама у партиалов разная, поэтому звук объёмный.
                if (opts.pan && ctx.createStereoPanner) {
                    const p = ctx.createStereoPanner();
                    p.pan.value = opts.pan;
                    env.connect(p);
                    p.connect(opts.dest || out);
                } else {
                    env.connect(opts.dest || out);
                }
                o.start(opts.at);
                o.stop(opts.at + opts.dur + 0.02);
                return env;
            };

            // Транзиент удара: короткий отфильтрованный шум. Именно он даёт
            // «удар молоточка» — без атаки любой синтезированный колокол
            // звучит как включённая гуделка.
            const transient = (at, dur, freq, peak, dest) => {
                const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < len; i++) {
                    const n = Math.sin(i * 12.9898) * 43758.5453;
                    data[i] = ((n - Math.floor(n)) * 2 - 1) * (1 - i / len);
                }
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const bp = ctx.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.value = freq;
                bp.Q.value = 0.8;
                const env = ctx.createGain();
                env.gain.setValueAtTime(peak, at);
                env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
                src.connect(bp); bp.connect(env); env.connect(dest || out);
                src.start(at);
                // Остановка ЯВНАЯ, хотя буфер и кончается сам: правило банка —
                // у каждого запущенного источника есть stop(), иначе узел живёт
                // до закрытия окна. Проверяется tests/sound-bank.test.js, и он
                // же поймал этот пропуск.
                src.stop(at + dur + 0.02);
                return env;
            };

            switch (name) {
                /* ===================================================
                   ЧЕТЫРЕ ЗВУКА СОБЫТИЙ (20.08.2026)
                   ---------------------------------------------------
                   Каждый написан под СВОЁ событие, а не выбран из общего
                   списка бипов, и у каждого своя задача:

                     старт      — короткий разгон, «поехали»;
                     окончание  — событие зала: должно быть слышно всем и
                                  прозвучать как финал, а не как ошибка;
                     минута     — метка, которая повторяется: заметная, но
                                  не раздражающая, поэтому короткая и тихая
                                  относительно финала;
                     перерасход — единственный ТРЕВОЖНЫЙ из четырёх: он
                                  обязан перебивать разговор в зале.
                   =================================================== */
                case 'start-boost': {
                    // Разгон: суб-удар + восходящая квинта + звонкая точка.
                    const rev = makeReverb(ctx, 0.7, 3);
                    const wet = ctx.createGain();
                    wet.gain.value = 0.18;
                    rev.connect(wet); wet.connect(out);

                    transient(now, 0.05, 2600, 0.5);
                    voice({ freq: 55, to: 110, at: now, dur: 0.22, peak: 0.55, type: 'sine', sweep: 0.12 });
                    voice({ freq: 330, to: 494, at: now + 0.01, dur: 0.28, peak: 0.28, type: 'sawtooth', detune: -7, pan: -0.35, sweep: 0.18 });
                    voice({ freq: 330, to: 494, at: now + 0.01, dur: 0.28, peak: 0.28, type: 'sawtooth', detune: 7, pan: 0.35, sweep: 0.18 });
                    voice({ freq: 660, to: 988, at: now + 0.02, dur: 0.26, peak: 0.16, type: 'triangle', sweep: 0.18 });
                    // Точка в конце разгона: короткий звонкий ping.
                    voice({ freq: 1318, at: now + 0.2, dur: 0.5, peak: 0.3, attack: 0.002, dest: out });
                    voice({ freq: 1318, at: now + 0.2, dur: 0.5, peak: 0.2, attack: 0.002, dest: rev });
                    break;
                }

                case 'finish-chime': {
                    // Финал: удар по колоколу с ИНГАРМОНИЧЕСКИМИ партиалами
                    // (у настоящего колокола обертоны не кратны основному —
                    // кратные дают «электронный» тон), поверх — мажорное трезвучие.
                    const rev = makeReverb(ctx, 2.2, 2.4);
                    const wet = ctx.createGain();
                    wet.gain.value = 0.3;
                    rev.connect(wet); wet.connect(out);

                    const root = 523.25;                       // C5
                    const partials = [
                        { m: 1, peak: 0.34, dur: 2.2, pan: 0 },
                        { m: 2.0, peak: 0.2, dur: 1.6, pan: -0.3 },
                        { m: 2.76, peak: 0.14, dur: 1.2, pan: 0.3 },
                        { m: 5.4, peak: 0.07, dur: 0.7, pan: -0.15 },
                        { m: 8.9, peak: 0.04, dur: 0.4, pan: 0.15 }
                    ];
                    for (const p of partials) {
                        voice({ freq: root * p.m, at: now, dur: p.dur, peak: p.peak, attack: 0.006, pan: p.pan });
                        voice({ freq: root * p.m, at: now, dur: p.dur, peak: p.peak * 0.6, attack: 0.006, dest: rev });
                    }
                    // Трезвучие расцветает чуть позже удара — так финал читается
                    // как завершение, а не как сигнал тревоги.
                    [523.25, 659.25, 783.99].forEach((f, i) => {
                        voice({ freq: f, at: now + 0.06 + i * 0.03, dur: 1.8, peak: 0.16, attack: 0.05, pan: (i - 1) * 0.3 });
                    });
                    // Тело: октава вниз, коротко — она даёт вес, а не гул.
                    voice({ freq: 130.81, at: now, dur: 0.9, peak: 0.3, attack: 0.01 });
                    transient(now, 0.03, 3200, 0.45);
                    break;
                }

                case 'minute-mark': {
                    // Метка минуты: одиночная звонкая точка. Звучит РЕЖЕ финала
                    // и короче его: этот звук повторяется, и всё, что длиннее
                    // трети секунды, за встречу становится назойливым.
                    const rev = makeReverb(ctx, 0.5, 3.5);
                    const wet = ctx.createGain();
                    wet.gain.value = 0.16;
                    rev.connect(wet); wet.connect(out);

                    transient(now, 0.012, 2800, 0.4);
                    voice({ freq: 1046.5, at: now, dur: 0.3, peak: 0.5, attack: 0.002, pan: -0.12 });
                    voice({ freq: 1046.5 * 2.4, at: now, dur: 0.16, peak: 0.14, attack: 0.002, pan: 0.12 });
                    voice({ freq: 523.25, at: now, dur: 0.34, peak: 0.22, attack: 0.003 });
                    voice({ freq: 1046.5, at: now, dur: 0.3, peak: 0.25, attack: 0.002, dest: rev });
                    break;
                }

                case 'overrun-alert': {
                    // Перерасход: двухтоновый сигнал «падающая кварта», дважды,
                    // с тремоло. Единственный тревожный звук набора — он обязан
                    // перебить разговор в зале, поэтому здесь и самый высокий
                    // уровень, и жёсткий тембр (пила через фильтр).
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.value = 2600;      // без него пила режет уши
                    lp.Q.value = 0.7;
                    lp.connect(out);

                    // Тремоло: амплитуда пульсирует 11 раз в секунду. Ровный тон
                    // мозг отфильтровывает как фон, пульсирующий — нет.
                    const trem = ctx.createGain();
                    trem.gain.value = 1;
                    const lfo = ctx.createOscillator();
                    lfo.frequency.value = 11;
                    const lfoGain = ctx.createGain();
                    lfoGain.gain.value = 0.28;
                    lfo.connect(lfoGain); lfoGain.connect(trem.gain);
                    trem.connect(lp);
                    lfo.start(now); lfo.stop(now + 1.1);

                    const pair = (at) => {
                        voice({ freq: 880, at, dur: 0.19, peak: 0.4, type: 'sawtooth', attack: 0.004, dest: trem, pan: -0.2 });
                        voice({ freq: 880, at, dur: 0.19, peak: 0.22, type: 'square', attack: 0.004, dest: trem, pan: 0.2 });
                        voice({ freq: 659.25, at: at + 0.21, dur: 0.24, peak: 0.4, type: 'sawtooth', attack: 0.004, dest: trem, pan: 0.2 });
                        voice({ freq: 659.25, at: at + 0.21, dur: 0.24, peak: 0.22, type: 'square', attack: 0.004, dest: trem, pan: -0.2 });
                        // Суб под сигналом — он даёт «телесность», из-за которой
                        // тревога слышна и на слабых колонках ноутбука.
                        voice({ freq: 110, at, dur: 0.45, peak: 0.35, type: 'sine', dest: out });
                    };
                    pair(now);
                    pair(now + 0.5);
                    break;
                }

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
                case 'bell': {
                    // Колокольчик
                    [1975, 2637, 3520].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        o.frequency.value = freq;
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(out);
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
                    gongGain.connect(out);
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
                        env.connect(out);
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
                        env.connect(out);
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
                        env.connect(out);
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
                        env.connect(out);
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
                        env.connect(out);
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
                        env.connect(out);
                        o.frequency.value = freq;
                        env.gain.setValueAtTime(0.0001, now);
                        env.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
                        env.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
                        o.start(now + i * 0.05);
                        o.stop(now + 1.3);
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
                        env.connect(out);
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
                case 'church-bell': {
                    // Церковный колокол — глубокий с обертонами
                    const fundamentals = [220, 440, 554, 660, 880];
                    fundamentals.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = 'sine';
                        const env = ctx.createGain();
                        o.connect(env);
                        env.connect(out);
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
                    env2.connect(out);
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
                    // Корабельный гудок. Прежняя версия — три пилы через
                    // lowpass 400 Гц с одинаковой огибающей: гул без начала и
                    // без дыхания. У настоящего гудка есть ВОЗДУХ (шум сквозь
                    // раструб) и БИЕНИЕ: два близких тона расходятся на доли
                    // герца, и звук «качается». Оба слоя здесь.
                    const rev = makeReverb(ctx, 1.6, 2.6);
                    const wet = ctx.createGain();
                    wet.gain.value = 0.22;
                    rev.connect(wet); wet.connect(out);

                    const horn = ctx.createBiquadFilter();
                    horn.type = 'lowpass';
                    horn.frequency.setValueAtTime(300, now);
                    horn.frequency.exponentialRampToValueAtTime(900, now + 0.25);
                    horn.Q.value = 0.9;
                    horn.connect(out);
                    horn.connect(rev);

                    // Биение: пары чуть расстроенных голосов на кварте и октаве.
                    const voices = [
                        { f: 55, peak: 0.4, detune: 0 },
                        { f: 110, peak: 0.34, detune: -4 },
                        { f: 110, peak: 0.34, detune: 5 },
                        { f: 146.8, peak: 0.16, detune: -3 },
                        { f: 220, peak: 0.1, detune: 4 }
                    ];
                    for (const v of voices) {
                        voice({
                            freq: v.f, at: now, dur: 1.9, peak: v.peak, type: 'sawtooth',
                            attack: 0.09, detune: v.detune, dest: horn
                        });
                    }
                    // Воздух: шум в полосе раструба, тише тона и с той же атакой.
                    transient(now, 1.6, 520, 0.1, horn);
                    break;
                }

                case 'deep-gong': {
                    // Большой гонг. Раньше это были три синуса с общей
                    // огибающей — то есть аккорд, а не гонг. У гонга обертоны
                    // ИНГАРМОНИЧНЫЕ и затухают с разной скоростью: низкие живут
                    // секунды, высокие гаснут первыми. Отсюда и «расцветание»
                    // звука, которого у аккорда нет.
                    const rev = makeReverb(ctx, 2.6, 2.2);
                    const wet = ctx.createGain();
                    wet.gain.value = 0.34;
                    rev.connect(wet); wet.connect(out);

                    const root = 87.31;                        // F2
                    const partials = [
                        { m: 1, peak: 0.42, dur: 3.2, pan: 0 },
                        { m: 1.52, peak: 0.24, dur: 2.6, pan: -0.25 },
                        { m: 2.34, peak: 0.17, dur: 2.1, pan: 0.25 },
                        { m: 3.16, peak: 0.12, dur: 1.5, pan: -0.4 },
                        { m: 4.51, peak: 0.08, dur: 1.0, pan: 0.4 },
                        { m: 5.93, peak: 0.05, dur: 0.7, pan: 0 }
                    ];
                    for (const p of partials) {
                        voice({ freq: root * p.m, at: now, dur: p.dur, peak: p.peak, attack: 0.012, pan: p.pan });
                        voice({ freq: root * p.m, at: now, dur: p.dur, peak: p.peak * 0.5, attack: 0.012, dest: rev });
                    }
                    // Удар колотушкой: без него гонг «включается», а не звучит.
                    transient(now, 0.12, 1400, 0.5);
                    transient(now, 0.03, 3600, 0.3);
                    break;
                }

                case 'cymbal': {
                    // Крэш. Шум через bandpass звучал как шипение: у тарелки
                    // металлический звон дают ИНГАРМОНИЧЕСКИЕ квадратные тоны
                    // (приём драм-машин), а шум — только воздух вокруг них.
                    // Плюс два этапа затухания: резкий удар и долгий «вош».
                    const hp = ctx.createBiquadFilter();
                    hp.type = 'highpass';
                    hp.frequency.value = 5200;
                    hp.connect(out);

                    const bp = ctx.createBiquadFilter();
                    bp.type = 'bandpass';
                    bp.frequency.value = 9000;
                    bp.Q.value = 0.6;
                    bp.connect(hp);

                    // Шесть квадратных голосов на несоизмеримых частотах.
                    const ratios = [1, 1.41, 1.78, 2.09, 2.51, 3.11];
                    ratios.forEach((r, i) => {
                        voice({
                            freq: 320 * r, at: now, dur: i < 3 ? 1.1 : 0.55,
                            peak: 0.22, type: 'square', attack: 0.001,
                            dest: bp, pan: (i % 2 ? 0.3 : -0.3)
                        });
                    });
                    // Воздух: короткий удар и длинный хвост.
                    transient(now, 0.09, 11000, 0.5, hp);
                    transient(now, 1.2, 7000, 0.18, hp);
                    break;
                }

                case 'siren': {
                    // Сирена. Была лесенка из ступенчатых частот — то есть
                    // серия бипов. У сирены частота едет НЕПРЕРЫВНО, и качает
                    // её отдельный генератор (LFO на частоте), а не ступени.
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.value = 3200;
                    lp.Q.value = 0.8;
                    lp.connect(out);

                    const body = ctx.createGain();
                    body.gain.setValueAtTime(0.0001, now);
                    body.gain.exponentialRampToValueAtTime(0.34, now + 0.08);
                    body.gain.setValueAtTime(0.34, now + 1.5);
                    body.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
                    body.connect(lp);

                    const wail = ctx.createOscillator();
                    wail.type = 'sawtooth';
                    wail.frequency.value = 620;
                    const sweep = ctx.createOscillator();
                    sweep.type = 'triangle';
                    sweep.frequency.value = 0.85;              // два подъёма за звук
                    const depth = ctx.createGain();
                    depth.gain.value = 330;                    // 620 ± 330 Гц
                    sweep.connect(depth);
                    depth.connect(wail.frequency);
                    wail.connect(body);
                    wail.start(now); wail.stop(now + 2);
                    sweep.start(now); sweep.stop(now + 2);

                    // Второй голос октавой ниже — сирена «телесная», а не писк.
                    const low = ctx.createOscillator();
                    low.type = 'sawtooth';
                    low.frequency.value = 310;
                    const lowDepth = ctx.createGain();
                    lowDepth.gain.value = 165;
                    sweep.connect(lowDepth);
                    lowDepth.connect(low.frequency);
                    const lowGain = ctx.createGain();
                    lowGain.gain.value = 0.5;
                    low.connect(lowGain); lowGain.connect(body);
                    low.start(now); low.stop(now + 2);
                    break;
                }

                case 'metal-strike': {
                    // Металлический удар
                    [800, 1200, 2400, 3600].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        o.type = i < 2 ? 'square' : 'sine';
                        const env4 = ctx.createGain();
                        o.connect(env4);
                        env4.connect(out);
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
                        env5.connect(out);
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
