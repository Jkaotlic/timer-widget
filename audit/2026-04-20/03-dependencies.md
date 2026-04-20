# 03 — dependencies

**Date:** 2026-04-20
**Status:** completed
**Tool used:** npm audit + npm outdated + grep

## Summary

- Total findings: 2
- critical: 0, high: 0, medium: 1, low: 1
- CVE vulnerabilities: 0 (across 447 dependencies)
- electron-log confirmed in-use (production dep)

## Findings

### F-001: [MEDIUM] eslint outdated: 9.39.4 → 10.2.1

- **Location:** `package.json` devDependencies
- **Category:** dependencies
- **Tool:** npm outdated --json
- **Context:** `"eslint": "^9.39.4"` (current) vs `10.2.1` (latest)
- **Details:** Major version отстаёт (9.x → 10.x). Linting tool, major может содержать breaking config/rule changes. Caret `^9.39.4` блокирует автообновление до 10.x.
- **Proposed fix:** Прочитать changelog ESLint 10, оценить breaking changes, обновить `"eslint": "^10.2.1"` если совместимо.
- **Size estimate:** small
- **Auto-fixable:** no (major upgrade — manual review)

---

### F-002: [LOW] globals outdated: 17.4.0 → 17.5.0

- **Location:** `package.json` devDependencies
- **Category:** dependencies
- **Tool:** npm outdated --json
- **Context:** `"globals": "^17.4.0"` (current) vs `17.5.0` (latest)
- **Details:** Minor отстаёт. Caret `^17.4.0` теоретически разрешает 17.5.0, но lockfile зафиксирован на 17.4.0.
- **Proposed fix:** `npm update globals` обновит до 17.5.0.
- **Size estimate:** small
- **Auto-fixable:** yes

---

## Дополнительно

- electron-log@5.4.3 — production dep, активно используется в `electron-main.js` (`require('electron-log/main')`)
- Нет конфликтов peer dependencies
- electron@41.2.1, electron-builder@26.8.1, @playwright/test — все зелёные, 0 CVE
