# 02 — security

**Date:** 2026-04-20
**Status:** completed
**Tool used:** grep + manual code review

## Summary

- Total findings: 2
- critical: 0, high: 0, medium: 1, low: 1

## Findings

### F-001: [MEDIUM] innerHTML с template literal в showKeyboardShortcuts overlay

- **Location:** `electron-control.html:6081-6110` (showKeyboardShortcuts function)
- **Category:** security / XSS / Code Injection
- **Tool:** manual review
- **Context:**
  ```javascript
  const shortcuts = `
      <div style="background: white; padding: 20px; border-radius: 10px; max-width: 400px;">
          <h3 style="margin-top: 0; color: #333;">⌨️ Горячие клавиши</h3>
          ...
          <button onclick="this.parentElement.parentElement.remove()"
      `;
  overlay.innerHTML = shortcuts;
  ```
- **Details:** Текущий код содержит только статический HTML без user input — текущего риска нет. Однако паттерн `innerHTML` с template literal — антипаттерн defense-in-depth. Если в будущем добавится динамический контент, это станет XSS вектором.
- **Proposed fix:** Заменить на DOM API (createElement / textContent) или заменить на `insertAdjacentHTML` с явной документацией безопасности. Inline `onclick` → `addEventListener`.
- **Size estimate:** small
- **Auto-fixable:** no

---

### F-002: [LOW] window.SecurityUtils экспортируется напрямую, а не через contextBridge

- **Location:** `security.js:187-197`, `electron-control.html:3356-3358`
- **Category:** security / API exposure
- **Tool:** manual review
- **Context:**
  ```javascript
  // security.js
  if (typeof window !== 'undefined') {
      window.SecurityUtils = { isValidDataURL, isValidURL, validateImageSource, ... };
  }
  ```
- **Details:** Объект `window.SecurityUtils` exposed глобально, не через contextBridge. Так как security.js загружается в renderer контексте (не main), а утилиты безопасны — практический риск низкий. Но обходит контекст-изоляцию по дизайну.
- **Proposed fix:** Перенести SecurityUtils в preload.js через `contextBridge.exposeInMainWorld('securityUtils', {...})` для консистентности. Опционально.
- **Size estimate:** small
- **Auto-fixable:** no

---

## Good Security Practices Found
- contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false — везде
- CSP корректно настроен в HTML
- setWindowOpenHandler() блокирует все window.open
- IPC channel whitelist через preload + channel-validator
- Number.isFinite() для всех numeric IPC inputs
- Нет eval(), Function(), exec()
- escapeHTML утилита существует
- after-pack.js / linux-after-install.sh / nsis-include.nsh — без shell-injection
