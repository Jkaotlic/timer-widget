'use strict';

/**
 * local-background.js — фоновое изображение полноэкранного режима: выбор файла,
 * проверка, превью, режим заполнения, затемнение и хранение.
 *
 * Проверка файла здесь двухступенчатая и обе ступени обязательны: MIME-тип
 * приходит от системы и подделывается тривиально, поэтому дополнительно
 * сверяются magic bytes. WebP требует отдельной ветки — у него сигнатура
 * составная (RIFF в начале и WEBP на 8-м байте), одним префиксом не покрывается.
 *
 * Форма поставки — примесь к прототипу TimerController, как и custom-sounds.js:
 * методы вызывают друг друга и pushDisplaySettings() контроллера, поэтому
 * примесь сохраняет семантику this и делает перенос дословным.
 *
 * Зависимости берутся из window (Toast, LoadingIndicator, CONFIG, safeJSONParse):
 * сборщика в проекте нет, каждый файл — отдельный classic-script.
 */

const LocalBackgroundMixin = {
    setupLocalBackground() {
            const preview = document.getElementById('localBgPreview');
            const fileInput = document.getElementById('bgFileInput');
            const changeBtn = document.getElementById('changeBgBtn');
            const deleteBtn = document.getElementById('deleteBgBtn');
            const overlaySlider = document.getElementById('bgOverlaySlider');
            const overlayValue = document.getElementById('bgOverlayValue');

            // Клик по превью - открыть диалог выбора файла
            preview.addEventListener('click', (e) => {
                if (e.target === changeBtn || e.target === deleteBtn) {return;}
                fileInput.click();
            });

            // Кнопка изменить
            changeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });

            // Кнопка удалить
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteLocalBackground();
            });

            // Выбор файла
            fileInput.addEventListener('change', (e) => {
                this.handleLocalBgUpload(e);
            });

            // Режим заполнения
            document.querySelectorAll('.bg-fit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.bg-fit-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.saveLocalBgSettings();
                    this.pushDisplaySettings();
                });
            });

            // Затемнение
            overlaySlider.addEventListener('input', () => {
                overlayValue.textContent = overlaySlider.value + '%';
                this.saveLocalBgSettings();
                this.pushDisplaySettings();
            });

            // Загружаем сохранённый фон
            this.loadLocalBackground();
    },

    // FIX BUG-025, BUG-026: Validate file upload with MIME and magic bytes
    async validateImageFile(file) {
            // Проверка размера
            const MAX_SIZE = (window.CONFIG && window.CONFIG.MAX_IMAGE_FILE_SIZE) || 10 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                return { valid: false, error: 'Файл слишком большой (максимум 10 МБ)' };
            }

            // Проверка MIME type
            const allowedTypes = (window.CONFIG && window.CONFIG.ALLOWED_IMAGE_TYPES) || ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
            if (!file.type || !allowedTypes.includes(file.type)) {
                return { valid: false, error: 'Неподдерживаемый тип файла. Используйте JPG, PNG, GIF, WebP или BMP' };
            }

            // Проверка magic bytes (первые байты файла)
            try {
                const buffer = await file.slice(0, 12).arrayBuffer();
                const bytes = new Uint8Array(buffer);

                // Сигнатуры форматов изображений
                const signatures = {
                    jpeg: [[0xFF, 0xD8, 0xFF]],
                    png: [[0x89, 0x50, 0x4E, 0x47]],
                    gif: [[0x47, 0x49, 0x46, 0x38]],
                    bmp: [[0x42, 0x4D]] // BM
                };

                let isValid = false;
                // WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
                if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
                    isValid = true;
                }
                if (!isValid) {
                    for (const sigs of Object.values(signatures)) {
                        for (const sig of sigs) {
                            if (sig.every((byte, i) => bytes[i] === byte)) {
                                isValid = true;
                                break;
                            }
                        }
                        if (isValid) { break; }
                    }
                }

                if (!isValid) {
                    return { valid: false, error: 'Файл поврежден или не является изображением' };
                }
            } catch {
                return { valid: false, error: 'Ошибка при проверке файла' };
            }

            return { valid: true };
    },

    async handleLocalBgUpload(event) {
            const file = event.target.files[0];
            if (!file) {return;}

            // FIX BUG-028: Show loading indicator during file processing
            const loadingOverlay = window.LoadingIndicator.show('Загрузка изображения...');

            try {
                // FIX BUG-025, BUG-026: Validate file before upload
                const validation = await this.validateImageFile(file);
                if (!validation.valid) {
                    window.Toast.show(validation.error, 'error');
                    event.target.value = ''; // Сбрасываем input
                    window.LoadingIndicator.hide(loadingOverlay);
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64 = e.target.result;

                    // Сохраняем в localStorage
                    try {
                        localStorage.setItem('localBgImage', base64);
                    } catch (err) {
                        if (err.name === 'QuotaExceededError') {
                            window.Toast.show('Изображение слишком большое для хранилища', 'error');
                        } else {
                            window.Toast.show('Ошибка сохранения изображения', 'error');
                        }
                        window.LoadingIndicator.hide(loadingOverlay);
                        return;
                    }

                    // Обновляем UI
                    this.showLocalBgPreview(base64);

                    // Применяем настройки
                    this.pushDisplaySettings();

                    // Hide loading indicator
                    window.LoadingIndicator.hide(loadingOverlay);
                };

                reader.onerror = () => {
                    window.Toast.show('Ошибка при чтении файла', 'error');
                    event.target.value = '';
                    window.LoadingIndicator.hide(loadingOverlay);
                };

                reader.readAsDataURL(file);
                event.target.value = ''; // Сбрасываем input
            } catch {
                window.Toast.show('Произошла ошибка при обработке файла', 'error');
                window.LoadingIndicator.hide(loadingOverlay);
                event.target.value = '';
            }
    },

    showLocalBgPreview(base64) {
            const preview = document.getElementById('localBgPreview');
            const placeholder = document.getElementById('localBgPlaceholder');
            const image = document.getElementById('localBgImage');
            const fitOptions = document.getElementById('bgFitOptions');
            const overlayRow = document.getElementById('bgOverlayRow');

            image.src = base64;
            image.style.display = 'block';
            placeholder.style.display = 'none';
            preview.classList.add('has-image');
            fitOptions.style.display = 'flex';
            overlayRow.style.display = 'flex';
    },

    hideLocalBgPreview() {
            const preview = document.getElementById('localBgPreview');
            const placeholder = document.getElementById('localBgPlaceholder');
            const image = document.getElementById('localBgImage');
            const fitOptions = document.getElementById('bgFitOptions');
            const overlayRow = document.getElementById('bgOverlayRow');

            image.src = '';
            image.style.display = 'none';
            placeholder.style.display = 'block';
            preview.classList.remove('has-image');
            fitOptions.style.display = 'none';
            overlayRow.style.display = 'none';
    },

    loadLocalBackground() {
            const savedBg = localStorage.getItem('localBgImage');
            const savedSettings = window.safeJSONParse(localStorage.getItem('localBgSettings'), {});
            
            if (savedBg) {
                this.showLocalBgPreview(savedBg);
                
                // Применяем настройки
                if (savedSettings.fit) {
                    document.querySelectorAll('.bg-fit-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.fit === savedSettings.fit);
                    });
                }
                if (savedSettings.overlay !== undefined) {
                    document.getElementById('bgOverlaySlider').value = savedSettings.overlay;
                    document.getElementById('bgOverlayValue').textContent = savedSettings.overlay + '%';
                }
            }
    },

    deleteLocalBackground() {
            localStorage.removeItem('localBgImage');
            localStorage.removeItem('localBgSettings');
            this.hideLocalBgPreview();
            
            // Если был выбран режим local, переключаемся на solid
            if (this.currentBgMode === 'local') {
                document.querySelectorAll('.bg-mode-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('.bg-mode-btn[data-mode="solid"]').classList.add('active');
                document.querySelectorAll('.bg-controls').forEach(c => c.classList.remove('active'));
                document.getElementById('bgSolidControls').classList.add('active');
                this.currentBgMode = 'solid';
            }
            
            this.pushDisplaySettings();
    },

    saveLocalBgSettings() {
            const activeBtn = document.querySelector('.bg-fit-btn.active');
            const overlay = document.getElementById('bgOverlaySlider').value;
            
            localStorage.setItem('localBgSettings', JSON.stringify({
                fit: activeBtn ? activeBtn.dataset.fit : 'cover',
                overlay: parseInt(overlay)
            }));
    }
};

if (typeof window !== 'undefined') {
    window.LocalBackgroundMixin = LocalBackgroundMixin;
}
