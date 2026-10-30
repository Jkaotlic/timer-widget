'use strict';

/**
 * PANEL-008 (аудит 27.10.2026): контролы локального фона расходились с тем,
 * что уходит дисплею.
 *  (а) Ползунок затемнения на 70 %, фон удалён: deleteLocalBackground стирал
 *      localBgSettings, а ползунок и кнопки вписывания не трогал. После новой
 *      загрузки дисплей получал умолчания (cover, 30 %), панель показывала 70 %.
 *  (б) Пресет менял localBgSettings, но loadLocalBackground звался только при
 *      старте: дисплей получал значения пресета, панель — старые, и первое же
 *      касание ползунка затирало пресет.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const RendererShared = require('../renderer-shared.js');

function classList() {
    const set = new Set();
    return {
        add: (c) => set.add(c), remove: (c) => set.delete(c),
        toggle: (c, on) => { if (on) { set.add(c); } else { set.delete(c); } },
        contains: (c) => set.has(c)
    };
}

function harness(storage) {
    const fits = ['cover', 'contain', 'tile'].map((fit) => ({ dataset: { fit }, classList: classList() }));
    fits[0].classList.add('active');
    const els = {
        bgOverlaySlider: { value: '30' },
        bgOverlayValue: { textContent: '30%' }
    };
    for (const id of ['localBgPreview', 'localBgPlaceholder', 'localBgImage', 'bgFitOptions', 'bgOverlayRow']) {
        els[id] = { style: {}, classList: classList(), src: '' };
    }
    const doc = {
        getElementById: (id) => els[id] || null,
        querySelectorAll: (sel) => (sel === '.bg-fit-btn' ? fits : []),
        querySelector: (sel) => (sel === '.bg-fit-btn.active' ? fits.find((b) => b.classList.contains('active')) || null : null)
    };
    const store = {
        getItem: (k) => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; }
    };
    return { doc, store, fits, els };
}

function withGlobals(h, fn) {
    const prev = { window: global.window, document: global.document, localStorage: global.localStorage };
    global.window = {
        RendererShared,
        SecurityUtils: {
            safeJSONParse: (raw, fb) => { try { return raw ? JSON.parse(raw) : fb; } catch { return fb; } }
        }
    };
    global.document = h.doc;
    global.localStorage = h.store;
    try {
        delete require.cache[require.resolve('../local-background.js')];
        const { LocalBackgroundMixin } = require('../local-background.js');
        return fn(LocalBackgroundMixin);
    } finally { Object.assign(global, prev); }
}

const activeFit = (fits) => fits.filter((b) => b.classList.contains('active')).map((b) => b.dataset.fit);

test('PANEL-008(а): удаление фона возвращает затемнение и вписывание к умолчанию', () => {
    const storage = { localBgImage: 'data:image/png;base64,AAAA', localBgSettings: JSON.stringify({ fit: 'tile', overlay: 70 }) };
    const h = harness(storage);
    withGlobals(h, (Mixin) => {
        const panel = Object.assign({ currentBgMode: 'theme', pushDisplaySettings: () => {} }, Mixin);
        panel.loadLocalBackground();
        assert.equal(h.els.bgOverlaySlider.value, 70);
        panel.deleteLocalBackground();
        assert.equal(Number(h.els.bgOverlaySlider.value), RendererShared.bgOverlayPercent(undefined),
            'ползунок затемнения остался на прежнем значении после удаления фона');
        assert.equal(h.els.bgOverlayValue.textContent, RendererShared.bgOverlayPercent(undefined) + '%');
        assert.deepEqual(activeFit(h.fits), ['cover'], 'кнопка вписывания осталась прежней');
    });
});

test('PANEL-008(б): раскладка фона читает fit и overlay и без картинки', () => {
    // Профиль (например, после пресета) без картинки, но с настройками.
    const storage = { localBgSettings: JSON.stringify({ fit: 'contain', overlay: 0 }) };
    const h = harness(storage);
    withGlobals(h, (Mixin) => {
        const panel = Object.assign({ pushDisplaySettings: () => {} }, Mixin);
        panel.loadLocalBackground();
        assert.deepEqual(activeFit(h.fits), ['contain'], 'вписывание из профиля не применено');
        assert.equal(Number(h.els.bgOverlaySlider.value), 0, 'законный ноль затемнения потерян');
    });
});

test('PANEL-008(б): пресет перечитывает локальный фон', () => {
    const PanelPresets = require('../panel-presets.js');
    const calls = [];
    PanelPresets.applyProfile({
        loadSettings: () => calls.push('loadSettings'),
        loadLocalBackground: () => calls.push('loadLocalBackground'),
        pushDisplaySettings: () => calls.push('pushDisplaySettings')
    }, null);
    assert.ok(calls.includes('loadLocalBackground'), 'пресет не перечитывает контролы локального фона');
    assert.ok(calls.indexOf('loadLocalBackground') < calls.indexOf('pushDisplaySettings'));
});
