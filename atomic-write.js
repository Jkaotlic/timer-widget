'use strict';

/**
 * atomic-write.js — атомарная запись файла состояния (BUG-09).
 *
 * `fs.writeFileSync` поверх старого файла сначала обрезает его до нуля и лишь
 * потом пишет. Падение процесса, выключение питания или полный диск в этом
 * промежутке оставляли пустой или обрезанный JSON, а читатели (накопитель
 * перелимита, снимок восстановления) честно принимали битый файл за «ничего
 * нет» — итог мероприятия, то есть деньги, молча становился нулём.
 *
 * Здесь: временный файл В ТОМ ЖЕ каталоге (rename атомарен только в пределах
 * одной файловой системы) → запись → fsync (данные на диске ДО того, как имя
 * на них укажет) → rename поверх старого. Любой сбой до rename оставляет
 * старый файл нетронутым; временный убирается.
 *
 * fsync каталога не делается: на Windows каталог так не открыть, а без него
 * худший исход после сбоя питания — старая версия файла, не битая.
 *
 * Модуль без Electron — проверяется в голом `node --test`.
 */

const fs = require('fs');

function writeFileAtomicSync(filePath, data) {
    // pid в имени: два экземпляра приложения (мимо single-instance-lock —
    // e2e, съёмка) не пишут в один временный файл.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    let fd = null;
    try {
        fd = fs.openSync(tmpPath, 'w');
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* уже неважно */ }
        }
        try { fs.unlinkSync(tmpPath); } catch { /* его могло и не быть */ }
        throw err;
    }
}

module.exports = { writeFileAtomicSync };
