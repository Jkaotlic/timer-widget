'use strict';

/**
 * Сетки цветовых свотчей панели — построение и подсветка выбранной темы.
 *
 * Вынесено из inline-скрипта electron-control.html: страж
 * tests/control-decomposition.test.js держит объём кода внутри HTML под 2000
 * строк и сработал ровно на этом блоке, когда в него добавили состояние
 * доступности. Правило репозитория на этот случай прямое: «когда трогаешь
 * самодостаточный блок, ещё живущий инлайново, — вынеси его, а не правь на
 * месте».
 *
 * Это ПРОТОТИПНЫЙ МИКСИН (Object.assign(TimerController.prototype, …)), а не
 * набор свободных функций: методы обращаются к this.currentColors,
 * this.clockColors, this.displayColors, this.saveColors(), this.timerStyleEl
 * и к полям-указателям на активную кнопку (this.activeThemeButton и его
 * родня), а обработчик клика замыкается на this. Миксин сохраняет семантику
 * this ровно, поэтому перенос вышел дословным.
 *
 * Если строка Object.assign потеряется, при загрузке НЕ упадёт ничего —
 * упадёт при первом открытии вкладки с цветами.
 *
 * Восемь свотчей — по смыслу группа радиокнопок, и здесь же живёт их
 * состояние в дереве доступности: до этого «выбран» существовало только как
 * CSS-класс, и скринридер видел восемь одинаковых кнопок без текста.
 */

const ThemeGridMixin = {
    initThemes() {
        const themes = [
            { name: 'Синий', t1: '#667eea', t2: '#764ba2', bg: '#0f0c29' },
            { name: 'Неон', t1: '#39ff14', t2: '#00ffa3', bg: '#0b2b1d' },
            { name: 'Закат', t1: '#ff9966', t2: '#ff5e62', bg: '#1a0a1a' },
            { name: 'Океан', t1: '#36d1dc', t2: '#5b86e5', bg: '#0f2027' },
            { name: 'Мята', t1: '#3cd3ad', t2: '#4cb8c4', bg: '#134e5e' },
            { name: 'Лаванда', t1: '#b993d6', t2: '#8ca6db', bg: '#190a33' },
            { name: 'Солнце', t1: '#f6d365', t2: '#fda085', bg: '#3b1d0f' },
            { name: 'Норд', t1: '#88c0d0', t2: '#81a1c1', bg: '#2e3440' }
        ];

        // Per-window color state
        this.clockColors = null;
        this.displayColors = null;
        this.activeClockThemeButton = null;
        this.activeDisplayThemeButton = null;

        const buildThemeGrid = (gridId, target, activeKey) => {
            const grid = document.getElementById(gridId);
            if (!grid) { return; }
            // Восемь свотчей — по смыслу группа радиокнопок, а по разметке
            // были восемь <button> без текста, и состояние «выбран» жило
            // ТОЛЬКО в CSS-классе: скринридер видел восемь одинаковых
            // кнопок и не мог сказать, какая текущая. Паттерн берём тот же,
            // что уже применён рядом у сегментированных контролов.
            grid.setAttribute('role', 'radiogroup');
            themes.forEach((theme) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'theme-btn';
                btn.title = theme.name;
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', 'false');
                btn.setAttribute('aria-label', theme.name);
                btn.style.setProperty('--t1', theme.t1);
                btn.style.setProperty('--t2', theme.t2);
                // Цвета темы кладём в сам элемент: по ним highlightActiveThemes()
                // после перезапуска находит кнопку, соответствующую сохранённым
                // цветам окна. Читать их из CSS-переменных было бы гаданием.
                btn.dataset.timer = theme.t1;
                btn.dataset.progress = theme.t2;
                btn.addEventListener('click', () => {
                    if (this[activeKey]) {
                        this[activeKey].classList.remove('active');
                        this[activeKey].setAttribute('aria-checked', 'false');
                    }
                    btn.classList.add('active');
                    btn.setAttribute('aria-checked', 'true');
                    this[activeKey] = btn;

                    const colors = { timer: theme.t1, progress: theme.t2, bg: theme.bg };
                    if (target === 'widget') {
                        this.currentColors = colors;
                        document.getElementById('bgSolidColor').value = theme.bg;
                        document.getElementById('bgGrad1').value = theme.bg;
                        this.saveColors('widget');
                        // Модуль подключается классическим <script>, поэтому
                        // кросс-модульные ссылки идут через window.X: голое имя
                        // резолвится только случайно и ломает линт.
                        window.ipcRenderer.send('widget-style-update', { timerStyle: this.timerStyleEl.value, showTicks: this.widgetShowTicksEl?.checked ?? false });
                    } else if (target === 'clock') {
                        this.clockColors = colors;
                        this.saveColors('clock');
                    } else if (target === 'display') {
                        this.displayColors = colors;
                        this.saveColors('display');
                    }
                });
                grid.appendChild(btn);
            });
        };

        buildThemeGrid('themesGrid', 'widget', 'activeThemeButton');
        buildThemeGrid('clockThemesGrid', 'clock', 'activeClockThemeButton');
        buildThemeGrid('displayThemesGrid', 'display', 'activeDisplayThemeButton');
    },

    // Подсветка выбранной темы после перезапуска.
    //
    // Цвета окон лежат в localStorage и исправно доезжают до самих окон, но
    // подсветку ставил ТОЛЬКО обработчик клика — после перезагрузки панели ни
    // одна кнопка ни в одной из трёх сеток не была активной, и пользователь не
    // видел, какая тема выбрана. Соответствие ищем по цветам темы: если окно
    // покрашено пипеткой, ни одна тема не совпадёт и подсветки не будет —
    // это честно, произвольный цвет темой и не является.

    highlightActiveThemes() {
        const targets = [
            { gridId: 'themesGrid', colors: this.currentColors, activeKey: 'activeThemeButton' },
            { gridId: 'clockThemesGrid', colors: this.clockColors, activeKey: 'activeClockThemeButton' },
            { gridId: 'displayThemesGrid', colors: this.displayColors, activeKey: 'activeDisplayThemeButton' }
        ];
        const norm = (v) => String(v || '').trim().toLowerCase();

        targets.forEach(({ gridId, colors, activeKey }) => {
            const grid = document.getElementById(gridId);
            if (!grid) { return; }
            if (this[activeKey]) {
                this[activeKey].classList.remove('active');
                this[activeKey].setAttribute('aria-checked', 'false');
                this[activeKey] = null;
            }
            if (!colors) { return; }
            const match = Array.from(grid.querySelectorAll('.theme-btn')).find(btn =>
                norm(btn.dataset.timer) === norm(colors.timer)
                && norm(btn.dataset.progress) === norm(colors.progress)
            );
            if (match) {
                match.classList.add('active');
                match.setAttribute('aria-checked', 'true');
                this[activeKey] = match;
            }
        });
    }
};

if (typeof window !== 'undefined') {
    window.ThemeGridMixin = ThemeGridMixin;
}
