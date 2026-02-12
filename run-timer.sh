#!/bin/bash
# ─────────────────────────────────────────────
# Timer Widget — запуск и проверка (macOS)
# ─────────────────────────────────────────────
set -e

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ok()     { echo -e "  ${GREEN}✔${NC} $1"; }
fail()   { echo -e "  ${RED}✘${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }

# ── Меню ──
show_help() {
    echo -e "${BOLD}Timer Widget — утилита запуска${NC}"
    echo ""
    echo "Использование: ./run-timer.sh [команда]"
    echo ""
    echo "  ${CYAN}start${NC}     Запустить приложение"
    echo "  ${CYAN}dev${NC}       Запустить в dev-режиме"
    echo "  ${CYAN}test${NC}      Прогнать тесты"
    echo "  ${CYAN}check${NC}     Полная проверка (lint + тесты)"
    echo "  ${CYAN}build${NC}     Собрать .dmg для macOS"
    echo "  ${CYAN}clean${NC}     Очистить node_modules и dist"
    echo "  ${CYAN}status${NC}    Показать состояние проекта"
    echo ""
    echo "Без аргументов — интерактивный выбор."
}

# ── Проверка зависимостей ──
ensure_deps() {
    if [ ! -d "node_modules" ]; then
        header "Установка зависимостей"
        npm install
        ok "node_modules установлены"
    fi
}

# ── Проверка окружения ──
check_env() {
    header "Проверка окружения"

    if command -v node &>/dev/null; then
        ok "Node.js $(node -v)"
    else
        fail "Node.js не найден"; exit 1
    fi

    if command -v npm &>/dev/null; then
        ok "npm $(npm -v)"
    else
        fail "npm не найден"; exit 1
    fi

    if [ -f "package.json" ]; then
        ok "package.json найден"
    else
        fail "package.json не найден — запустите из корня проекта"; exit 1
    fi

    if [ -f "electron-main.js" ]; then
        ok "electron-main.js найден"
    else
        fail "electron-main.js не найден"; exit 1
    fi
}

# ── Статус проекта ──
cmd_status() {
    check_env

    header "Состояние проекта"

    local version
    version=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
    ok "Версия: ${BOLD}$version${NC}"

    local file_count
    file_count=$(find . -maxdepth 1 -name '*.js' -o -name '*.html' -o -name '*.css' | wc -l | tr -d ' ')
    ok "Исходных файлов: $file_count"

    local test_count
    test_count=$(find tests -name '*.test.js' 2>/dev/null | wc -l | tr -d ' ')
    ok "Тестовых файлов: $test_count"

    if [ -d "node_modules" ]; then
        ok "node_modules: установлены"
    else
        warn "node_modules: отсутствуют (запустите install)"
    fi

    if [ -d "dist" ]; then
        local builds
        builds=$(ls dist/*.dmg dist/*.zip 2>/dev/null | wc -l | tr -d ' ')
        ok "Сборки в dist/: $builds файл(ов)"
    else
        warn "dist/: нет сборок"
    fi

    if command -v git &>/dev/null && [ -d ".git" ]; then
        local branch
        branch=$(git branch --show-current 2>/dev/null)
        local dirty
        dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        if [ "$dirty" -eq 0 ]; then
            ok "Git: ветка ${BOLD}$branch${NC}, чисто"
        else
            warn "Git: ветка ${BOLD}$branch${NC}, изменений: $dirty"
        fi
    fi
}

# ── Запуск ──
cmd_start() {
    check_env
    ensure_deps
    header "Запуск Timer Widget"
    npm start
}

cmd_dev() {
    check_env
    ensure_deps
    header "Запуск в dev-режиме"
    npm run dev
}

# ── Тесты ──
cmd_test() {
    check_env
    ensure_deps
    header "Запуск тестов"
    if npm test; then
        ok "Все тесты пройдены"
    else
        fail "Есть упавшие тесты"
        exit 1
    fi
}

# ── Полная проверка ──
cmd_check() {
    check_env
    ensure_deps

    local errors=0

    header "Синтаксическая проверка JS"
    local js_files
    js_files=$(find . -maxdepth 1 -name '*.js' ! -name '*.test.js')
    for f in $js_files; do
        if node -c "$f" 2>/dev/null; then
            ok "$(basename "$f")"
        else
            fail "$(basename "$f") — синтаксическая ошибка"
            errors=$((errors + 1))
        fi
    done

    header "Проверка HTML"
    local html_files
    html_files=$(find . -maxdepth 1 -name '*.html')
    for f in $html_files; do
        if [ -s "$f" ]; then
            ok "$(basename "$f") ($(wc -l < "$f" | tr -d ' ') строк)"
        else
            fail "$(basename "$f") — пустой файл"
            errors=$((errors + 1))
        fi
    done

    header "ESLint"
    if npx eslint . --ext .js --max-warnings 0 2>/dev/null; then
        ok "Без ошибок и предупреждений"
    else
        warn "Есть предупреждения ESLint (не критично)"
    fi

    header "Тесты"
    if npm test 2>&1; then
        ok "Все тесты пройдены"
    else
        fail "Есть упавшие тесты"
        errors=$((errors + 1))
    fi

    echo ""
    if [ "$errors" -eq 0 ]; then
        echo -e "${GREEN}${BOLD}✔ Все проверки пройдены!${NC}"
    else
        echo -e "${RED}${BOLD}✘ Ошибок: $errors${NC}"
        exit 1
    fi
}

# ── Сборка ──
cmd_build() {
    check_env
    ensure_deps
    header "Сборка macOS (.dmg)"
    npm run build:mac
    ok "Сборка завершена — смотри папку dist/"
}

# ── Очистка ──
cmd_clean() {
    header "Очистка"
    [ -d "node_modules" ] && rm -rf node_modules && ok "node_modules удалены"
    [ -d "dist" ] && rm -rf dist && ok "dist удалена"
    echo -e "${GREEN}Готово.${NC}"
}

# ── Интерактивный режим ──
interactive() {
    echo -e "${BOLD}Timer Widget${NC} v$(node -p "require('./package.json').version" 2>/dev/null || echo '?')"
    echo ""
    echo -e "  ${CYAN}1${NC}) Запуск"
    echo -e "  ${CYAN}2${NC}) Dev-режим"
    echo -e "  ${CYAN}3${NC}) Тесты"
    echo -e "  ${CYAN}4${NC}) Полная проверка (lint + тесты)"
    echo -e "  ${CYAN}5${NC}) Собрать .dmg"
    echo -e "  ${CYAN}6${NC}) Статус проекта"
    echo -e "  ${CYAN}7${NC}) Очистить"
    echo -e "  ${CYAN}0${NC}) Выход"
    echo ""
    read -rp "Выберите действие: " choice
    case $choice in
        1) cmd_start ;;
        2) cmd_dev ;;
        3) cmd_test ;;
        4) cmd_check ;;
        5) cmd_build ;;
        6) cmd_status ;;
        7) cmd_clean ;;
        0) exit 0 ;;
        *) echo "Неверный выбор"; exit 1 ;;
    esac
}

# ── Точка входа ──
case "${1:-}" in
    start)  cmd_start ;;
    dev)    cmd_dev ;;
    test)   cmd_test ;;
    check)  cmd_check ;;
    build)  cmd_build ;;
    clean)  cmd_clean ;;
    status) cmd_status ;;
    help|-h|--help) show_help ;;
    "") interactive ;;
    *) echo "Неизвестная команда: $1"; show_help; exit 1 ;;
esac
