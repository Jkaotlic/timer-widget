#!/bin/bash
# postrm deb-пакета. Основа — штатный шаблон electron-builder
# (templates/linux/after-remove.tpl): ссылка в /usr/bin и профиль AppArmor.
# Подключается через `deb.afterRemove`, а не сырым `--after-remove` в fpm —
# иначе штатная часть терялась и профиль оставался в /etc/apparmor.d.
#
# Домашние каталоги пакет не трогает ни на remove, ни на purge: настройки
# (~/.config/timer-widget, ~/.cache/timer-widget) — данные пользователя, а не
# файлы пакета: dpkg ими не владеет. До 2.12 purge ходил от root по /home/*
# и удалял их у всех — на ПСИ 28.09.2026 это признано недопустимым: root-скрипт
# по путям, которыми владеют пользователи, — поверхность атаки даже со сторожем
# симлинков. Как убрать настройки руками — docs/UNINSTALL.md.

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
    if apparmor_status --enabled > /dev/null 2>&1; then
        if ! { command -v ischroot >/dev/null 2>&1 && ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
        fi
    fi
    rm -f "$APPARMOR_PROFILE_DEST"
fi

exit 0
