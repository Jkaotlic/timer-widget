'use strict';

/**
 * R2 (docs/superpowers/specs/2026-09-28-psi-hardening.md, добивка перед
 * повторной сдачей ПСИ): проверка орфографии выключена у всех четырёх окон.
 * Chromium иначе тянет словарь Hunspell по сети — приложение полностью
 * офлайновое, и любой исходящий трафик здесь — находка аудита, а не фича.
 *
 * Source-level тест, а не behavioral: он считает СЧЁТ, а не наличие —
 * `spellcheck: false`, забытый у одного окна из четырёх, не поймала бы
 * проверка «хотя бы один есть». `codeOnly()` снимает комментарии, чтобы
 * упоминание `spellcheck: false` в тексте комментария не завышало счёт.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const read = (file) => codeOnly(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

test('R2: у каждого webPreferences окна — ровно один spellcheck: false', () => {
    const src = read('main-windows.js');
    const webPrefsCount = (src.match(/webPreferences:\s*\{/g) || []).length;
    const spellcheckFalseCount = (src.match(/spellcheck:\s*false\b/g) || []).length;
    assert.equal(webPrefsCount, 4, 'main-windows.js создаёт не 4 окна — тест считает не то число');
    assert.equal(
        spellcheckFalseCount, webPrefsCount,
        `у каждого webPreferences обязан быть spellcheck: false (webPreferences: ${webPrefsCount}, spellcheck:false: ${spellcheckFalseCount})`
    );
});
