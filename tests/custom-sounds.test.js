'use strict';

/**
 * BUG-21: пользовательские звуки на недоверенном хранилище и файле.
 *
 * `customSounds` в localStorage — чужие данные: профиль мог испортиться,
 * старая версия могла записать другую форму. Прежде не-массив ронял панель на
 * `.some` / `.find`, битый файл — на `arrayBuffer()` вне try, а `new Audio()`
 * получал из хранилища любую строку, не только звук. Ещё одна тихая потеря:
 * «a.mp3» молча заменял уже добавленный «a.wav» — имя звука без расширения.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeJSONParse } = require('../security.js');
const {
    CustomSoundsMixin, sanitizeCustomSounds, isPlayableSoundData, mergeCustomSound
} = require('../custom-sounds.js');

test('BUG-21: не-массив в хранилище — пустой список, а не исключение', () => {
    for (const raw of [null, undefined, 42, 'строка', { name: 'a', data: 'x' }, true]) {
        assert.deepEqual(sanitizeCustomSounds(raw), [], JSON.stringify(raw));
    }
});

test('BUG-21: записи без имени или данных отбрасываются', () => {
    const good = { name: 'гонг', data: 'data:audio/wav;base64,UklGRg==' };
    const out = sanitizeCustomSounds([good, null, 5, { name: 3, data: 'x' }, { name: 'б' }, { data: 'x' }]);
    assert.deepEqual(out, [good]);
});

test('BUG-21: играть можно только data:audio/', () => {
    assert.equal(isPlayableSoundData('data:audio/mpeg;base64,SUQz'), true);
    assert.equal(isPlayableSoundData('data:audio/wav;base64,UklGRg=='), true);
    for (const bad of ['data:text/html,<script>1</script>', 'file:///etc/passwd', 'https://example.com/a.mp3',
        'javascript:alert(1)', '', null, 42, 'DATA:AUDIO/x']) {
        assert.equal(isPlayableSoundData(bad), false, JSON.stringify(bad));
    }
});

test('BUG-21: файл с тем же базовым именем заменяет звук — и об этом сказано', () => {
    const list = [{ name: 'a', data: 'data:audio/wav;base64,AAA' }];
    const r = mergeCustomSound(list, 'a', 'data:audio/mpeg;base64,BBB');
    assert.equal(r.replaced, true, 'замена обязана быть видна вызывающему (тост)');
    assert.deepEqual(r.updated, [{ name: 'a', data: 'data:audio/mpeg;base64,BBB' }]);
    assert.equal(list[0].data, 'data:audio/wav;base64,AAA', 'исходный список не мутируется');

    const added = mergeCustomSound(list, 'b', 'data:audio/ogg;base64,CCC');
    assert.equal(added.replaced, false);
    assert.equal(added.updated.length, 2);
});

// --- поведение примеси на поддельных window / localStorage -------------------

function withFakeEnv(stored, fn) {
    const saved = { window: global.window, localStorage: global.localStorage, Audio: global.Audio };
    const audios = [];
    const toasts = [];
    global.window = {
        safeJSONParse,
        Toast: { show: (msg, kind) => toasts.push({ msg, kind }) }
    };
    global.localStorage = { getItem: () => stored };
    global.Audio = function FakeAudio(src) {
        audios.push(src);
        this.play = () => Promise.resolve();
    };
    return Promise.resolve(fn({ audios, toasts })).finally(() => {
        global.window = saved.window;
        global.localStorage = saved.localStorage;
        global.Audio = saved.Audio;
    });
}

function controller() {
    const beeps = [];
    const errors = [];
    const c = Object.assign({
        beep: async () => { beeps.push(1); },
        showSoundUploadError: (title) => { if (title) { errors.push(title); } }
    }, CustomSoundsMixin);
    // Примесь зовёт свои методы через this — как у настоящего контроллера.
    c.showSoundUploadError = (title) => { if (title) { errors.push(title); } };
    return { c, beeps, errors };
}

test('BUG-21: playCustomSound на испорченном хранилище не падает — стандартный сигнал', async () => {
    await withFakeEnv('{"name":"a"}', async ({ audios }) => {
        const { c, beeps } = controller();
        await c.playCustomSound('a');
        assert.equal(beeps.length, 1);
        assert.deepEqual(audios, []);
    });
});

test('BUG-21: данные не-звук в Audio не попадают', async () => {
    const stored = JSON.stringify([{ name: 'a', data: 'data:text/html,<h1>x</h1>' }]);
    await withFakeEnv(stored, async ({ audios }) => {
        const { c, beeps } = controller();
        await c.playCustomSound('a');
        assert.deepEqual(audios, [], 'не-звук передан в new Audio()');
        assert.equal(beeps.length, 1);
    });
});

test('BUG-21: настоящий звук играет', async () => {
    const stored = JSON.stringify([{ name: 'a', data: 'data:audio/wav;base64,UklGRg==' }]);
    await withFakeEnv(stored, async ({ audios }) => {
        const { c, beeps } = controller();
        await c.playCustomSound('a');
        assert.deepEqual(audios, ['data:audio/wav;base64,UklGRg==']);
        assert.equal(beeps.length, 0);
    });
});

test('BUG-21: файл, который не читается, — сообщение, а не необработанный отказ', async () => {
    await withFakeEnv('[]', async ({ toasts }) => {
        const { c, errors } = controller();
        global.window.CONFIG = { MAX_SOUND_FILE_SIZE: 1024 * 1024, ALLOWED_AUDIO_TYPES: ['audio/wav'] };
        const file = {
            name: 'a.wav', size: 10, type: 'audio/wav',
            slice: () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) })
        };
        const target = { files: [file], value: 'a.wav' };
        await c.handleSoundFileUpload({ target });
        assert.equal(errors.length, 1, 'пользователю не сказали, что файл не прочитан');
        assert.ok(toasts.some((t) => t.kind === 'error'));
        assert.equal(target.value, '', 'поле выбора файла не сброшено');
    });
});
