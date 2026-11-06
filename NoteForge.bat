@echo off
title NoteForge
cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm ci
    if %errorlevel% neq 0 (
        echo [ERROR] npm ci failed.
        pause
        exit /b 1
    )
    echo.
)

:: Launch
echo Starting NoteForge...
call npx electron .
