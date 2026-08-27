@echo off
REM ---------------------------------------------------------------------
REM  Saca del proyecto los archivos que NO usa nadie.
REM  Doble clic.
REM
REM  No borra nada: los MUEVE a la carpeta _codigo-muerto\. Si algo se
REM  rompiera, estan ahi enteros para volver a ponerlos en su lugar.
REM
REM  Como se supo que no los usa nadie: se recorre el arbol de imports
REM  desde main.jsx y App.jsx. Lo que no aparece en ese recorrido no puede
REM  ejecutarse nunca. El test test\codigoMuerto.test.js hace lo mismo y
REM  falla si vuelve a aparecer un archivo huerfano.
REM
REM  Nota para quien lea el .bat: las subrutinas usan etiquetas y goto en
REM  vez de bloques con parentesis a proposito. En cmd, un parentesis
REM  suelto adentro de un bloque if corta el bloque antes de tiempo.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo ===============================================
echo   Limpieza de codigo muerto
echo ===============================================
echo.

if exist "package.json" goto :carpeta_ok
echo ERROR: este .bat tiene que estar en la carpeta mi-calendario.
echo Estas en: %CD%
pause
exit /b 1

:carpeta_ok
if not exist "_codigo-muerto" mkdir "_codigo-muerto"
set MOVIDOS=0

call :mover "src\components\screens\AppointmentCard.jsx"        "copia vieja de App.jsx, con los imports rotos"
call :mover "src\services\backupService.js"                     "segundo BackupService, formato incompatible"
call :mover "src\hooks\useAutoBackup.js"                        "llama a un metodo que no existe"
call :mover "src\components\screens\WhatsAppBotScreen.jsx"      "resto del bot de WhatsApp"
call :mover "src\components\screens\NewOrderScreen.jsx"         "pantalla que no esta enganchada"
call :mover "src\components\screens\BusinessSettingsScreen.jsx" "duplica SettingsScreen - ver aviso al final"
call :mover "src\components\common\ReminderSelector.jsx"        "sin uso"
call :mover "src\components\common\DateTimePicker.jsx"          "sin uso"
call :mover "src\utils\notification.js"                         "sin uso"
call :mover "src\utils\migrateToFirestore.js"                   "migracion de una sola vez, ya corrida"
call :mover "src\utils\dragDrop.js"                             "sin uso"
call :mover "src\scripts\updateVersion.js"                      "no lo llama ningun script de package.json"
call :mover "src\Splash.jsx"                                    "App.jsx define su propio Splash"

echo.
echo -----------------------------------------------
echo  Archivos movidos: %MOVIDOS%
echo -----------------------------------------------
echo.
echo Ahora se comprueba que no se haya roto nada.
echo.

call npm test
if errorlevel 1 goto :fallo

echo.
echo ===============================================
echo   Listo. Todo verde.
echo ===============================================
echo.
echo Los archivos quedaron en _codigo-muerto\.
echo Miralos si queres y despues borra esa carpeta a mano.
echo.
echo AVISO sobre BusinessSettingsScreen.jsx:
echo   No era basura. Es una pantalla de configuracion completa que
echo   nunca quedo enganchada al menu, o sea que nadie la pudo abrir
echo   nunca. Tiene un historial de cambios de configuracion que
echo   SettingsScreen no tiene. Si esa parte te sirve, decime y la
echo   conecto en vez de tirarla.
echo.
pause
exit /b 0

:fallo
echo.
echo ===============================================
echo   ALGO FALLO
echo ===============================================
echo.
echo Algun test no paso. Los archivos estan enteros en
echo _codigo-muerto\ : se pueden volver a su lugar.
echo.
pause
exit /b 1

REM --- subrutina: mover un archivo si existe ----------------------------
:mover
if not exist "%~1" goto :mover_no_estaba
move /y "%~1" "_codigo-muerto\" >nul
if errorlevel 1 goto :mover_error
set /a MOVIDOS+=1
echo   OK %~1
echo        %~2
goto :eof

:mover_no_estaba
echo   -- %~1   ya no estaba
goto :eof

:mover_error
echo   !! no se pudo mover %~1
goto :eof
