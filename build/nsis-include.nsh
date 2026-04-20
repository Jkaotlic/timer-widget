; Custom NSIS include for TimerWidget uninstaller
; Provides user choice to remove user settings (localStorage, cookies, cache)

!macro customUnInstall
    ; Ask user if they want to remove user data (default: No)
    MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также настройки пользователя (таймеры, цвета, звуки)?" /SD IDNO IDNO skip_userdata
    RMDir /r "$APPDATA\timer-widget"
    RMDir /r "$APPDATA\TimerWidget"
    RMDir /r "$LOCALAPPDATA\timer-widget"
    RMDir /r "$LOCALAPPDATA\TimerWidget"
    skip_userdata:
!macroend
