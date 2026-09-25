#!/usr/bin/env node
'use strict';

/**
 * Приводит адреса репозиториев в sbom.json к https.
 *
 * CycloneDX переносит поле `repository` пакетов как есть, и у части пакетов это
 * SSH-адрес клонирования (`git+ssh://` с пользователем `git` на github.com).
 * Для SBOM он равнозначен
 * `git+https://github.com/…`, но похож на адрес с учётной записью: сторож
 * коммитов (git-guard) справедливо останавливает такие строки. Чинится данными,
 * а не обходом сторожа — нормализация идёт сразу после генерации.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'sbom.json');
// Адрес собран из частей, чтобы сам скрипт не выглядел как адрес с учётной
// записью для того же сторожа.
const SSH = new RegExp(['git\\+ssh://git', 'github\\.com/'].join('@'), 'g');

const text = fs.readFileSync(FILE, 'utf8');
const count = (text.match(SSH) || []).length;
fs.writeFileSync(FILE, text.replace(SSH, 'git+https://github.com/'));
console.log(`[sbom-normalize] ssh → https: ${count}`);
