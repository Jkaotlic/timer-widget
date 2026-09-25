#!/bin/bash
# Установленный deb: итог postinst + ЗАПУСК приложения с живой песочницей.
#
# scripts/verify-linux-sandbox.js читает пакет, то есть НАМЕРЕНИЕ. Здесь —
# результат на настоящей системе: какой режим postinst выбрал для
# chrome-sandbox, поднимается ли приложение без `--no-sandbox` у обычного
# пользователя и действительно ли его рендереры сидят в песочнице.
#
# Запускается ОТ ROOT (читает /proc/<pid>/ns и environ чужих процессов:
# процессы песочницы недампируемы) после `apt-get install ./TimerWidget-*.deb`.
#
#   --expect userns   основной путь: user namespaces, на Ubuntu 24.04 — через
#                     профиль AppArmor из пакета; chrome-sandbox 0755;
#   --expect suid     запасной: ядро закрывает userns пользователю,
#                     chrome-sandbox 4755 root.
#
# Окружение: APP_USER — обычный пользователь для запуска (обязателен, root
# запускать Chromium без --no-sandbox не даёт вовсе); ALIVE_SECONDS — сколько
# приложение обязано прожить после готовности (по умолчанию 15).
set -u

EXPECT=""
while [ $# -gt 0 ]; do
    case "$1" in
        --expect) EXPECT="$2"; shift 2 ;;
        *) echo "неизвестный аргумент: $1"; exit 2 ;;
    esac
done
case "$EXPECT" in userns|suid) ;; *) echo "нужен --expect userns|suid"; exit 2 ;; esac
: "${APP_USER:?нужен APP_USER — обычный пользователь для запуска}"
ALIVE_SECONDS="${ALIVE_SECONDS:-15}"

APP_DIR=/opt/TimerWidget
EXE=timer-widget
SANDBOX="$APP_DIR/chrome-sandbox"
FAILS=0
fail() { echo "::error::$*"; FAILS=$((FAILS + 1)); }
ok() { echo "[launch] OK: $*"; }

echo "== ядро и AppArmor =="
for f in /proc/sys/kernel/unprivileged_userns_clone /proc/sys/user/max_user_namespaces \
         /proc/sys/kernel/apparmor_restrict_unprivileged_userns /sys/module/apparmor/parameters/enabled; do
    printf '  %-58s %s\n' "$f" "$(cat "$f" 2>/dev/null || echo '(нет)')"
done
printf '  %-58s %s\n' 'uname -r' "$(uname -r)"
printf '  %-58s %s\n' '/etc/os-release' "$(. /etc/os-release && echo "$PRETTY_NAME")"

echo "== итог postinst =="
[ -x "$APP_DIR/$EXE" ] || fail "нет $APP_DIR/$EXE — пакет не установлен"
[ -e "/usr/bin/$EXE" ] || fail "нет /usr/bin/$EXE"
MODE=$(stat -c '%a' "$SANDBOX")
OWNER=$(stat -c '%U:%G' "$SANDBOX")
echo "  chrome-sandbox: mode=$MODE owner=$OWNER"
[ "$OWNER" = "root:root" ] || fail "владелец chrome-sandbox $OWNER, ожидался root:root"
if [ "$EXPECT" = suid ]; then
    [ "$MODE" = 4755 ] && ok "SUID-помощник 4755 — userns пользователю закрыты" \
        || fail "userns закрыты, а chrome-sandbox $MODE вместо 4755 — приложение не стартует"
else
    [ "$MODE" = 755 ] && ok "chrome-sandbox без SUID (0755) — лишнего SUID-бинаря нет" \
        || fail "userns доступны, а chrome-sandbox $MODE вместо 0755 — лишний SUID-бинарь"
fi

PROFILE=/etc/apparmor.d/$EXE
RESTRICT=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
if [ "$EXPECT" = userns ] && [ "$RESTRICT" = 1 ]; then
    # Ubuntu 24.04: без профиля userns приложению закрыты — профиль обязан
    # стоять и быть ЗАГРУЖЕН в ядро, файла на диске мало.
    [ -f "$PROFILE" ] && ok "профиль AppArmor $PROFILE на месте" || fail "нет профиля $PROFILE"
    if grep -q "^$EXE " /sys/kernel/security/apparmor/profiles 2>/dev/null; then
        ok "профиль загружен: $(grep "^$EXE " /sys/kernel/security/apparmor/profiles)"
    else
        fail "профиль $EXE не загружен в ядро"
    fi
else
    echo "  профиль AppArmor: $( [ -f "$PROFILE" ] && echo "есть" || echo "нет") (для этого пути не обязателен)"
fi

echo "== запуск от $APP_USER без --no-sandbox =="
UDD=$(runuser -u "$APP_USER" -- mktemp -d /tmp/tw-profile.XXXXXX)
OUT=$(mktemp /tmp/tw-out.XXXXXX)
chmod 666 "$OUT"
LOG="$UDD/logs/main.log"
# dbus-run-session — если есть: без шины сессии Chromium только ворчит в лог.
DBUS=""
command -v dbus-run-session >/dev/null 2>&1 && DBUS="dbus-run-session --"
runuser -u "$APP_USER" -- env -u ELECTRON_RUN_AS_NODE HOME="$(getent passwd "$APP_USER" | cut -d: -f6)" \
    $DBUS xvfb-run -a -s '-screen 0 1920x1080x24' "/usr/bin/$EXE" "--user-data-dir=$UDD" >"$OUT" 2>&1 &
