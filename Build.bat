@echo off
title NoteForge Builder
cd /d "%~dp0"

echo ============================================
echo   NoteForge — Build Windows Installer
echo ============================================
echo.

:: Prevent code signing (no certificate)
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=

:: Clear corrupted signing cache if it exists
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    echo Clearing signing cache...
    rd /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Download from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/3] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (echo [ERROR] npm install failed. & pause & exit /b 1)
) else (
    echo [1/3] Dependencies OK.
)
echo.

echo [2/3] Compiling JSX...
call npx babel app.jsx --out-file app.js --presets=@babel/preset-react
if %errorlevel% neq 0 (echo [ERROR] JSX compile failed. & pause & exit /b 1)
echo.

echo [3/3] Building installer and portable exe...
call npx electron-builder --win
if %errorlevel% neq 0 (echo [ERROR] Build failed. & pause & exit /b 1)
echo.

echo ============================================
echo   Build complete!
echo.
echo   Look in the dist\ folder for:
echo     - NoteForge Setup x.x.x.exe  (installer)
echo     - NoteForge-x.x.x-portable.exe
echo ============================================
echo.

set /p open="Open dist folder? (Y/N): "
if /i "%open%"=="Y" explorer "dist"
pause
