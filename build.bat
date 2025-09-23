@echo off
REM SubCaster Build Script for Windows
REM Builds both web and desktop versions

setlocal enabledelayedexpansion

echo 🚀 SubCaster Build Script
echo =========================

REM Check if npm is available
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm is not installed. Please install Node.js and npm first.
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        exit /b 1
    )
    echo [SUCCESS] Dependencies installed
)

REM Build target (default: all)
set BUILD_TARGET=%1
if "%BUILD_TARGET%"=="" set BUILD_TARGET=all

if "%BUILD_TARGET%"=="web" goto build_web
if "%BUILD_TARGET%"=="desktop" goto build_desktop
if "%BUILD_TARGET%"=="win" goto build_win
if "%BUILD_TARGET%"=="mac" goto build_mac
if "%BUILD_TARGET%"=="linux" goto build_linux
if "%BUILD_TARGET%"=="all" goto build_all
if "%BUILD_TARGET%"=="dev" goto dev_mode
if "%BUILD_TARGET%"=="clean" goto clean
goto usage

:build_web
echo [INFO] Building Web-App...
call npm run build:web
if errorlevel 1 (
    echo [ERROR] Web build failed
    exit /b 1
)
echo [SUCCESS] Web-App built successfully!
echo [INFO] Output: dist/
goto end

:build_desktop
echo [INFO] Building Desktop-App...
call npm run build:desktop
if errorlevel 1 (
    echo [ERROR] Desktop build failed
    exit /b 1
)
echo [SUCCESS] Desktop-App built successfully!
echo [INFO] Output: dist-electron/
goto end

:build_win
echo [INFO] Building Desktop-App for Windows...
call npm run build:desktop:win
if errorlevel 1 (
    echo [ERROR] Windows build failed
    exit /b 1
)
echo [SUCCESS] Windows Desktop-App built successfully!
goto end

:build_mac
echo [INFO] Building Desktop-App for macOS...
call npm run build:desktop:mac
if errorlevel 1 (
    echo [ERROR] macOS build failed
    exit /b 1
)
echo [SUCCESS] macOS Desktop-App built successfully!
goto end

:build_linux
echo [INFO] Building Desktop-App for Linux...
call npm run build:desktop:linux
if errorlevel 1 (
    echo [ERROR] Linux build failed
    exit /b 1
)
echo [SUCCESS] Linux Desktop-App built successfully!
goto end

:build_all
echo [INFO] Building Web-App...
call npm run build:web
if errorlevel 1 (
    echo [ERROR] Web build failed
    exit /b 1
)
echo [SUCCESS] Web-App built successfully!

echo [INFO] Building Desktop-App...
call npm run build:desktop
if errorlevel 1 (
    echo [ERROR] Desktop build failed
    exit /b 1
)
echo [SUCCESS] Desktop-App built successfully!

echo [SUCCESS] All builds completed!
echo [INFO] Web output: dist/
echo [INFO] Desktop output: dist-electron/
goto end

:dev_mode
echo [INFO] Starting development mode...
echo [WARNING] This will start both web dev server and Electron
call npm run electron:dev
goto end

:clean
echo [INFO] Cleaning build outputs...
if exist "dist" rmdir /s /q "dist"
if exist "dist-electron" rmdir /s /q "dist-electron"
echo [SUCCESS] Build outputs cleaned
goto end

:usage
echo Usage: %0 [web^|desktop^|win^|mac^|linux^|all^|dev^|clean]
echo.
echo Options:
echo   web      - Build web app only
echo   desktop  - Build desktop app for current platform
echo   win      - Build desktop app for Windows
echo   mac      - Build desktop app for macOS
echo   linux    - Build desktop app for Linux
echo   all      - Build both web and desktop apps (default)
echo   dev      - Start development mode
echo   clean    - Clean build outputs
exit /b 1

:end
echo.
echo [SUCCESS] Build process completed!

REM Show build info
if exist "dist" (
    echo [INFO] Web build created in dist/
)
if exist "dist-electron" (
    echo [INFO] Desktop build created in dist-electron/
)