@echo off
title NoteForge Builder
cd /d "%~dp0"

echo ============================================
echo   NoteForge — Build
echo ============================================
echo.
echo   RECOMMENDED: Push a git tag to build the
echo   installer via GitHub Actions:
echo.
echo     git tag v2.5.2
echo     git push origin v2.5.2
echo.
echo   The installer will appear on the Releases
echo   page automatically.
echo ============================================
echo.

set CSC_IDENTITY_AUTO_DISCOVERY=false

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Download from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (echo [ERROR] npm install failed. & pause & exit /b 1)
)
echo.

echo Compiling JSX...
call npx babel app.jsx --out-file app.js --presets=@babel/preset-react
if %errorlevel% neq 0 (echo [ERROR] JSX compile failed. & pause & exit /b 1)
echo.

echo Building installer (requires Developer Mode or Admin)...
echo   Enable Developer Mode: Settings -^> System -^> For developers
echo.

:: Clear corrupted signing cache
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    rd /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
)

call npx electron-builder --win
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   Local build failed.
    echo.
    echo   This usually means Developer Mode is not
    echo   enabled. You have two options:
    echo.
    echo   1. Enable Developer Mode in Windows:
    echo      Settings -^> System -^> For developers
    echo      Then run Build.bat again.
    echo.
    echo   2. Use GitHub Actions instead (recommended):
    echo      git tag v2.5.2
    echo      git push origin v2.5.2
    echo ============================================
    pause
    exit /b 1
)
echo.

echo ============================================
echo   Build complete!
echo   Output: dist\
echo ============================================
set /p open="Open dist folder? (Y/N): "
if /i "%open%"=="Y" explorer "dist"
pause
