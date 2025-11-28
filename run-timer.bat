@echo off
setlocal

rem Запуск dev-режима Electron таймера
if not exist node_modules (
  echo Устанавливаю зависимости...
  npm install
)

echo Запускаю npm start ...
npm start
