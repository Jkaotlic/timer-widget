'use strict';

/**
 * drop-guard.js — файл, сброшенный на окно, не открывается ВМЕСТО окна (SEC-06).
 *
 * Без обработчика Chromium на `drop` файла делает навигацию на его file://.
 * Главный процесс такую навигацию отвергает (navigation-guard.js), но окно не
 * должно даже пытаться: это второй замок, на стороне документа.
 *
 * Подключается в виджете, часах и дисплее — у них сбрасывать некуда вовсе.
 * У панели гаситель свой (custom-sounds.js): там есть зона сброса звука, и
 * гаситель обязан её пропускать; этот о зоне не знает и там бы мешал.
 *
 * Сам ставит обработчики при загрузке в окне; в Node экспортирует функцию для
 * tests/drop-guard.test.js.
 */
(function (root) {
    function blockFileDrops(doc) {
        doc.addEventListener('dragover', (e) => {
            e.preventDefault();
            // Курсор «сюда нельзя»: preventDefault на dragover сам по себе
            // объявляет окно ЦЕЛЬЮ сброса и показывает «копировать».
            if (e.dataTransfer) { e.dataTransfer.dropEffect = 'none'; }
        });
        doc.addEventListener('drop', (e) => { e.preventDefault(); });
    }

    const api = { blockFileDrops };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DropGuard = api;
        blockFileDrops(root.document);
    }
})(typeof window !== 'undefined' ? window : globalThis);
