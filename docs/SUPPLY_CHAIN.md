# Supply Chain & Licensing

## SBOM (Software Bill of Materials)

Файл [`sbom.json`](../sbom.json) — машиночитаемый список всех NPM-пакетов в формате **CycloneDX 1.5**.

Используется для:
- **Vulnerability scanning** — `grype sbom:sbom.json` или Dependency-Track
- **Compliance аудитов** — corp-аудиторы (SberTech, ФСТЭК) могут импортировать
- **Supply-chain атак** — быстро проверить наличие конкретной версии уязвимого пакета

### Регенерация

```bash
npm run sbom
```

Команда запускает `@cyclonedx/cyclonedx-npm` (Apache-2.0).

## NOTICE файл

Файл [`NOTICE`](../NOTICE) — человекочитаемый список всех пакетов с лицензиями и атрибуцией.

Требование MIT/Apache/BSD лицензий — при распространении указывать имя оригинальных авторов и текст лицензии.

### Регенерация

```bash
npm run notice
```

Скрипт [`scripts/generate-notice.js`](../scripts/generate-notice.js) использует `license-checker`.

### Что не включено в NOTICE

Лицензии **встроенного Electron runtime** (Chromium, V8, Node.js, libuv, zlib, OpenSSL, и ~1000+ транзитивных C++ компонентов) находятся в файле `LICENSES.chromium.html` — он автоматически генерируется `electron-builder` при сборке и поставляется рядом с приложением.

## Политизированный контент

Пакет `acorn` (парсер ECMAScript, используется Chromium/V8) содержит политизированный баннер `StandWithUkraine` в `LICENSES.chromium.html`.

Файл [`build/after-pack.js`](../build/after-pack.js) автоматически удаляет этот баннер при сборке (`afterPack` hook electron-builder):
- URL `https://stand-with-ukraine.pp.ua` вычищается
- Ссылка на `github.com/acornjs/acorn` заменяется на нейтральную `npmjs.com/package/acorn`
- HTML-блок `Support Ukraine` удаляется регулярным выражением

## Verification

Проверить отсутствие известных уязвимостей:

```bash
npm audit --production  # у нас 0 production deps, ожидаемо "0 vulnerabilities"
npm audit               # все devDeps (проверяется в CI)
```

CycloneDX SBOM можно импортировать в:
- [Dependency-Track](https://dependencytrack.org/)
- [OSV-Scanner](https://osv.dev/)
- SBOM Observer, SOOS, Snyk
