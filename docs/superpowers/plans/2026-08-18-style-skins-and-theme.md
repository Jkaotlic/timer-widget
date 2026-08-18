# План: 2026-08-18-style-skins-and-theme

Спека: `docs/superpowers/specs/2026-08-18-style-skins-and-theme.md`.

## 1. Тон фона — одна функция на три окна  (TDD)

`renderer-shared.js`: `surfaceTone({ color, alpha, theme })` — тон окна, чей фон
задан ПОДЛОЖКОЙ, а не режимом. Прозрачная (alpha < 0.5) подложка тона не решает
— решает тема. Тест первым.

## 2. Токены стилей

`--style-plate / -hinge / -gloss / -edge / -dial / -tick / -tick-strong /
-hand / -ink-shadow / -drop`, объявлены в `:root:not(.on-light-bg)` и
`:root.on-light-bg`. Три окна: `display.css`, `electron-widget.html`,
`electron-clock-widget.html`. Все литералы пластин переписаны.

## 3. Блоки повторяют стиль (дисплей)

- флип: `.info-value` → пластина со сгибом и бликом;
- цифры: `display-script` кладёт выбранный шрифт «Цифр» и на `.info-value`;
- аналог: мини-часы на общих токенах, центр — цвет таймера.

## 4. Режим фона «По теме»

- `display-script.applyBackground`: `mode === 'theme'` → градиент по теме;
- `backgroundTone`: режим `theme` уже падает в ветку «решает тема»;
- панель: четвёртая кнопка режима, умолчание на чистом профиле;
- `settings-schema` / `panel-display` — без новых копий списка.

## 5. Тема доезжает до окон

- `UITheme.bindThemeSync(ipc, onChange)` — колбэк;
- виджет: пин снят, ставится `.on-light-bg`;
- часы: тон по подложке;
- дисплей: перекраска фона и тона на смену темы.

## 6. Проверка

- `npm test` (778 → больше), обновить `tests/ui-theme.test.js` (виджет больше
  не «прибит темой») и `tests/contrast.test.js` (светлый виджет);
- новые e2e: блоки в стиле флипа/цифр, светлая тема в виджете и дисплее;
- кадры: `npm run screenshot` до и после — визуальную правку показывать
  картинкой, а не описанием.
