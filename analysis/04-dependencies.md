# Анализ зависимостей Timer Widget v1.2.9

## Критические

### DEP-01: lodash high severity CVE (транзитивная)
- **Пакет**: `lodash` (через `lodash.merge` в `electron-builder`)
- **CVE**: GHSA-r5fr-rjxr-66jc (Code Injection via _.template), GHSA-f23m-r3pf-42rh (Prototype Pollution)
- **Severity**: High
- **Решение**: `npm audit fix` — обновит до исправленной версии.
- **Статус**: [ ] Не исправлено

## Средние

### DEP-02: Минорные обновления доступны
- **Пакеты**:
  - `@playwright/test`: 1.58.2 -> 1.59.1
  - `electron`: 41.1.0 -> 41.1.1
- **Решение**: `npm update`
- **Статус**: [ ] Не исправлено

## Информационные

### DEP-03: ESLint мажорное обновление (9 -> 10)
- **Пакет**: `eslint`: 9.39.4 -> 10.2.0
- **Решение**: Не критично, можно обновить позже. Текущая конфигурация (flat config) совместима.
- **Статус**: [ ] Отложено

## Позитивные аспекты

- Нет неиспользуемых прямых зависимостей
- Все зависимости — devDependencies (приложение standalone через electron-builder)
- package-lock.json присутствует и актуален
