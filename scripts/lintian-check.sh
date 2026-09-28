#!/bin/bash
# lintian по собранному deb — тот же инструмент, которым пакет проверяет
# приёмка (ПСИ 28.09.2026: нет copyright, пустой synopsis, Section: default,
# Recommends на несуществующий пакет). Один скрипт на CI (nodejs.yml,
# linux-sandbox) и релиз (release.yml, build-linux): скопированное тело шага
# расходится при первой правке.
#
# Валит только error; warning печатается. Теги, неустранимые для Electron, —
# в build/lintian-overrides (ставится в пакет), каждый с причиной;
# --show-overrides показывает, какие сработали.
#
#   bash scripts/lintian-check.sh dist/TimerWidget-X.Y.Z-amd64.deb
set -u

DEB="${1:?нужен путь к deb}"
[ -f "$DEB" ] || { echo "::error::нет файла $DEB"; exit 2; }

if ! command -v lintian >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lintian
fi
lintian --version
echo "[lintian] пакет: $DEB"

lintian --fail-on error --info --show-overrides --no-tag-display-limit "$DEB"
RC=$?
echo "[lintian] exit=$RC"
exit "$RC"
