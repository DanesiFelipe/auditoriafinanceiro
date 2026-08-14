@echo off
title Trinus Audit v2
chcp 65001 > nul
cls

echo ================================================
echo   Trinus Audit v2 — Inicializando...
echo ================================================
echo.

cd /d "%~dp0"

:: Verificar se node está instalado
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado!
    echo Instale em: https://nodejs.org
    pause
    exit /b 1
)

:: Instalar dependencias se necessario
if not exist "node_modules" (
    echo [INFO] Instalando dependencias...
    npm install
    echo.
)

:: Abrir navegador apos 2 segundos
start "" /b cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000"

:: Iniciar servidor
echo [INFO] Iniciando servidor Node.js...
echo [INFO] Acesse: http://127.0.0.1:5000
echo.
echo Pressione CTRL+C para encerrar.
echo.
node server.js

pause
