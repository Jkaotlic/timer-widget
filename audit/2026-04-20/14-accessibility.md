# 14 — accessibility

**Date:** 2026-04-20
**Status:** completed
**Tool used:** grep + manual HTML/CSS review

## Summary

- Total findings: 15
- critical: 0, high: 3, medium: 8, low: 4

## Findings

### F-001: [HIGH] Иконочные кнопки без aria-label

- **Location:** `display.html:1232-1234`, `electron-control.html:3045-3046` и ~30 других
- **Category:** accessibility / WCAG 4.1.2 (Name, Role, Value)
- **Tool:** grep
- **Context:** Кнопки `<button>✕</button>`, `<button>⚙</button>`, `<button>🔄</button>`, `<button>🎵</button>` без aria-label. Screen reader озвучивает "крестик", "шестерёнка" — непонятно для незрячего.
- **Details:** ~30 кнопок-иконок. Блокирует screen reader пользователей.
- **Proposed fix:** Каждой иконочной кнопке добавить `aria-label="Закрыть"`, `aria-label="Настройки"` и т.д.
- **Size estimate:** small (1 файл за раз, ~4 файла, по ~30 кнопок суммарно)
- **Auto-fixable:** yes

---

### F-002: [HIGH] Modal dialogs без role="dialog" aria-modal="true"

- **Location:** `electron-control.html:1834-2020` (exit-modal, faq-modal)
- **Category:** accessibility / WCAG 1.3.1 (Info and Relationships)
- **Tool:** manual review
- **Context:** `<div class="exit-modal">` без role/aria-modal. Screen reader не понимает что это модал.
- **Details:** Также не управляется focus trap.
- **Proposed fix:** `<div role="dialog" aria-modal="true" aria-labelledby="modalTitle">`. Реализовать focus trap (фокус остаётся в модале при Tab).
- **Size estimate:** small
- **Auto-fixable:** yes (для атрибутов; focus trap — manual)

---

### F-003: [HIGH] Color picker (Canvas) без keyboard / screen-reader доступа

- **Location:** `electron-control.html` (ColorPicker class, ~Canvas-based SV+hue)
- **Category:** accessibility
- **Tool:** manual review
- **Context:** Кастомный picker на Canvas. Нет HTML fallback, никакого <input type="color"> рядом.
- **Details:** Незрячие/keyboard-only пользователи не могут выбрать цвет. Hex input — частичный workaround.
- **Proposed fix:** Добавить `<input type="color">` рядом как fallback (синхронизировать с canvas picker).
- **Size estimate:** small
- **Auto-fixable:** no

---

### F-004: [MEDIUM] Modal focus trap не реализован

- **Location:** `electron-control.html` (exit-modal, faq-modal)
- **Category:** accessibility
- **Details:** Tab выводит фокус из модала.
- **Proposed fix:** Слушать Tab в модале, цикл фокуса между первым и последним focusable.
- **Size estimate:** small
- **Auto-fixable:** no

---

### F-005: [MEDIUM] Контраст текста ниже WCAG AA (`rgba(255,255,255,0.4-0.5)`)

- **Location:** `electron-control.html`, `electron-widget.html`, `display.html` — labels стилей
- **Category:** accessibility / WCAG 1.4.3
- **Details:** На стеклянном фоне 0.4 alpha ≈ 3.2:1 contrast (норма ≥4.5:1).
- **Proposed fix:** Поднять до `rgba(255,255,255,0.7)` для всех second-tier labels.
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-006: [MEDIUM] Нет prefers-reduced-motion media query

- **Location:** все `*.html` (анимации flip, danger-pulse, на 00:00 эффекты)
- **Category:** accessibility / WCAG 2.3.3
- **Details:** Пользователи с вестибулярными нарушениями не могут отключить анимации.
- **Proposed fix:**
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
  ```
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-007: [MEDIUM] Form controls без `<label>` или aria-label

- **Location:** `electron-control.html` — 30+ inputs/selects
- **Category:** accessibility / WCAG 3.3.2
- **Details:** Многие `<input>`, `<select>` не связаны с label через `for`/`id`.
- **Proposed fix:** Добавить `<label for="...">` или `aria-label`.
- **Size estimate:** small (но много мест)
- **Auto-fixable:** partially

---

### F-008-F-012: [MEDIUM] Прочие label/focus issues

- Tab кнопки иконок без aria-labels
- Modal buttons без initial focus
- FAQ modal не закрывается Escape
- Select/checkbox без label associations

---

### F-013-F-015: [LOW] Прочее

- Нет :focus-visible стилей на кнопках
- Нет skip-to-main-content link
- Time inputs `type="text"` вместо `type="time"`

---

## Effort estimate: 15-25 часов до полного WCAG AA

Tier 1 (~3-5h): aria-labels, role="dialog", контраст, prefers-reduced-motion.
Tier 2 (~5-10h): focus traps, label associations, Escape для FAQ.
Tier 3 (~5-10h): Color picker fallback, focus indicators, semantic time inputs.
