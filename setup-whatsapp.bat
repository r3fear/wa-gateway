@echo off
color 07
title wa-gateway - Panel de Control
cd /d "%~dp0"
set "SERVICE=wa-gateway"

:: ================================================================
:MENU
cls
echo.
echo  ============================================================
echo     wa-gateway  -  Panel de Control
echo  ============================================================
echo.
echo   SESION DE WHATSAPP
echo   ------------------------------------------------------------
echo    [1] Reconectar sesion         nueva autenticacion QR
echo    [2] Cerrar sesion              desvincular WhatsApp
echo.
echo   SERVICIO DE WINDOWS
echo   ------------------------------------------------------------
echo    [3] Instalar servicio          npm install + NSSM
echo    [4] Iniciar servicio
echo    [5] Detener servicio
echo    [6] Reiniciar servicio
echo.
echo   DIAGNOSTICO
echo   ------------------------------------------------------------
echo    [7] Test de WhatsApp           verificar y probar
echo.
echo   ------------------------------------------------------------
echo    [0] Salir
echo  ============================================================
echo.
set "OPCION="
set /p OPCION="   Selecciona una opcion [0-7]: "

if "%OPCION%"=="1" goto RECONECTAR
if "%OPCION%"=="2" goto CERRAR
if "%OPCION%"=="3" goto INSTALAR_SERVICIO
if "%OPCION%"=="4" goto INICIAR
if "%OPCION%"=="5" goto DETENER
if "%OPCION%"=="6" goto REINICIAR
if "%OPCION%"=="7" goto TEST
if "%OPCION%"=="0" goto SALIR

echo.
echo   Opcion invalida. Intenta de nuevo.
timeout /t 2 /nobreak >nul
goto MENU

:: ================================================================
:RECONECTAR
cls
echo.
echo  ============================================================
echo     Reconectar sesion WhatsApp
echo  ============================================================
echo.
echo   IMPORTANTE: wa-gateway debe estar detenido antes
echo   de continuar.
echo.
echo   Si usas NSSM:   nssm stop wa-gateway
echo   Si usas node:   cierra esa terminal manualmente
echo.
nssm stop %SERVICE% >nul 2>&1
echo   Presiona cualquier tecla cuando hayas detenido wa-gateway...
pause >nul
echo.
echo   Deteniendo procesos residuales...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM chrome.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul
echo.
echo   Iniciando configuracion de sesion...
echo.
node wa-login.js
echo.
echo  ============================================================
echo     Sesion configurada.
echo     Reinicia wa-gateway para continuar:
echo       nssm start %SERVICE%   o:   node wa-server.js
echo  ============================================================
echo.
pause
goto MENU

:: ================================================================
:CERRAR
cls
echo.
echo  ============================================================
echo     Cerrar sesion WhatsApp
echo  ============================================================
echo.
echo   Esta opcion desvincula WhatsApp de este equipo.
echo   wa-gateway quedara inactivo hasta que vuelvas a autenticar.
echo.
nssm stop %SERVICE% >nul 2>&1
set "CONFIRMAR="
set /p CONFIRMAR="   Confirmar cierre de sesion? [s/n]: "
if /i not "%CONFIRMAR%"=="s" (
    echo.
    echo   Operacion cancelada.
    timeout /t 2 /nobreak >nul
    goto MENU
)
echo.
taskkill /F /IM node.exe /T >nul 2>&1
node wa-logout.js
echo.
pause
goto MENU

:: ================================================================
:INSTALAR_SERVICIO
cls
echo.
echo  ============================================================
echo     Instalar como servicio de Windows (NSSM)
echo  ============================================================
echo.
echo   Verificando requisitos...
echo.

:: 1. Permisos de Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] Se requieren permisos de Administrador.
    echo       Cierra este bat y ejecutalo con clic derecho
    echo       "Ejecutar como administrador".
    goto FIN_INSTALAR
)
echo   [OK] Permisos de Administrador

:: 2. Node.js
set "NODE_EXE="
for /f "tokens=* delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
    echo   [!] Node.js no encontrado en PATH.
    echo       Descarga e instala desde: https://nodejs.org
    goto FIN_INSTALAR
)
echo   [OK] Node.js: %NODE_EXE%

:: 3. npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] npm no encontrado. Reinstala Node.js.
    goto FIN_INSTALAR
)
echo   [OK] npm

:: 4. NSSM
set "NSSM_EXE="
for /f "tokens=* delims=" %%i in ('where nssm 2^>nul') do (
    if not defined NSSM_EXE set "NSSM_EXE=%%i"
)
if not defined NSSM_EXE (
    echo   [!] NSSM no encontrado en PATH.
    echo       Descarga nssm.exe desde: https://nssm.cc/download
    echo       Copia nssm.exe a: C:\Windows\System32\
    goto FIN_INSTALAR
)
echo   [OK] NSSM: %NSSM_EXE%

