#!/bin/bash
# Called by dpkg on remove/purge.
# On purge ($1 == "purge"), remove user config directories for all users.
# On simple remove, leave user data intact — allows clean re-install preserving settings.

set -e

if [ "$1" = "purge" ]; then
    for userdir in /home/*; do
        if [ -d "$userdir/.config/timer-widget" ]; then
            rm -rf "$userdir/.config/timer-widget" || true
        fi
        if [ -d "$userdir/.cache/timer-widget" ]; then
            rm -rf "$userdir/.cache/timer-widget" || true
        fi
    done
    if [ -d "/root/.config/timer-widget" ]; then
        rm -rf "/root/.config/timer-widget" || true
    fi
fi

exit 0
