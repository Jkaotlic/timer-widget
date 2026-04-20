# 17 Content Compliance (Политический контент, protestware)

**Дата:** 2026-04-20  
**Категория:** 17-content-compliance  
**Уровень серьезности:** LOW (документация), информирующая

> **Disclaimer:** Эта категория — информирующая. Обнаружение политического контента — факт для compliance review. Возможны false positives (например "ukraine" в списке локалей).

## Резюме

Проверена в проекте наличие:
- Destructive protestware пакетов (node-ipc 10.1.1–10.1.3, peacenotwar, colors 1.4.44-liberty, event-source-polyfill 1.0.26)
- Политизированного контента в исходниках и зависимостях
- Activist-badging в README
- Неопатчированных политических ссылок после build

**Результат:** ✅ Все критические проверки пройдены

---

## Findings

### F-001: Документирование политизированного контента в `docs/SUPPLY_CHAIN.md` (LOW)

**Файл:** `docs/SUPPLY_CHAIN.md` (lines 38–45)

**Содержание:**
```markdown
## Политизированный контент

Пакет `acorn` (парсер ECMAScript, используется Chromium/V8) содержит политизированный баннер 
`StandWithUkraine` в `LICENSES.chromium.html`.

Файл [`build/after-pack.js`](../build/after-pack.js) автоматически удаляет этот баннер при 
сборке (`afterPack` hook electron-builder):
- URL `https://stand-with-ukraine.pp.ua` вычищается
- Ссылка на `github.com/acornjs/acorn` заменяется на нейтральную `npmjs.com/package/acorn`
- HTML-блок `Support Ukraine` удаляется регулярным выражением
```

**Вердикт:** ✅ **Приемлемо** — это **документирование** механизма санитизации, а не сам контент. Файл описывает, как проект справляется с политизированной зависимостью (acorn), и является частью transparency documentation.

**Статус:** Нет действий необходимо.

---

### F-002: Acorn 8.16.0 в transitive зависимостях (LOW, KNOWN)

**Пакет:** `acorn@8.16.0` (включена через Chromium/electron-builder)

**Известное:** Acorn содержит `StandWithUkraine` баннер в лицензионном HTML при сборке.

**Контрмеры:**
- ✅ `build/after-pack.js` активен: удаляет `StandWithUkraine` из `LICENSES.chromium.html`
- ✅ Regex patterns в hooks:
  - `/StandWithUkraine/gi` → удаление
  - `https://stand-with-ukraine.pp.ua` → пустая строка
  - `github.com/acornjs/acorn` → `npmjs.com/package/acorn` (нейтральная ссылка)
  - `/<h2[^>]*>[^<]*Support Ukraine[^<]*<\/h2>[\s\S]*?<\/p>/gi` (HTML баннер)

**Вердикт:** ✅ **Контролируется** — политический контент зависимости исключается при сборке.

---

### F-003: Отсутствие destructive protestware (CRITICAL)

**Проверки:**
- ❌ `node-ipc` — не найден
- ❌ `peacenotwar` — не найден  
- ❌ `event-source-polyfill` — не найден
- ❌ `colors` (1.4.44-liberty и позже) — не найден
- ❌ `es5-ext` (0.10.54+) — не найден

**DevDependencies (только безопасные):**
- `@playwright/test@^1.58.2` ✅
- `electron@^41.2.1` ✅
- `electron-builder@^26.8.1` ✅
- `eslint@^9.39.4` ✅
- `globals@^17.4.0` ✅

**Вердикт:** ✅ **PASS** — destructive пакеты отсутствуют.

---

### F-004: Политический контент в исходниках проекта (CRITICAL)

**Grep по паттернам:**
```
"stand.with.ukraine|stand-with-ukraine|slava.ukrain|russian.warship|
russian.invaders|no.war|stop.war|support.ukraine|save.ukraine"
```

в: `.js`, `.html`, `.md`, `.json` (exclude: `node_modules/`, `audit/`)

**Результат:** 
- ✅ Отсутствует в исходниках (`.js`, `.html`, `.json`)
- ✅ Найдено только в `docs/SUPPLY_CHAIN.md` (документирование процесса санитизации, не сам контент)
- ✅ Отсутствует в `README.md`, `CHANGELOG.md`, `package.json`

**Вердикт:** ✅ **PASS**

---

### F-005: Activist badges в README (CRITICAL)

**Проверка:** Shields.io badges с политическим контентом

```regex
img\.shields\.io/badge/[^)]*ukraine|
img\.shields\.io/badge/[^)]*palestine|
img\.shields\.io/badge/[^)]*BLM
```

**Результат:**
```
Version        — img.shields.io/badge/v2.2.3-0a84ff (neutral)
Electron       — img.shields.io/badge/Electron_41-47848F (neutral)
CI             — github.com/actions/workflow (neutral)
Platform       — img.shields.io/badge/Windows_|_macOS_|_Linux (neutral)
License        — img.shields.io/badge/MIT-30d158 (neutral)
```

**Вердикт:** ✅ **PASS** — все badges нейтральны.

---

### F-006: node_modules/* README.md (top-level transitive)

**Проверка:** 
```bash
grep -ri "ukraine|stand.with|russia" node_modules --include="*.md" 2>&1 | grep -v "acorn"
```

**Результат:** Ничего не найдено (кроме `acorn`, который известен и контролируется).

**Вердикт:** ✅ **PASS**

---

### F-007: CHANGELOG.md нейтральность (LOW)

**Проверка версий:**

- `v2.2.3` (2026-04-20): добавлены SBOM, NOTICE, логирование — все документирование, **нейтрально**
- `v2.2.2` (2026-04-17): Google Fonts → локальные, CSP, cleanup, **нейтрально**
- `v2.2.1` (2026-04-17): "Удалён политизированный баннер StandWithUkraine..." — это **описание fix**, не сам контент **✅**
- `v1.2.9–v1.2.5`: фиксы, feature-добавления, **нейтрально**

**Вердикт:** ✅ **PASS** — CHANGELOG транспарентен и нейтрален. Запись в v2.2.1 является легитимным документированием security fix.

---

## Итоговая таблица

| Finding | Статус | Severity | Action |
|---------|--------|----------|--------|
| F-001: SUPPLY_CHAIN.md документирование | ✅ PASS | LOW | none |
| F-002: acorn 8.16.0 + afterPack hook | ✅ CONTROLLED | LOW | monitor |
| F-003: Отсутствие destructive пакетов | ✅ PASS | CRITICAL | — |
| F-004: Политический контент в исходниках | ✅ PASS | CRITICAL | — |
| F-005: Activist badges | ✅ PASS | CRITICAL | — |
| F-006: node_modules README.md | ✅ PASS | MEDIUM | — |
| F-007: CHANGELOG.md | ✅ PASS | LOW | — |

---

## Выводы

1. **Проект соответствует политике контент-compliance v1.0** (2026-04-20)
2. **Единственный политизированный контент** — в `acorn` (transitive Chromium dep), **полностью исключается** при сборке через `build/after-pack.js`
3. **Исходный код проекта чист** от идеологического контента
4. **DevDependencies безопасны** — нет известного protestware
5. **Документирование transparent** — проект честно описывает, как справляется с политизированной зависимостью

### Recommendation

✅ **No action required.** Проект прошёл compliance audit. Продолжать мониторить:
- Обновления `acorn` (при обновлении Electron/Chromium)
- Новые зависимости в `package.json` (перед npm install)

---

**Проверено:** 2026-04-20  
**Категория:** 17-content-compliance (информирующая)  
**Формат:** audit-report v1.1

