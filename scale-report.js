'use strict';

/**
 * scale-report.js — приём отчёта о масштабе: окно → панель.
 *
 * Поток масштаба двусторонний. Панель диктует его ползунком, но Ctrl+колесо на
 * самом виджете, часах и дисплее меняет масштаб на месте, и окно обязано
 * сказать об этом обратно — иначе ползунок показывает одно, окно другое, а
 * следующая посылка настроек возвращает масштаб назад.
 *
 * Вынесено из inline-скрипта панели по правилу проекта: блок самодостаточен
 * (карта источников, поджатие по границам ползунка, одна запись в профиль) и
 * проверяется в Node на поддельных документе и хранилище, чего про его прежнюю
 * форму сказать было нельзя.
 *
 * ЧТО ЗАПИСЫВАЕТСЯ. Только сообщённая величина, и только теми ключами, которые
 * ей принадлежат. Раньше здесь звали `saveExtSettings()` — сборку ВСЕГО набора
 * настроек из контролов панели. Отчёт о размере окна записывал таким образом
 * профиль целиком, включая поля, которых отчёт не касался: открытие окна
 * виджета затирало настройки, положенные в профиль мимо панели (поймано
 * 01.09.2026 падением e2e/digits-style.spec.js).
 *
 * У ЧАСОВ КЛЮЧА НЕТ, и это не пропуск: их масштаб живёт в `clockGeometry`,
 * которую пишет само окно часов. Пустой список означает «ползунок подтянуть,
 * в профиль не писать».
 */

const SCALE_TARGETS = {
    widget: { slider: 'timerScale', label: 'timerScaleValue', keys: ['widgetTimerScale', 'timerScale'] },
    clock: { slider: 'clockScale', label: 'clockScaleValue', keys: [] },
    display: { slider: 'displayTimerScale', label: 'displayTimerScaleValue', keys: ['displayTimerScale'] },
    'display-blocks': { slider: 'timeBlocksScale', label: 'timeBlocksScaleValue', keys: ['timeBlocksScale'] }
};

// Запасные границы — на случай ползунка без атрибутов. Совпадают с самым
// широким из диапазонов; настоящие границы всегда берутся у ползунка.
const FALLBACK_MIN = 30;
const FALLBACK_MAX = 600;

const PROFILE_KEY = 'displayExtSettings';

/**
 * Применяет отчёт `scale-report` к панели.
 *
 * @param {{source: string, scalePct: number}} data — payload канала
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {Storage} deps.storage
 * @param {(v:number,min:number,max:number)=>number} deps.clamp
 * @param {(raw:string, fallback:unknown)=>unknown} deps.parseJSON
 * @returns {number|null} применённое значение либо null, если отчёт отвергнут
 */
function applyScaleReport(data, deps) {
    if (!data || typeof data !== 'object') { return null; }
    const pct = Number(data.scalePct);
    if (!Number.isFinite(pct)) { return null; }

    const target = SCALE_TARGETS[data.source];
    if (!target) { return null; }

    const { doc, storage, clamp, parseJSON } = deps;
    const slider = doc.getElementById(target.slider);
    if (!slider) { return null; }

    // Границы берутся у САМОГО ползунка — он их единственный владелец
    // (см. scale-input.js, там же и ввод значения руками).
    const min = Number(slider.min);
    const max = Number(slider.max);
    const clamped = clamp(
        pct,
        Number.isFinite(min) ? min : FALLBACK_MIN,
        Number.isFinite(max) ? max : FALLBACK_MAX
    );

    // Присваивание .value НЕ порождает события 'input', поэтому обратной
    // отправки в окно не происходит и петля не замыкается.
    slider.value = clamped;
    const label = doc.getElementById(target.label);
    if (label) { label.textContent = clamped + '%'; }

    if (target.keys.length && storage) {
        try {
            const prev = parseJSON(storage.getItem(PROFILE_KEY), {}) || {};
            for (const key of target.keys) { prev[key] = clamped; }
            storage.setItem(PROFILE_KEY, JSON.stringify(prev));
        } catch { /* профиль переполнен — ползунок всё равно подтянут */ }
    }

    return clamped;
}

const ScaleReport = { SCALE_TARGETS, PROFILE_KEY, applyScaleReport };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScaleReport;
}

if (typeof window !== 'undefined') {
    window.ScaleReport = ScaleReport;
}
