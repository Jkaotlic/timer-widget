# 16 — license-compliance

**Date:** 2026-04-20
**Status:** completed
**Tool used:** license-checker (NOTICE) + manual review

## Summary

- Total findings: 0
- critical: 0, high: 0, medium: 0, low: 0

## Состояние: PASS

### Project license

- **LICENSE файл:** существует, валидный MIT.
- **package.json:** `"license": "MIT"` указано.

### Direct dependency licenses

| Пакет | Версия | Лицензия | Совместимость |
|---|---|---|---|
| electron | 41.2.1 | MIT | ✓ |
| electron-builder | 26.8.1 | MIT | ✓ |
| electron-log (prod) | 5.4.3 | MIT | ✓ |
| @playwright/test | 1.58.2 | Apache-2.0 | ✓ |
| eslint | 9.39.4 | MIT | ✓ |
| globals | 17.4.0 | MIT | ✓ |

### Транзитивные (из NOTICE, 365 пакетов)

- MIT: 259
- ISC: 51
- Apache-2.0: 21
- BSD-2-Clause / BSD-3-Clause: 18
- BlueOak-1.0.0: 11 (permissive)
- Python-2.0: 1 (legacy argparse)
- WTFPL: 2 (permissive)
- **GPL/AGPL/SSPL: 0** ✓

### Проверено

- ✓ Нет несовместимых лицензий (нет GPL/AGPL в MIT distribution)
- ✓ Нет UNKNOWN/Unlicensed пакетов
- ✓ NOTICE содержит атрибуцию для 365 пакетов
- ✓ SBOM (CycloneDX 1.5) актуален
- ✓ Apache-2.0 совместим с MIT (permissive — permissive)

## Заключение

License compliance в полном порядке. Действий не требуется.
