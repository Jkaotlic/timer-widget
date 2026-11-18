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
        // Залежавшийся `.tmp` того же pid (например, от прошлого краха этого
        // же процесса до rename) не должен ронять запись на EEXIST — `wx`
        // бросает именно на существующем файле. Убираем его заранее, а не
        // ловим EEXIST в catch: там уже нет пути «попробовать снова».
        try { fs.unlinkSync(tmpPath); } catch { /* его могло и не быть */ }
        // 0o600: файл состояния может нести итог перелимита (деньги) —
        // читать и писать его должен только владелец процесса.
        fd = fs.openSync(tmpPath, 'wx', 0o600);
        fs.writeFileSync(fd, Buffer.from(data));
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

// Profile files are small. Reject oversized or non-regular files before reading.
function readProfileJson(filePath, maxBytes) {
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > maxBytes) {
            throw Object.assign(new Error('Invalid profile file size'), { code: 'EFBIG' });
        }
        // Read from the inspected descriptor and cap the allocation even if a
        // different process changes the file between fstat and the read.
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
            const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
            if (!count) { break; }
            offset += count;
        }
        return JSON.parse(bytes.toString('utf8', 0, offset));
    } finally {
        fs.closeSync(fd);
    }
}

function removeProfileFile(filePath) {
    try { fs.unlinkSync(filePath); } catch (err) {
        if (err.code !== 'ENOENT') { throw err; }
    }
}

function errorCode(err) {
    return (err && (err.code || err.name)) || 'ошибка';
}

module.exports = { writeFileAtomicSync, readProfileJson, removeProfileFile, errorCode };
