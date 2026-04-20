# 11 — observability

**Date:** 2026-04-20
**Status:** completed
**Version:** 2.2.3
**Tool used:** grep / ast analysis / file inspection

## Summary

- Total findings: 3
- critical: 0, high: 1, medium: 2, low: 0

## Analysis Performed

### 1. Logging Infrastructure Check

**electron-log Status: CONFIGURED**
- Location: electron-main.js lines 7, 13-17
- Version: ^5.4.3 (package.json:122)
- Initialization: log.initialize() called
- File transport: 
  - Level: info
  - Max size: 10 MB with automatic rotation
  - Format: [{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}
- Console transport:
  - Level: debug in --dev mode, warn in production
  - Prevents console spam in production builds
- Log export: ipcMain.handle('export-logs') at line 1000 for bug reports

**Startup logging:** 
- Line 18: log.info() with version and platform information
- Line 37: Performance heap/RSS debug logging (dev-only, 60s interval)
- Lines 267, 311, 355, 405: Window ready timing measurements
- Line 595: App ready timing from startup

### 2. Error Handling & Crash Recovery

**Uncaught exceptions: HANDLED**
- Line 21-24: process.on('uncaughtException') catches and logs errors
- Saves timer state to file for recovery on line 23
- Log level: error

**Unhandled rejections: HANDLED**
- Line 25-28: process.on('unhandledRejection') catches promise rejections
- Log level: error

**Renderer process crashes: PARTIALLY HANDLED**
- Function bindRenderCrashHandler() at line 566-574
- Listens for render-process-gone events
- Logs reason and auto-reloads on non-clean exits
- **Finding F-001 (HIGH):** Only bound to controlWindow (line 593)
  - Widget window, display window, and clock widget windows do NOT have render crash handlers
  - This means renderer crashes in widget/display/clock are logged but windows won't auto-reload

### 3. Graceful Shutdown

**before-quit handler: PRESENT**
- Line 576: app.on('before-quit') sets isQuitting = true and clears saved state
- Ensures clean exit without dangling timers

**Timer cleanup: PRESENT**
- Function clearTimerInterval() at line 102-107
- Called on window-all-closed (line 605)
- Called on explicit quit IPC: quit-app (line 818), reset-and-relaunch (line 823)

**Window close interception: PRESENT**
- Function bindTrayBehavior() at line 555-563
- Prevents close to tray unless isQuitting flag set
- Only bound to controlWindow - other windows close directly

**Tray behavior: GRACEFUL**
- Line 549: Выход menu item sets isQuitting = true before app.quit()

**macOS app lifecycle: RESPECTED**
- Line 606-608: Platform check prevents quit on macOS (app stays in dock)

### 4. Console Usage in Renderer Processes

**display-script.js (renderer - fullscreen display window):**
- 6 instances of console.error() / console.warn()
- Line 84: console.warn() for localStorage quota check
- Line 91: console.error() for quota exceeded
- Lines 557, 578: console.error() for JSON parse errors
- Lines 851, 855: console.error() for background image security failures

**Finding F-002 (MEDIUM):** Renderer console calls don't flow to electron-log
- No electron-log preload or ipcRenderer bridge configured for renderer processes
- Console messages in display-script.js are lost from app logs
- These are legitimate error messages but only visible in DevTools, not in app logs
- Impact: Renderer-side JSON parse errors, security violations, and storage issues won't appear in debug logs

### 5. No Secrets in Logs

**Pattern scan:**
- log.(info|error|warn|debug).*(secret|password|token|api.*key|credentials)
- Result: No matches found
- All logged data: app state, timings, error messages - no sensitive data

### 6. Crash Reporter

**crashReporter status: NOT CONFIGURED**
- No crashReporter.start() call found in electron-main.js
- electron-log captures crash signals but native crash reporting is disabled
- For a desktop app, electron-log file logging is sufficient for diagnostics
- Native crash reporter not needed for offline-first timer app

### 7. Memory Monitoring (Dev-only)

**Heap monitoring: PRESENT**
- Lines 34-39: Dev-mode memory sampling (60s interval)
- Logs heap/RSS in MB format
- Helps identify memory leaks during development

## Findings

### F-001: Render crash handler not bound to widget/display/clock windows
- **Severity:** HIGH
- **Category:** Robustness
- **Location:** electron-main.js functions: createWidgetWindow(), createDisplayWindow(), createClockWidgetWindow()
- **Issue:** Only control window has bindRenderCrashHandler() callback. If widget, display, or clock window renderer crashes, the window will stay frozen instead of auto-reloading
- **Impact:** Widget/display windows in crashed state require app restart
- **Recommendation:** Call bindRenderCrashHandler() after creating widget/display/clock windows
- **Fix complexity:** Trivial (3 lines)

### F-002: Renderer console logs not captured in electron-log
- **Severity:** MEDIUM
- **Category:** Observability
- **Location:** display-script.js (6 console calls)
- **Issue:** Renderer processes have no logger bridge. Their console.error/warn calls are visible only in DevTools, not in app logs
- **Impact:** Debugging renderer-side issues requires DevTools; app logs are incomplete
- **Recommendation:** Add electron-log preload bridge or accept as limitation for offline timer app
- **Fix complexity:** Medium (20-40 lines of preload code)

### F-003: Incomplete render-process-gone handler coverage
- **Severity:** MEDIUM
- **Category:** Robustness
- **Location:** electron-main.js line 593 (only control window)
- **Issue:** Widget, display, and clock windows have no crash recovery
- **Recommendation:** Apply fix from F-001 to all four windows
- **Related to:** F-001

## Positive Findings

✓ electron-log properly initialized with file rotation (10 MB)
✓ Uncaught exceptions and unhandled rejections both logged
✓ Graceful shutdown flow with timer cleanup and state clearing
✓ No secrets found in logs or log statements
✓ Export-logs IPC available for user-initiated diagnostic reports
✓ Timer state recovery persisted every 10 seconds during runtime
✓ macOS app lifecycle respected
✓ Performance instrumentation with startup timing measurements

## Log File Locations (by platform)

- **Windows:** %APPDATA%/TimerWidget/logs/
- **macOS:** ~/Library/Logs/TimerWidget/
- **Linux:** ~/.config/TimerWidget/logs/

Log files rotate at 10 MB with date suffix.

## Conclusion

**Risk Level:** MEDIUM

The observability infrastructure is well-designed with proper error handling at the main process level. The two medium-severity gaps are: (1) Render process crashes in widget/display/clock windows don't auto-recover, (2) Renderer console logs aren't captured in the app log file.

For an offline timer application, these are acceptable limitations. The main process is hardened against crashes, and timer state is continuously saved.

