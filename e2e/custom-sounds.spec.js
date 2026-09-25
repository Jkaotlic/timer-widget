'use strict';

/**
 * Пользовательские звуки по настоящему пути: <input type=file> → проверка
 * формата → хранилище → список (BUG-21).
 *
 * Имя звука — имя файла без расширения, поэтому «гонг.mp3» заменяет уже
 * добавленный «гонг.wav». Замена законна (по имени события хранят выбор), но
 * молчать о ней нельзя: человек думает, что добавил второй звук.
 *
 * Испорченное хранилище (не-массив) прежде роняло панель при отрисовке
 * списка — здесь проверяется, что после такой записи загрузка работает.
 *
 * Профиль e2e общий: `customSounds` возвращается в `finally`.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

// Минимальные файлы с правильной сигнатурой: RIFF…WAVE и ID3.
const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1');
const MP3 = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1');

test('одноимённый файл заменяет звук — и это сказано; испорченное хранилище не роняет список', async () => {
    const { app, control } = await launchApp();
    let saved = null;
    try {
        saved = await control.evaluate(() => localStorage.getItem('customSounds'));
        // Испорченное хранилище: объект вместо массива.
        await control.evaluate(() => {
            localStorage.setItem('customSounds', '{"name":"x","data":"y"}');
            window.timerController.loadCustomSounds();
        });
        await expect(control.locator('#customSoundList .sound-empty')).toHaveCount(1);

        await control.setInputFiles('#soundFileInput', { name: 'гонг.wav', mimeType: 'audio/wav', buffer: WAV });
        await expect(control.locator('#customSoundList .custom-sound-item')).toHaveCount(1);

        await control.setInputFiles('#soundFileInput', { name: 'гонг.mp3', mimeType: 'audio/mpeg', buffer: MP3 });
        await expect(control.locator('.toast', { hasText: 'заменён' })).toHaveCount(1);
        await expect(control.locator('#customSoundList .custom-sound-item')).toHaveCount(1);
        const data = await control.evaluate(() => JSON.parse(localStorage.getItem('customSounds'))[0].data.slice(0, 16));
        expect(data).toBe('data:audio/mpeg;');
    } finally {
        if (control && !control.isClosed()) {
            await control.evaluate((v) => {
                if (v === null) { localStorage.removeItem('customSounds'); } else { localStorage.setItem('customSounds', v); }
            }, saved).catch(() => {});
        }
        await app.close();
    }
});
