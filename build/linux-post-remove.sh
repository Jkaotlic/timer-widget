#!/bin/bash
# postrm deb-пакета. Основа — штатный шаблон electron-builder
# (templates/linux/after-remove.tpl): ссылка в /usr/bin и профиль AppArmor.
# Подключается через `deb.afterRemove`, а не сырым `--after-remove` в fpm —
# иначе штатная часть терялась и профиль оставался в /etc/apparmor.d.
#
# На purge ($1 == "purge") удаляются настройки всех пользователей; на обычном
# remove данные остаются — переустановка сохраняет настройки.

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
    if apparmor_status --enabled > /dev/null 2>&1; then
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
        fi
    fi
    rm -f "$APPARMOR_PROFILE_DEST"
fi

# Скрипт идёт от root по путям, которыми владеют пользователи. Симлинк на любом
# звене (`~/.config` → /etc) превратил бы `rm -rf` в удаление чужого каталога,
# поэтому каждое звено проверяется на -L и удаляется только настоящий каталог.
purge_dir() {
    local base="$1" sub="$2"
    [ -d "$base" ] && [ ! -L "$base" ] || return 0
    [ -d "$base/$sub" ] && [ ! -L "$base/$sub" ] || return 0
    [ -d "$base/$sub/timer-widget" ] && [ ! -L "$base/$sub/timer-widget" ] || return 0
    rm -rf --one-file-system "$base/$sub/timer-widget" || true
}

if [ "$1" = "purge" ]; then
    for userdir in /home/* /root; do
        purge_dir "$userdir" .config
        purge_dir "$userdir" .cache
    done
fi

exit 0