:: 5. config.json
if not exist "%~dp0config.json" (
    echo   [!] config.json no encontrado.
    echo       Copia config.json.example a config.json y configura.
    goto FIN_INSTALAR
)
echo   [OK] config.json

:: 6. Chrome (ruta de config.json via PowerShell)
set "CHROME_PATH="
for /f "usebackq tokens=* delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Get-Content '%~dp0config.json' -Raw | ConvertFrom-Json).chrome_path } catch { '' }" 2^>nul`) do set "CHROME_PATH=%%i"
if defined CHROME_PATH (
    if exist "%CHROME_PATH%" (
        echo   [OK] Chrome: %CHROME_PATH%
    ) else (
        echo   [?] Chrome no encontrado en: %CHROME_PATH%
        echo       Actualiza chrome_path en config.json.
        echo       El servicio podria no conectar a WhatsApp.
    )
) else (
    echo   [?] No se pudo leer chrome_path desde config.json.
    echo       Verifica que chrome_path este definido en config.json.
)

:: 7. Servicio ya instalado?
nssm status %SERVICE% >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo   [!] El servicio "%SERVICE%" ya esta instalado.
    set "REINSTALAR="
    set /p REINSTALAR="   Deseas reinstalarlo? [s/n]: "
    if /i not "%REINSTALAR%"=="s" goto FIN_INSTALAR
    echo.
    echo   Removiendo servicio existente...
    nssm stop %SERVICE% >nul 2>&1
    nssm remove %SERVICE% confirm >nul 2>&1
)

:: 8. Preparar ruta de directorio (sin backslash final — evita problemas de quoting)
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

echo.
echo   Todas las verificaciones completadas.
echo   Procediendo con la instalacion...
echo.
pause

:: 9. npm install
echo.
echo   Instalando dependencias (npm install)...
call npm install --prefix "%APP_DIR%"
if %errorlevel% neq 0 (
    echo   [!] Error en npm install. Revisa la conexion a internet o los permisos.
    goto FIN_INSTALAR
)
echo   [OK] Dependencias instaladas.

:: 10. Crear carpeta logs
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
echo   [OK] Carpeta logs\ creada.

:: 11. Instalar y configurar servicio NSSM
echo.
echo   Instalando servicio NSSM...
nssm install %SERVICE% "%NODE_EXE%"
nssm set %SERVICE% AppParameters "%APP_DIR%\wa-server.js"
nssm set %SERVICE% AppDirectory "%APP_DIR%"
nssm set %SERVICE% AppStdout "%APP_DIR%\logs\wa-gateway.log"
nssm set %SERVICE% AppStderr "%APP_DIR%\logs\wa-gateway.log"
nssm set %SERVICE% AppRotateFiles 1
nssm set %SERVICE% Start SERVICE_AUTO_START
echo   [OK] Servicio configurado.

echo.
echo   Iniciando servicio...
nssm start %SERVICE%
if %errorlevel% neq 0 (
    echo.
    echo   [!] El servicio se instalo pero no pudo iniciarse.
    echo       Revisa el log: %APP_DIR%\logs\wa-gateway.log
    echo       Puede que necesites autenticar la sesion primero (opcion 1).
) else (
    echo   [OK] Servicio iniciado.
    echo.
    echo  ============================================================
    echo     Instalacion completada.
    echo     Servicio: %SERVICE%
    echo     Log:      %APP_DIR%\logs\wa-gateway.log
    echo.
    echo     Ver log en tiempo real (PowerShell):
    echo     Get-Content %APP_DIR%\logs\wa-gateway.log -Wait
    echo  ============================================================
)

:FIN_INSTALAR
echo.
pause
goto MENU

:: ================================================================
:INICIAR
cls
echo.
echo   Iniciando servicio %SERVICE%...
echo.
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] NSSM no encontrado. Usa: node wa-server.js
    pause
    goto MENU
)
nssm start %SERVICE%
echo.
pause
goto MENU

:: ================================================================
:DETENER
cls
echo.
echo   Deteniendo servicio %SERVICE%...
echo.
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] NSSM no encontrado.
    echo       Para detener: taskkill /F /IM node.exe /T
    pause
    goto MENU
)
nssm stop %SERVICE%
echo.
pause
goto MENU

:: ================================================================
:REINICIAR
cls
echo.
echo   Reiniciando servicio %SERVICE%...
echo.
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] NSSM no encontrado. Reinicia el proceso manualmente.
    pause
    goto MENU
)
nssm restart %SERVICE%
echo.
pause
goto MENU

:: ================================================================
:TEST
cls
node wa-test.js
echo.
pause
goto MENU

:: ================================================================
:SALIR
exit /b 0
