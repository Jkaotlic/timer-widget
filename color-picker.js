'use strict';

/**
 * color-picker.js — HSV-выбор цвета: область насыщенность/яркость, полоса
 * оттенка и hex-поле. Три независимых экземпляра — для виджета, часов и
 * полноэкранного режима.
 *
 * Вынесено из inline-скрипта electron-control.html. Класс не знает ни о таймере,
 * ни о настройках: получает id-шники своих канвасов и колбэк onColorChange.
 * Арифметика преобразований живёт в color-utils.js — здесь только рисование и ввод.
 *
 * addPickerToggle() довешивает к сетке тем кнопку-радугу, открывающую панель.
 * У кнопки role="button" и tabindex=0, поэтому обработчик клавиатуры обязателен —
 * без него элемент фокусируется, но не активируется.
 */

// === Color Picker ===
class ColorPicker {
    constructor(svCanvasId, hueCanvasId, hexInputId, previewId, panelId, onColorChange) {
        this.svCanvas = document.getElementById(svCanvasId);
        this.hueCanvas = document.getElementById(hueCanvasId);
        this.hexInput = document.getElementById(hexInputId);
        this.preview = document.getElementById(previewId);
        this.panel = document.getElementById(panelId);
        this.onColorChange = onColorChange;
        this.h = 0; this.s = 1; this.v = 1;
        this.draggingSV = false;
        this.draggingHue = false;
        this.init();
    }

    init() {
        // SV canvas events
        this.svCanvas.addEventListener('pointerdown', (e) => {
            this.draggingSV = true;
            this.svCanvas.setPointerCapture(e.pointerId);
            this.pickSV(e);
        });
        this.svCanvas.addEventListener('pointermove', (e) => { if (this.draggingSV) { this.pickSV(e); } });
        this.svCanvas.addEventListener('pointerup', () => { this.draggingSV = false; });

        // Hue canvas events
        this.hueCanvas.addEventListener('pointerdown', (e) => {
            this.draggingHue = true;
            this.hueCanvas.setPointerCapture(e.pointerId);
            this.pickHue(e);
        });
        this.hueCanvas.addEventListener('pointermove', (e) => { if (this.draggingHue) { this.pickHue(e); } });
        this.hueCanvas.addEventListener('pointerup', () => { this.draggingHue = false; });

        // Hex input
        this.hexInput.addEventListener('change', () => {
            let hex = this.hexInput.value.trim();
            if (!hex.startsWith('#')) { hex = '#' + hex; }
            if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                const [h, s, v] = ColorPicker.hexToHsv(hex);
                this.h = h; this.s = s; this.v = v;
                this.drawSV();
                this.updatePreview();
                this.onColorChange(hex);
            }
        });

        this.drawHue();
        this.drawSV();
        this.updatePreview();
    }

    toggle() {
        this.panel.classList.toggle('open');
        if (this.panel.classList.contains('open')) {
            this.drawHue();
            this.drawSV();
        }
    }

    setColor(hex) {
        if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) { return; }
        const [h, s, v] = ColorPicker.hexToHsv(hex);
        this.h = h; this.s = s; this.v = v;
        if (this.panel.classList.contains('open')) {
            this.drawSV();
            this.drawHue();
        }
        this.updatePreview();
    }

    pickSV(e) {
        const rect = this.svCanvas.getBoundingClientRect();
        this.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
        this.drawSV();
        this.updatePreview();
        this.onColorChange(ColorPicker.hsvToHex(this.h, this.s, this.v));
    }

    pickHue(e) {
        const rect = this.hueCanvas.getBoundingClientRect();
        this.h = Math.max(0, Math.min(360, (e.clientX - rect.left) / rect.width * 360));
        this.drawSV();
        this.drawHue();
        this.updatePreview();
        this.onColorChange(ColorPicker.hsvToHex(this.h, this.s, this.v));
    }

    drawSV() {
        const canvas = this.svCanvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.offsetWidth;
        const h = canvas.height = canvas.offsetHeight;

        // Base hue color
        const hueColor = ColorPicker.hsvToHex(this.h, 1, 1);

        // Saturation gradient (left to right: white -> hue)
        const gradH = ctx.createLinearGradient(0, 0, w, 0);
        gradH.addColorStop(0, '#ffffff');
        gradH.addColorStop(1, hueColor);
        ctx.fillStyle = gradH;
        ctx.fillRect(0, 0, w, h);

        // Value gradient (top to bottom: transparent -> black)
        const gradV = ctx.createLinearGradient(0, 0, 0, h);
        gradV.addColorStop(0, 'rgba(0,0,0,0)');
        gradV.addColorStop(1, '#000000');
        ctx.fillStyle = gradV;
        ctx.fillRect(0, 0, w, h);

        // Draw cursor
        const cx = this.s * w;
        const cy = (1 - this.v) * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    drawHue() {
        const canvas = this.hueCanvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.offsetWidth;
        const h = canvas.height = canvas.offsetHeight;

        // Draw hue spectrum
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 6; i++) {
            grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, h / 2);
        ctx.fill();

        // Draw cursor
        const cx = (this.h / 360) * w;
        ctx.beginPath();
        ctx.arc(cx, h / 2, h / 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    updatePreview() {
        const hex = ColorPicker.hsvToHex(this.h, this.s, this.v);
        this.preview.style.background = hex;
        this.hexInput.value = hex;
    }

    // Преобразования цвета живут в color-utils.js. Обращаемся через window.*,
    // как это делают остальные модули рендерера (RendererShared, TimeUtils):
    // отдельный <script> без сборщика не имеет импортов, а голое имя ломает
    // статический анализ.
    static hsvToRgb(h, s, v) {
        return window.ColorUtils.hsvToRgb(h, s, v);
    }

    static hsvToHex(h, s, v) {
        return window.ColorUtils.hsvToHex(h, s, v);
    }

    static hexToHsv(hex) {
        return window.ColorUtils.hexToHsv(hex);
    }
}

// Create color picker toggle buttons and instances
function addPickerToggle(gridId, pickerId, pickerConfig) {
    const grid = document.getElementById(gridId);
    if (!grid) { return null; }
    // Настоящая <button>, а не <div role="button"> среди настоящих кнопок:
    // роль и tabindex приходилось подделывать вручную, а Enter/Space —
    // обрабатывать отдельным слушателем.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'color-picker-toggle';
    toggle.title = 'Выбрать свой цвет';
    toggle.setAttribute('aria-label', 'Выбрать свой цвет');
    // Кнопка открывает панель и обязана об этом сообщать. Правило
    // .color-picker-toggle.active в CSS есть, но класс на неё не вешал никто —
    // состояние было описано и мертво.
    toggle.setAttribute('aria-expanded', 'false');
    grid.appendChild(toggle);

    const picker = new ColorPicker(
        pickerConfig.sv, pickerConfig.hue, pickerConfig.hex,
        pickerConfig.preview, pickerId, pickerConfig.onChange
    );
    // Enter/Space обрабатывать вручную больше не нужно: нативная <button>
    // делает это сама.
    toggle.addEventListener('click', () => {
        picker.toggle();
        const open = picker.panel.classList.contains('open');
        toggle.classList.toggle('active', open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    return picker;
}

if (typeof window !== 'undefined') {
    window.ColorPicker = ColorPicker;
    window.addPickerToggle = addPickerToggle;
}
