@echo off
REM ---------------------------------------------------------------------
REM  Genera la clave de licencia para ESTA computadora.
REM  Doble clic y listo: no hay que abrir ninguna terminal ni escribir nada.
REM
REM  Da una clave ZENDAY-XXXX-XXXX-XXXX-XXXX, que es la que funciona hoy.
REM  (Las claves ZD- son del sistema nuevo y necesitan el servidor.)
REM ---------------------------------------------------------------------

REM UTF-8, si no los acentos salen como simbolos raros
chcp 65001 >nul 2>nul

REM Pararse en la carpeta de este archivo, sin importar desde donde se abra
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  =====================================================
  echo   No se encontro Node.js en esta computadora.
  echo  =====================================================
  echo.
  echo   Instalalo desde https://nodejs.org
  echo   Despues cerra esta ventana y volve a hacer doble clic.
  echo.
  pause
  exit /b 1
)

if not exist "electron\generateLicense.cjs" (
  echo.
  echo  =====================================================
  echo   Este .bat no esta en la carpeta del proyecto.
  echo  =====================================================
  echo.
  echo   Tiene que quedar en la misma carpeta donde estan
  echo   electron\ y functions\  ^(C:\Users\franc\mi-calendario^)
  echo.
  pause
  exit /b 1
)

node electron\generateLicense.cjs

echo.
echo  ---------------------------------------------------------------
echo   Copia la linea que dice CLAVE: y pegala en ZenDay.
echo   Para copiar: seleccionala con el mouse y apreta Enter.
echo  ---------------------------------------------------------------
echo.
pause
