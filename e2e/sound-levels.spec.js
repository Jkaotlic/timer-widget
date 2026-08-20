const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Каждый звук СЛЫШНО — замер, а не вера.
 *
 * Жалоба 20.08.2026: «звуки убогие и тихие». Это оказалось измеримым фактом:
 * рендер всех пресетов в OfflineAudioContext дал пики −22…−6.5 dBFS и RMS
 * −47…−23 dBFS при норме уведомления −3…−1 dBFS по пику. То есть банк звучал
 * на 10–20 дБ ниже нормы, и «сделай погромче» было не вкусовщиной.
 *
 * Почему проверка ЗДЕСЬ, а не в unit: Web Audio в Node нет вовсе, а
 * подставной AudioContext считает узлы, но не считает громкость — тихий звук
 * проходит его так же успешно, как громкий. OfflineAudioContext в настоящем
 * окне рендерит ТОТ ЖЕ код, который играет пользователю, и даёт числа.
 *
 * Порог двусторонний. Снизу — «слышно». Сверху — «не клиппует»: подъём уровня
 * без лимитера даёт треск на пике, и это хуже тихого звука.
 */

const PEAK_MIN = 0.35;   // −9.1 dBFS: тише этого звук теряется в зале
const PEAK_MAX = 0.99;   // ниже единицы: клиппинг = треск
const RMS_MIN = 0.02;    // −34 dBFS: защита от «пик есть, а звука нет»

test('каждый встроенный звук звучит в рабочем диапазоне громкости', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        const names = await control.evaluate(() => window.SoundBank.BUILT_IN_PRESETS);
        expect(names.length).toBeGreaterThan(25);

        const measured = await control.evaluate(async (presets) => {
            const out = [];
            for (const name of presets) {
                const SR = 44100;
                const ctx = new OfflineAudioContext(2, SR * 6, SR);
                window.SoundBank.playBuiltInPreset(ctx, name);
                const buf = await ctx.startRendering();
                const L = buf.getChannelData(0), R = buf.getChannelData(1);
                let peak = 0, last = 0;
                for (let i = 0; i < L.length; i++) {
                    const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
                    if (v > peak) { peak = v; }
                    if (v > 0.001) { last = i; }
                }
                // RMS по ЗВУЧАЩЕЙ части: тишина в хвосте буфера занижает число
                // тем сильнее, чем длиннее буфер, и порог стал бы бессмысленным.
                let sum = 0;
                for (let i = 0; i <= last; i++) { sum += (L[i] * L[i] + R[i] * R[i]) / 2; }
                out.push({ name, peak, rms: Math.sqrt(sum / Math.max(1, last + 1)), tail: last / SR });
            }
            return out;
        }, names);

        const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
        for (const m of measured) {
            console.log(`   ${m.name.padEnd(16)} пик ${db(m.peak).padStart(6)} dBFS  RMS ${db(m.rms).padStart(6)} dBFS  ${m.tail.toFixed(2)}s`);
        }

        for (const m of measured) {
            expect(m.peak, `${m.name}: пик ${db(m.peak)} dBFS — звук слишком тихий`).toBeGreaterThanOrEqual(PEAK_MIN);
            expect(m.peak, `${m.name}: пик ${db(m.peak)} dBFS — клиппинг`).toBeLessThanOrEqual(PEAK_MAX);
            expect(m.rms, `${m.name}: RMS ${db(m.rms)} dBFS — пик есть, а звука нет`).toBeGreaterThanOrEqual(RMS_MIN);
            expect(m.tail, `${m.name}: длится ${m.tail.toFixed(2)}s — звук события не должен быть таким длинным`).toBeLessThan(4);
        }

        // Проверка САМА СЕБЯ: тишина обязана этот порог провалить, иначе
        // зелёный означает и «звук есть», и «замер ничего не мерит».
        const silence = await control.evaluate(async () => {
            const ctx = new OfflineAudioContext(2, 44100, 44100);
            const buf = await ctx.startRendering();
            const L = buf.getChannelData(0);
            let peak = 0;
            for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i])); }
            return peak;
        });
        expect(silence, 'замер не отличает тишину от звука').toBeLessThan(PEAK_MIN);
    } finally {
        await app.close();
    }
});

/**
 * Четыре звука событий отличаются друг от друга ХАРАКТЕРОМ, а не только именем.
 *
 * Иначе «написал под событие» — это подпись в реестре, а не свойство звука:
 * метка минуты обязана быть короткой (она повторяется), финал — длинным
 * (это событие зала), тревога — самой громкой по энергии.
 */
test('звуки событий различаются по длине и энергии так, как обещано', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        const m = await control.evaluate(async () => {
            const out = {};
            for (const name of ['start-boost', 'finish-chime', 'minute-mark', 'overrun-alert']) {
                const SR = 44100;
                const ctx = new OfflineAudioContext(2, SR * 6, SR);
                window.SoundBank.playBuiltInPreset(ctx, name);
                const buf = await ctx.startRendering();
                const L = buf.getChannelData(0), R = buf.getChannelData(1);
                let peak = 0, last = 0, sum = 0;
                for (let i = 0; i < L.length; i++) {
                    const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
                    if (v > peak) { peak = v; }
                    if (v > 0.001) { last = i; }
                }
                for (let i = 0; i <= last; i++) { sum += (L[i] * L[i] + R[i] * R[i]) / 2; }
                out[name] = { peak, rms: Math.sqrt(sum / Math.max(1, last + 1)), tail: last / SR };
            }
            return out;
        });
        console.log(`   ${JSON.stringify(m, (k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v))}`);

        expect(m['minute-mark'].tail, 'метка минуты повторяется — она обязана быть короткой').toBeLessThan(0.5);
        expect(m['finish-chime'].tail, 'финал обязан звучать как событие, а не как щелчок').toBeGreaterThan(1.2);
        expect(m['start-boost'].tail, 'старт — короткий разгон, а не мелодия').toBeLessThan(1.2);
        expect(m['overrun-alert'].rms, 'тревога обязана быть самой плотной из четырёх')
            .toBeGreaterThan(m['minute-mark'].rms);
    } finally {
        await app.close();
    }
});
