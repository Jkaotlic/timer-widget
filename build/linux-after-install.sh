#!/bin/bash
# postinst deb-пакета. Основа — штатный шаблон electron-builder
# (templates/linux/after-install.tpl); ${executable} и ${sanitizedProductName}
# подставляет сам electron-builder при сборке.
#
# Песочнице Chromium нужен один из двух механизмов:
#   1) непривилегированные user namespaces в ядре — с Ubuntu 24.04 их для
#      приложений ограничивает AppArmor, поэтому ставится профиль с `userns,`;
#   2) вспомогательный chrome-sandbox с SUID-битом и владельцем root.
#
# SUID-root — ТОЛЬКО запасной путь для ядер, где user namespaces нет вовсе:
# лишний SUID-бинарник в системе — поверхность атаки, которую ПСИ помечает сам
# по себе. `--no-sandbox` не используется ни в одной цели (AppImage убран ровно
# поэтому): песочница либо работает, либо приложение не стартует.
#
# Владелец root задаётся явно: fpm может собирать пакет от обычного
# пользователя, и тогда SUID-бит без смены владельца ничего не даёт.

APP_DIR='/opt/${sanitizedProductName}'
SANDBOX="$APP_DIR/chrome-sandbox"

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' "$APP_DIR/${executable}" 100 || ln -sf "$APP_DIR/${executable}" '/usr/bin/${executable}'
else
    ln -sf "$APP_DIR/${executable}" '/usr/bin/${executable}'
fi

if [ -e "$SANDBOX" ]; then
    chown root:root "$SANDBOX" || true
    if { [[ -L /proc/self/ns/user ]] && unshare --user true; } 2>/dev/null; then
        chmod 0755 "$SANDBOX" || true
    else
        chmod 4755 "$SANDBOX" || true
    fi
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Профиль AppArmor (Ubuntu 24.04+). Пробная загрузка без ядра отсеивает старый
# AppArmor без abi/4.0 (Ubuntu 22.04) — там профиль и не нужен.
if apparmor_status --enabled > /dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE="$APP_DIR/resources/apparmor-profile"
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
    if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
        cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
        # В chroot (сборка образов) живая загрузка профиля бессмысленна.
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" || true
        fi
    else
        echo "Skipping the AppArmor profile: this AppArmor does not support the bundled profile"
    fi
fi

exit 0
