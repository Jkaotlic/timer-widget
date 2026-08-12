'use strict';

/**
 * custom-sounds.js — пользовательские звуки: загрузка файла с проверкой,
 * список в интерфейсе, воспроизведение и удаление.
 *
 * Отделено от sound-bank.js намеренно: там чистый синтез через осцилляторы, а
 * здесь работа с файлами, localStorage и DOM — разные причины для изменения.
 *
 * Форма поставки — ПРИМЕСЬ К ПРОТОТИПУ, а не набор свободных функций. Причина
 * прагматичная: методы вызывают друг друга и падают на общий this.beep() при
 * сбое воспроизведения, а обработчики в списке замыкаются на this. Примесь
 * сохраняет семантику this один в один, поэтому перенос кода получается
 * дословным и не меняет поведение — что важно, когда рядом нет типов.
 *
 * Зависимости берутся из window (Toast, RendererStorage, CONFIG, safeJSONParse) —
 * так же, как во всех остальных модулях рендерера: сборщика в проекте нет.
 */

const CustomSoundsMixin = {
    // Показать/скрыть kit-style error banner для загрузки звука.
    showSoundUploadError(title, msg) {
            const el = document.getElementById('soundUploadError');
            const t = document.getElementById('soundErrorTitle');
            const m = document.getElementById('soundErrorMsg');
            if (!el) { return; }
            if (!title) { el.classList.remove('visible'); return; }
            if (t) { t.textContent = title; }
            if (m) { m.textContent = msg || ''; }
            el.classList.add('visible');
    },

    /**
     * Перетаскивание файла на зону загрузки.
     *
     * Надпись «Перетащите файл сюда» стояла в разметке с самого начала, а
     * обработчика не было: интерфейс обещал то, чего не делал. Проверка формата
     * и размера НЕ дублируется — событие приводится к той же форме, что даёт
     * <input type="file">, и уходит в тот же handleSoundFileUpload. Вторая копия
     * валидации разошлась бы с первой на первом же изменении лимита.
     */
    bindSoundDropZone() {
        const zone = document.getElementById('addSoundBtn');
        if (!zone) { return; }

        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

        // dragover обязателен и обязан гасить событие: без него браузер
        // отказывается быть целью сброса, и drop не приходит вообще.
        zone.addEventListener('dragover', (e) => { stop(e); zone.classList.add('drag-over'); });
        zone.addEventListener('dragenter', (e) => { stop(e); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', (e) => { stop(e); zone.classList.remove('drag-over'); });
        zone.addEventListener('drop', (e) => {
            stop(e);
            zone.classList.remove('drag-over');
            const file = e.dataTransfer?.files?.[0];
            if (!file) { return; }
            this.handleSoundFileUpload({ target: { files: [file] } });
        });

        // Сброс МИМО зоны не должен открывать файл вместо окна: иначе
        // промахнувшийся пользователь теряет приложение и получает плеер.
        for (const type of ['dragover', 'drop']) {
            document.addEventListener(type, (e) => {
                if (!zone.contains(e.target)) { e.preventDefault(); }
            });
        }
    },

    // Пользовательские звуки
    async handleSoundFileUpload(event) {
            const file = event.target.files[0];
            if (!file) {return;}

            this.showSoundUploadError(null);

            // Форматируем размер для сообщения об ошибке.
            const sizeKB = (n) => n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' КБ' : (n / 1024 / 1024).toFixed(1) + ' МБ';

            // FIX BUG-025: Validation for sound file uploads
            const MAX_SOUND_SIZE = (window.CONFIG && window.CONFIG.MAX_SOUND_FILE_SIZE) || 5 * 1024 * 1024;
            if (file.size > MAX_SOUND_SIZE) {
                window.Toast.show('Файл слишком большой (максимум 5 MB)', 'error');
                this.showSoundUploadError(
                    'Файл слишком большой',
                    `${file.name} (${sizeKB(file.size)}) превышает лимит ${sizeKB(MAX_SOUND_SIZE)}`
                );
                event.target.value = '';
                return;
            }
            const allowedAudioTypes = (window.CONFIG && window.CONFIG.ALLOWED_AUDIO_TYPES) || ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/webm', 'audio/aac', 'audio/flac'];
            if (!file.type || !allowedAudioTypes.includes(file.type)) {
                window.Toast.show('Неподдерживаемый тип файла. Допускаются: MP3, WAV, OGG, WebM, AAC, FLAC', 'warning');
                this.showSoundUploadError(
                    'Неподдерживаемый тип файла',
                    'Допускаются: MP3, WAV, OGG, WebM, AAC, FLAC'
                );
                event.target.value = '';
                return;
            }

            // Magic bytes validation
            const audioBuffer = await file.slice(0, 12).arrayBuffer();
            const audioBytes = new Uint8Array(audioBuffer);
            const isMP3 = (audioBytes[0] === 0xFF && (audioBytes[1] & 0xE0) === 0xE0) ||
                          (audioBytes[0] === 0x49 && audioBytes[1] === 0x44 && audioBytes[2] === 0x33);
            const isWAV = audioBytes[0] === 0x52 && audioBytes[1] === 0x49 &&
                          audioBytes[2] === 0x46 && audioBytes[3] === 0x46;
            const isOGG = audioBytes[0] === 0x4F && audioBytes[1] === 0x67 &&
                          audioBytes[2] === 0x67 && audioBytes[3] === 0x53;
            const isFLAC = audioBytes[0] === 0x66 && audioBytes[1] === 0x4C &&
                           audioBytes[2] === 0x61 && audioBytes[3] === 0x43;
            const isWebM = audioBytes[0] === 0x1A && audioBytes[1] === 0x45 &&
                           audioBytes[2] === 0xDF && audioBytes[3] === 0xA3;
            const isAAC = audioBytes[0] === 0xFF && (audioBytes[1] & 0xF0) === 0xF0;
            if (!isMP3 && !isWAV && !isOGG && !isFLAC && !isWebM && !isAAC) {
                window.Toast.show('Файл не прошёл проверку формата', 'error');
                this.showSoundUploadError(
                    'Файл не прошёл проверку формата',
                    `${file.name} имеет неподдерживаемую сигнатуру`
                );
                event.target.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result;
                const name = file.name.replace(/\.[^.]+$/, ''); // Убираем расширение
                
                // Сохраняем в localStorage
                const customSounds = window.safeJSONParse(localStorage.getItem('customSounds'), []);
                
                // Обновляем иммутабельно
                const hasExisting = customSounds.some(s => s.name === name);
                const updated = hasExisting
                    ? customSounds.map(s => s.name === name ? { ...s, data: base64 } : s)
                    : [...customSounds, { name, data: base64 }];

                const storageResult = window.RendererStorage.safeSetJSON(
                    localStorage,
                    'customSounds',
                    updated,
                    { limitBytes: 4 * 1024 * 1024 }
                );
                if (!storageResult.ok) {
                    const message = storageResult.reason === 'too-large'
                        ? 'Суммарный размер пользовательских звуков слишком большой'
                        : 'Не удалось сохранить звук: хранилище переполнено';
                    window.Toast.show(message, 'error');
                    this.showSoundUploadError(
                        'Не удалось сохранить звук',
                        message
                    );
                    return;
                }
                this.loadCustomSounds();
            };
            reader.onerror = () => {
                window.Toast.show('Ошибка чтения звукового файла', 'error');
                event.target.value = '';
            };
            reader.readAsDataURL(file);
            event.target.value = ''; // Сбрасываем input
    },

    loadCustomSounds() {
            const customSounds = window.safeJSONParse(localStorage.getItem('customSounds'), []);
            const listEl = document.getElementById('customSoundList');
            
            // Очищаем список
            listEl.innerHTML = '';
            
            // Обновляем списки в select'ах (сохраняя текущий выбор)
            ['Start', 'End', 'Minute', 'Overrun'].forEach(type => {
                const select = document.getElementById(`sound${type}Preset`);
                const savedValue = select.value;
                const group = document.getElementById(`customSoundsGroup${type}`);
                group.innerHTML = '';
                customSounds.forEach(sound => {
                    const opt = document.createElement('option');
                    opt.value = `custom:${sound.name}`;
                    opt.textContent = sound.name;
                    group.appendChild(opt);
                });
                // Restore selection if it still exists
                if (savedValue && select.querySelector(`option[value="${CSS.escape(savedValue)}"]`)) {
                    select.value = savedValue;
                }
            });

            // Отображаем список звуков
            if (customSounds.length === 0) {
                listEl.innerHTML = '<div class="sound-empty">Нет добавленных звуков</div>';
                return;
            }

            // SVG иконка ноты + иконки play/delete в стиле lucide (kit allowlist)
            const ICON_MUSIC = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
            const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21"/></svg>';
            const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

            const formatSize = (b) => {
                if (!b || !Number.isFinite(b)) { return ''; }
                if (b < 1024) { return b + ' Б'; }
                if (b < 1024 * 1024) { return (b / 1024).toFixed(0) + ' КБ'; }
                return (b / 1024 / 1024).toFixed(1) + ' МБ';
            };
            // Приблизительный размер из data URL (base64 ≈ 4/3 от бинарника).
            const sizeFromDataURL = (d) => {
                if (!d || typeof d !== 'string') { return 0; }
                const i = d.indexOf(',');
                return i < 0 ? 0 : Math.floor((d.length - i - 1) * 3 / 4);
            };

            customSounds.forEach(sound => {
                const item = document.createElement('div');
                item.className = 'custom-sound-item';

                const libIcon = document.createElement('div');
                libIcon.className = 'lib-icon';
                libIcon.setAttribute('aria-hidden', 'true');
                libIcon.innerHTML = ICON_MUSIC;

                const libMeta = document.createElement('div');
                libMeta.className = 'lib-meta';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'name';
                nameSpan.textContent = sound.name;
                nameSpan.title = sound.name;

                const subSpan = document.createElement('span');
                subSpan.className = 'lib-sub';
                const bytes = sizeFromDataURL(sound.data);
                subSpan.textContent = formatSize(bytes);

                libMeta.appendChild(nameSpan);
                libMeta.appendChild(subSpan);

                const playBtn = document.createElement('button');
                playBtn.className = 'btn play-btn';
                playBtn.title = 'Воспроизвести';
                playBtn.setAttribute('aria-label', 'Воспроизвести');
                playBtn.innerHTML = ICON_PLAY;

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn delete-btn';
                deleteBtn.title = 'Удалить';
                deleteBtn.setAttribute('aria-label', 'Удалить');
                deleteBtn.innerHTML = ICON_DELETE;

                item.appendChild(libIcon);
                item.appendChild(libMeta);
                item.appendChild(playBtn);
                item.appendChild(deleteBtn);
                listEl.appendChild(item);

                playBtn.addEventListener('click', () => this.playCustomSound(sound.name));
                deleteBtn.addEventListener('click', () => this.deleteCustomSound(sound.name));
            });
    },

    async playCustomSound(name) {
            const customSounds = window.safeJSONParse(localStorage.getItem('customSounds'), []);
            const sound = customSounds.find(s => s.name === name);
            if (!sound) {
                // Кастомный звук не найден — проиграем стандартный beep
                await this.beep(880, 0.15);
                return;
            }

            const audio = new Audio(sound.data);
            audio.volume = 0.5;
            try {
                await audio.play();
            } catch (err) {
                console.error('Error playing custom sound:', err);
                // Проиграем стандартный beep если кастомный звук не сработал
                await this.beep(880, 0.15);
            }
    },

    deleteCustomSound(name) {
            const customSounds = window.safeJSONParse(localStorage.getItem('customSounds'), []);
            const filtered = customSounds.filter(s => s.name !== name);
            const storageResult = window.RendererStorage.safeSetJSON(
                localStorage,
                'customSounds',
                filtered,
                { limitBytes: 4 * 1024 * 1024 }
            );
            if (!storageResult.ok) {
                window.Toast.show('Не удалось обновить список звуков', 'error');
                return;
            }

            // Событие, у которого был выбран удаляемый звук, обязано вернуться к
            // «— без звука —». Раньше опция просто исчезала из <select>: значение
            // становилось пустым (selectedIndex = -1, поле показывало пустоту), а
            // в displayExtSettings навсегда оставался мёртвый 'custom:<имя>' —
            // после перезапуска поле снова было пустым, а playSound() уходил в
            // SoundBank с несуществующим именем и молчал без всякого объяснения.
            //
            // Сброс делаем ДО loadCustomSounds(): она сохраняет текущий выбор
            // каждого <select> и восстанавливает его после перестройки списка.
            const dead = `custom:${name}`;
            let resetCount = 0;
            ['Start', 'End', 'Minute', 'Overrun'].forEach(type => {
                const select = document.getElementById(`sound${type}Preset`);
                if (select && select.value === dead) {
                    select.value = 'none';
                    resetCount++;
                }
            });

            this.loadCustomSounds();

            if (resetCount > 0) {
                if (typeof this.saveExtSettings === 'function') { this.saveExtSettings(); }
                window.Toast.show('Звук удалён — событие переведено на «без звука»', 'warning', 2500);
            }
    }
};

if (typeof window !== 'undefined') {
    window.CustomSoundsMixin = CustomSoundsMixin;
}