LAUNCHER=$!

READY=0
for _ in $(seq 1 90); do
    if grep -q 'control window ready' "$LOG" 2>/dev/null; then READY=1; break; fi
    kill -0 "$LAUNCHER" 2>/dev/null || break
    sleep 1
done
if [ "$READY" = 1 ]; then
    ok "в журнале: $(grep -m1 'control window ready' "$LOG")"
else
    fail "за 90 с нет 'control window ready' в $LOG"
fi

# Процессы приложения ищутся по /proc/<pid>/exe, а не по командной строке:
# браузер запущен через /usr/bin (ссылка alternatives), дети — через
# /proc/self/exe, и argv[0] у них разный.
app_pids() {
    for d in /proc/[0-9]*; do
        case "$(readlink "$d/exe" 2>/dev/null)" in "$APP_DIR"/*) echo "${d#/proc/}" ;; esac
    done
}
main_pid() {
    for p in $(app_pids); do
        [ "$(readlink "/proc/$p/exe")" = "$APP_DIR/$EXE" ] || continue
        tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q -- '--type=' || { echo "$p"; return; }
    done
}

if [ "$READY" = 1 ]; then
    sleep "$ALIVE_SECONDS"
    MAIN=$(main_pid)
    if [ -n "$MAIN" ] && kill -0 "$MAIN" 2>/dev/null; then
        ok "приложение живо через ${ALIVE_SECONDS} с после готовности (pid $MAIN)"
    else
        fail "приложение умерло в течение ${ALIVE_SECONDS} с после готовности"
    fi

    echo "== процессы приложения =="
    ALL=$(app_pids)
    RENDERERS=""
    for p in $ALL; do
        CMD=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null) || continue
        TYPE=$(echo "$CMD" | grep -o -- '--type=[a-z-]*' | head -1)
        SECCOMP=$(awk '/^Seccomp:/{print $2}' "/proc/$p/status" 2>/dev/null)
        echo "  pid=$p ${TYPE:-browser} seccomp=$SECCOMP user_ns=$(readlink "/proc/$p/ns/user") pid_ns=$(readlink "/proc/$p/ns/pid")"
        case "$CMD" in *--no-sandbox*) fail "pid $p запущен с --no-sandbox: $CMD" ;; esac
        case "$CMD" in *--disable-seccomp-filter-sandbox*|*--disable-namespace-sandbox*|*--disable-setuid-sandbox*)
            fail "pid $p отключает часть песочницы: $CMD" ;; esac
        [ "$TYPE" = "--type=renderer" ] && RENDERERS="$RENDERERS $p"
    done
    # Проверка «нет --no-sandbox» пуста, если процессов не нашлось вовсе —
    # отсутствие утверждается только на непустом наборе.
    [ -n "$RENDERERS" ] || fail "не найдено ни одного рендерера — проверять песочницу не на чем"

    MAIN_USERNS=$(readlink "/proc/$MAIN/ns/user")
    MAIN_PIDNS=$(readlink "/proc/$MAIN/ns/pid")
    for r in $RENDERERS; do
        SECCOMP=$(awk '/^Seccomp:/{print $2}' "/proc/$r/status")
        [ "$SECCOMP" = 2 ] && ok "рендерер $r под seccomp-bpf" || fail "рендерер $r без seccomp-фильтра (Seccomp: $SECCOMP)"
        R_USERNS=$(readlink "/proc/$r/ns/user")
        R_PIDNS=$(readlink "/proc/$r/ns/pid")
        SBX=$(tr '\0' '\n' < "/proc/$r/environ" 2>/dev/null | grep -c '^SBX_' || true)
        echo "  рендерер $r: переменных SBX_* (метка SUID-помощника) — $SBX"
        if [ "$EXPECT" = userns ]; then
            [ "$R_USERNS" != "$MAIN_USERNS" ] && ok "рендерер $r в своём user namespace — путь userns" \
                || fail "рендерер $r в user namespace браузера — userns-песочница не поднялась"
        else
            [ "$R_PIDNS" != "$MAIN_PIDNS" ] && ok "рендерер $r в своём PID namespace" \
                || fail "рендерер $r в PID namespace браузера — песочницы нет"
            [ "$R_USERNS" = "$MAIN_USERNS" ] && ok "user namespace общий с браузером — работает SUID-помощник" \
                || fail "рендерер $r в своём user namespace — ожидался путь SUID, а сработал userns"
        fi
    done
fi

if [ "$FAILS" -gt 0 ] || [ "$READY" != 1 ]; then
    echo "== вывод приложения =="; cat "$OUT"
    echo "== журнал $LOG =="; cat "$LOG" 2>/dev/null || echo "(нет журнала)"
fi

for p in $(app_pids); do kill "$p" 2>/dev/null || true; done
kill "$LAUNCHER" 2>/dev/null || true
wait "$LAUNCHER" 2>/dev/null || true

if [ "$FAILS" -gt 0 ]; then
    echo "[launch] ПРОВАЛ: $FAILS"
    exit 1
fi
echo "[launch] OK: путь $EXPECT — приложение поднялось в песочнице и живо"
