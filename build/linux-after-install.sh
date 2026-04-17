#!/bin/bash
# Ensure chrome-sandbox has safe 0755 permissions without SUID.
# Electron falls back to user namespaces when SUID is absent.
SANDBOX="/opt/TimerWidget/chrome-sandbox"
if [ -e "$SANDBOX" ]; then
    chmod 0755 "$SANDBOX" || true
fi
exit 0
