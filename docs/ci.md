# CI: что проверяет каждый job

`.github/workflows/nodejs.yml` (push/PR в main и ручной запуск) и
`.github/workflows/release.yml` (тег `v*`). Node 22.

| Job | Где | Что |
|-----|-----|-----|
| `build` | ubuntu-latest | `npm run ci`, затем `visual:check` под xvfb (блокирует промах кадра) и неблокирующий `coverage`. Визуальному шагу нужен `chmod 4755` + root на `chrome-sandbox` дев-бинаря, иначе Chromium падает с кодом 133 |
| `unit-cross-platform` | windows + macos | `npm run lint` + `npm test` — класс «ломается только не на Linux» (CRLF) |
| `e2e` | ubuntu + windows + macos | `npx playwright test` — настоящий рантайм. Linux под `xvfb-run`; `fail-fast: false` |
| `pack` | ubuntu + windows | `electron-builder --dir` + `scripts/verify-packed.js`: состав `app.asar`, релизные гейты, фьюзы |
| `linux-sandbox` | ubuntu-latest | собирает deb ОДИН раз, `scripts/verify-linux-sandbox.js` (postinst, профиль AppArmor, Depends, нет `--no-sandbox`), выкладывает deb артефактом `linux-deb` |
| `security` | ubuntu-latest | ворота уязвимостей по lockfile и SBOM — ниже |
| `deb-scan` | ubuntu-latest | скан СОБРАННОГО deb — ниже |
| `deb-launch-runner` | ubuntu-24.04, матрица `userns` / `suid` | установка deb на ядро раннера и запуск — ниже |
| `deb-launch-container` | ubuntu:24.04, ubuntu:22.04, debian:12 | установка в чистый дистрибутив и запуск — ниже |

Релиз собирается на macOS (Intel + ARM), Windows и ubuntu, Node 22.

**`pack` ловит то, чего не видит `tests/packaging.test.js`**: юнит-тест сверяет
*список* в `package.json`, `verify-packed.js` открывает настоящий `app.asar`
(так в 2.3.2 потерялся `design-tokens.css`); его парсер проверен на
**настоящем** `default_app.asar`.

## Ворота уязвимостей

Зачем: сборка 2.9.0 не прошла ПСИ по критическим уязвимостям Linux-версии.
Сканер приёмки читал `package-lock.json` и `sbom.json` — то же, что есть
здесь, поэтому CI проверяет это ДО релиза.

Порог везде один: **high и critical валят сборку**, ниже — предупреждение.
Dev-инструментарий включён намеренно: сканер приёмки не отличает dev от runtime.

`security`:

1. `npm audit --audit-level=high` — весь граф.
2. `security-gate.js sbom-sync` — `sbom.json` совпадает с lockfile по
   `name@version`. SBOM уходит в релиз; устаревший сообщает сканеру чужие версии.
   То же проверяет `tests/security-gate.test.js`, так что PR Dependabot без
   `npm run sbom` красный — намеренно.
3. OSV-Scanner (`google/osv-scanner-action`, закреплён по SHA) по lockfile и
   SBOM (копия под именем `sbom.cdx.json`: CycloneDX распознаётся только по
   имени). Отчёт JSON с `--all-packages`.
4. `security-gate.js osv` — решает по отчёту: max_severity ≥ 7.0 или без оценки
   — провал. Пустой отчёт или отчёт без обоих источников / без Electron —
   провал: пустота значит и «чисто», и «сканер ничего не прочёл».
5. `security-gate.js electron` — версия Electron в lockfile = в SBOM, и
   отставание от последнего патча своей мажорной линии: в CI предупреждение,
   в релизе (`--require-latest`) — провал.

Почему Electron — отдельная проверка. Chromium внутри одного бинаря, и ни
Syft/Grype, ни Trivy его не опознают (замер 25.09.2026: syft по
`linux-unpacked` — «No packages discovered», в том числе с каталогизаторами
образа). Сканерам Electron виден только как npm-пакет в lockfile/SBOM, а в OSV
по нему заведены лишь уязвимости самого Electron. CVE Chromium закрываются
патч-релизами Electron — поэтому «последний патч линии» и есть проверка на них.

