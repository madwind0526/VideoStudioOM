@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Ports are allocated centrally in C:\Claude\PORTS.md (VideoStudioOM: backend 4314, dev UI 5184).
rem Default: build the app and serve it from the API port (this is what Tailscale should point at).
rem "start.bat dev": run the API with auto-restart and the Vite dev server with hot reload.
set "API_PORT=4314"
set "WEB_PORT=5184"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=prod"
rem "start.bat prod nopause" skips the final pause (for automation).
set "NOPAUSE=%~2"

echo Checking for an existing VideoStudioOM server on ports %API_PORT%/%WEB_PORT%...
for %%R in (%API_PORT% %WEB_PORT%) do (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%%R " ^| findstr "LISTENING"') do (
        echo Found existing process on port %%R ^(PID %%P^) - stopping it...
        taskkill /F /PID %%P >nul 2>&1
    )
)

rem Child node processes can outlive the cmd window that started them; match them by window title.
taskkill /F /IM node.exe /FI "WINDOWTITLE eq VideoStudioOM*" >nul 2>&1

rem Wait for the ports to actually free up instead of assuming the kill worked.
for /l %%I in (1,1,20) do (
    netstat -ano | findstr ":%API_PORT% :%WEB_PORT% " | findstr "LISTENING" >nul 2>&1 || goto :portsfree
    ping -n 2 127.0.0.1 >nul
)
:portsfree

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Install failed.
        if /i not "%NOPAUSE%"=="nopause" pause
        exit /b 1
    )
)

if /i "%MODE%"=="dev" (
    echo Starting VideoStudioOM in dev mode ^(API :%API_PORT%, UI :%WEB_PORT%^)...
    start "VideoStudioOM" /min cmd /c "npm run dev"
    echo Done. Open http://127.0.0.1:%WEB_PORT%
) else (
    echo Building VideoStudioOM...
    call npm run build
    if errorlevel 1 (
        echo Build failed.
        if /i not "%NOPAUSE%"=="nopause" pause
        exit /b 1
    )
    echo Starting VideoStudioOM ^(http://127.0.0.1:%API_PORT%^)...
    start "VideoStudioOM" /min cmd /c "npm start"
    echo Done. Open http://127.0.0.1:%API_PORT%
)

if /i not "%NOPAUSE%"=="nopause" pause
