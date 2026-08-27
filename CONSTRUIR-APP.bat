@echo off
REM ---------------------------------------------------------------------
REM  Construye el instalador de ZenDay.
REM  Doble clic. Tarda varios minutos: es normal.
REM
REM  USA ESTE ARCHIVO, no "npm run build:exe" a mano.
REM
REM  El problema que resuelve, y que a mano vas a seguir teniendo:
REM
REM    remove ...\win-unpacked\resources\app.asar: El proceso no tiene
REM    acceso al archivo porque esta siendo utilizado por otro proceso.
REM
REM  Un build que murio por la mitad deja app.asar en 0 bytes con un
REM  handle abierto. electron-builder recien intenta borrarlo DESPUES
REM  de reconstruir las dependencias nativas -- varios minutos adentro --
REM  y ahi muere. El siguiente intento choca con el mismo archivo.
REM
REM  Este .bat prueba cuatro cosas, de menos a mas invasiva, y no se
REM  rinde hasta la ultima:
REM
REM    1. Borrar dist_electron entero.
REM    2. Cerrar ZenDay/electron si son ellos los que la tienen, y
REM       reintentar.
REM    3. Renombrar el archivo trabado y sacarlo del medio: Windows a
REM       veces deja RENOMBRAR lo que no deja borrar.
REM    4. Si nada de eso anda, compilar en OTRA carpeta. El archivo
REM       trabado deja de importar porque no lo tocamos.
REM
REM  Por eso no hace falta reiniciar Windows.
REM
REM  Nota: las ramas usan etiquetas y goto en vez de bloques con
REM  parentesis. En cmd, un parentesis suelto adentro de un bloque if
REM  lo corta antes de tiempo.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set SALIDA=dist_electron
set TRABADO=dist_electron\win-unpacked\resources\app.asar

echo.
echo  ===============================================================
echo   Construyendo ZenDay
echo  ===============================================================
echo.

REM --- 0. Estar en la carpeta correcta ---------------------------------
if exist "package.json" goto :carpeta_ok
echo   Este .bat no esta en la carpeta del proyecto.
echo   Tiene que quedar junto a package.json.
echo.
pause
exit /b 1

:carpeta_ok
where npm >nul 2>nul
if not errorlevel 1 goto :npm_ok
echo   No se encontro npm. Instala Node.js desde https://nodejs.org
echo.
pause
exit /b 1

:npm_ok
REM  usebackq + backticks: el comando lleva comillas simples adentro y
REM  con el for /f normal ('...') cmd las toma como fin del comando.
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set VERSION=%%V
if "%VERSION%"=="" goto :sin_version
echo   Version a construir: %VERSION%
echo.

REM --- 1. Dejar libre la carpeta de salida ------------------------------
echo   [1/3] Limpiando compilaciones anteriores...
if not exist "dist_electron" goto :limpio
rmdir /s /q "dist_electron" >nul 2>nul
if not exist "dist_electron" goto :limpio

REM  Intento 2: cerrar la app y el motor, que son los sospechosos.
echo.
echo         No se pudo borrar. Buscando quien la tiene tomada...
echo.
set HAYALGO=
tasklist /FI "IMAGENAME eq ZenDay.exe"   2>nul | find /I "ZenDay.exe"   >nul && set HAYALGO=1 && echo           - ZenDay.exe esta corriendo
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul && set HAYALGO=1 && echo           - electron.exe esta corriendo
if not defined HAYALGO echo           - no es ZenDay ni electron
echo.
if not defined HAYALGO goto :probar_rename
choice /C SN /M "   Cerrarlos y reintentar"
if errorlevel 2 goto :probar_rename
taskkill /F /IM ZenDay.exe /T   >nul 2>nul
taskkill /F /IM electron.exe /T >nul 2>nul
REM  Windows tarda un instante en soltar los handles despues del kill.
timeout /t 3 /nobreak >nul
rmdir /s /q "dist_electron" >nul 2>nul
if not exist "dist_electron" goto :destrabado

:probar_rename
REM  Intento 3: Windows a veces deja RENOMBRAR un archivo que no deja
REM  borrar. Si sale, el nombre queda libre y el resto se borra.
echo         Probando sacar el archivo trabado del medio...
if exist "%TRABADO%" ren "%TRABADO%" "app.asar.trabado-%RANDOM%" >nul 2>nul
rmdir /s /q "dist_electron" >nul 2>nul
if not exist "dist_electron" goto :destrabado