`deb-scan`: распаковывает deb и `app.asar`; `security-gate.js electron
--binary` сверяет строку `Electron/X.Y.Z` в бинаре с lockfile/SBOM; syft строит
SBOM пакета (`--override-default-catalogers image`: по каталогу syft читает
только lock-файлы и находит 0 пакетов — так было в первом прогоне);
`security-gate.js artifact-sbom` требует в нём все runtime-зависимости; Grype
(`anchore/scan-action`, по SHA) сканирует этот SBOM с `severity-cutoff: high`.

Принятые находки: `osv-scanner.toml` и `.grype.yaml` — только с причиной и
сроком пересмотра. Сейчас их нет. Сначала — обновление или `overrides`.

`release.yml`: job `security` (те же шаги, Electron с `--require-latest`) —
`needs` у всех четырёх сборок; `build-linux` повторяет `deb-scan` на том
самом deb, что уходит в релиз.

## Установка и запуск deb

Проверки — `scripts/linux-launch-check.sh` (от root, запуск — от обычного
пользователя через `runuser`, `xvfb-run`, временный `--user-data-dir`):

- итог postinst: `chrome-sandbox` root:root и 0755 (userns) или 4755 (suid);
  на пути userns с `apparmor_restrict_unprivileged_userns=1` — профиль
  `/etc/apparmor.d/timer-widget` на месте и загружен в ядро;
- в журнале `<user-data-dir>/logs/main.log` за 90 с — `control window ready`,
  и через 15 с после этого браузерный процесс жив;
- ни у одного процесса приложения (ищутся по `/proc/<pid>/exe`) нет
  `--no-sandbox` и ключей, отключающих части песочницы; рендерер найден хотя бы
  один (иначе проверка отсутствия пуста);
- у каждого рендерера `Seccomp: 2`; путь **userns** — свой user namespace;
  путь **suid** — user namespace общий с браузером, PID namespace свой.

Какой путь проверяет какая ячейка:

| Ячейка | Настройка ядра | Путь песочницы |
|--------|----------------|----------------|
| runner `userns` | `kernel.apparmor_restrict_unprivileged_userns=1` | userns через профиль AppArmor из пакета (Ubuntu 24.04 по умолчанию) |
| runner `suid` | плюс `user.max_user_namespaces=0` | SUID-помощник на настоящем ядре с AppArmor |
| контейнеры | ядро раннера, restrict=1; в контейнере нет утилит AppArmor | SUID-помощник; `--privileged`, иначе в Docker песочница Chromium не поднимается никак |

Раннер набит библиотеками, контейнер — нет: контейнеры проверяют, что Depends
пакета хватает для ЗАПУСКА (ставятся только xvfb, xauth, dbus). Так найдено
отсутствие `libgbm1`/`libasound2` в штатном списке electron-builder, а затем —
что голое `libasound2` на Ubuntu 24.04 apt удовлетворяет OSS-заглушкой
`liboss4-salsa-asound2` без символов ALSA; отсюда `libasound2t64 | libasound2`.

Ячейка runner `userns` после запуска удаляет пакет и проверяет, что профиль
выгружен из ядра и удалён, а `/usr/bin/timer-widget` исчез.

## Dependabot

`.github/dependabot.yml`: npm и github-actions раз в неделю. Патчи и миноры
Electron — своя группа (Chromium-исправления; 44.1.1 отставал на три патча),
остальной dev-инструментарий — одна группа, мажоры — отдельными PR.

## Сторонние actions

Закреплены по полному SHA с комментарием версии: `google/osv-scanner-action`,
`anchore/scan-action`, `anchore/sbom-action/download-syft`. Второй сканер
артефакта (Trivy) не добавлен: Electron по бинарю он не опознаёт так же, как
Grype, а npm-пакеты `app.asar` уже в SBOM. Обновляет SHA Dependabot.
Образ OSV-Scanner action берёт по тегу (`ghcr.io/google/osv-scanner-action:v2.6.0`)
— это закрепляет SHA самого action, не digest образа.
