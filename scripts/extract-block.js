#!/usr/bin/env node
'use strict';

/**
 * Служебный помощник декомпозиции: вырезает диапазон строк из файла и
 * возвращает его, вставив на место замену.
 *
 * Существует потому, что раскладывать god-файл на модули руками через
 * копипасту — верный способ потерять строку или отступ. Здесь вырезание и
 * вставка атомарны, а границы блока задаются по точным строкам-якорям, а не
 * по номерам: номера уезжают после каждой предыдущей правки.
 *
 * Использование (из Node, не из CLI):
 *   const { cutBlock } = require('./scripts/extract-block');
 *   const body = cutBlock('electron-control.html', {
 *       startsWith: '        const Toast = {',
 *       endsWith:   '        };',
 *       replaceWith: ''
 *   });
 */

const fs = require('node:fs');

/**
 * @param {string} file
 * @param {{startsWith:string, endsWith:string, replaceWith?:string, from?:number}} opts
 * @returns {{body:string, startLine:number, endLine:number}}
 */
function cutBlock(file, opts) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const from = opts.from || 0;

    const start = lines.findIndex((l, i) => i >= from && l === opts.startsWith);
    if (start === -1) {
        throw new Error(`Не найдено начало блока: ${JSON.stringify(opts.startsWith)}`);
    }
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i] === opts.endsWith) { end = i; break; }
    }
    if (end === -1) {
        throw new Error(`Не найден конец блока: ${JSON.stringify(opts.endsWith)}`);
    }

    const body = lines.slice(start, end + 1).join('\n');
    const replacement = opts.replaceWith === undefined ? [] : String(opts.replaceWith).split('\n');
    lines.splice(start, end - start + 1, ...replacement);
    fs.writeFileSync(file, lines.join('\n'));

    return { body, startLine: start + 1, endLine: end + 1 };
}

/** Снимает общий отступ в n пробелов у каждой строки. */
function dedent(text, n) {
    const pad = ' '.repeat(n);
    return text
        .split('\n')
        .map((l) => (l.startsWith(pad) ? l.slice(n) : l))
        .join('\n');
}

module.exports = { cutBlock, dedent };