REM  Intento 4: no la tocamos mas. Compilamos en otra carpeta.
set SALIDA=dist_electron_%RANDOM%
echo.
echo         La carpeta sigue trabada. No importa: se compila en otra.
echo         Salida: %SALIDA%
echo.
goto :compilar_setup

:destrabado
echo         Destrabado.

:limpio
echo         ok
echo.

:compilar_setup
set EXE=%SALIDA%\ZenDay-Setup-%VERSION%.exe

REM --- 2. Los tests ------------------------------------------------------
echo   [2/3] Corriendo los tests...
echo.
call npm test
if errorlevel 1 goto :tests_rojos
goto :compilar

:tests_rojos
echo.
echo   ===============================================================
echo    HAY TESTS QUE FALLAN
echo   ===============================================================
echo.
echo    Si arriba dice "codigoMuerto", es que todavia no corriste
echo    LIMPIAR-CODIGO-MUERTO.bat. Cerra esto, corre ese, y volve.
echo.
echo    Si dice otra cosa, mandale la salida de arriba a Claude.
echo.
choice /C SN /M "   Compilar igual"
if errorlevel 2 exit /b 1

:compilar
REM --- 3. Compilar ------------------------------------------------------
REM  Se hace en dos pasos en vez de "npm run dist" para poder decirle a
REM  electron-builder en que carpeta escribir (-c.directories.output).
echo.
echo   [3/3] Compilando ^(esto tarda varios minutos^)...
echo.
call npm run build
if errorlevel 1 goto :fallo_build
call npx electron-builder --win -c.directories.output=%SALIDA%
if errorlevel 1 goto :fallo_build

REM --- 4. Que el resultado exista y sirva -------------------------------
if not exist "%EXE%" goto :sin_exe

REM  %%~zA se evalua al ejecutar el for. Guardarlo en una variable y
REM  releerla no funciona adentro de un bloque: cmd expande esas
REM  variables cuando LEE el archivo, no cuando lo corre.
for %%A in ("%EXE%") do if %%~zA LSS 50000000 goto :exe_chico

echo.
echo  ===============================================================
echo   Listo
echo  ===============================================================
echo.
echo   Se genero:
echo.
echo      %EXE%
echo.
echo   Ese es el archivo que le mandas al cliente, junto con el
echo   texto de PARA-EL-CLIENTE.txt
echo.
if /I not "%SALIDA%"=="dist_electron" echo   OJO: quedo en %SALIDA%, no en dist_electron, porque esa
if /I not "%SALIDA%"=="dist_electron" echo   estaba trabada. Cuando reinicies Windows vas a poder borrar
if /I not "%SALIDA%"=="dist_electron" echo   la vieja a mano. No molesta mientras tanto.
if /I not "%SALIDA%"=="dist_electron" echo.
echo   Abriendo la carpeta...
start "" "%SALIDA%"
echo.
pause
exit /b 0


REM ------------------------------------------------------------------
:sin_version
echo   No se pudo leer la version de package.json.
echo   Fijate que el archivo no este roto.
echo.
pause
exit /b 1


REM ------------------------------------------------------------------
:fallo_build
echo.
echo   ===============================================================
echo    LA COMPILACION FALLO
echo   ===============================================================
echo.
echo    Copia el error de arriba y mandaselo a Claude.
echo.
pause
exit /b 1


REM ------------------------------------------------------------------
:sin_exe
echo.
echo   ===============================================================
echo    NO APARECIO EL INSTALADOR
echo   ===============================================================
echo.
echo    La compilacion dijo que termino bien, pero no existe:
echo       %EXE%
echo.
echo    Mira que hay adentro de %SALIDA% y mandaselo a Claude.
echo.
pause
exit /b 1


REM ------------------------------------------------------------------
:exe_chico
echo.
echo   ===============================================================
echo    EL INSTALADOR QUEDO INCOMPLETO
echo   ===============================================================
echo.
echo    %EXE% existe pero pesa mucho menos de lo normal
echo    (tendria que rondar los 110 MB). Quedo a medio escribir.
echo.
echo    Cerra todo, incluido VS Code, y volve a correr este archivo.
echo.
pause
exit /b 1
