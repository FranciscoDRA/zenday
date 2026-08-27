@echo off
REM ---------------------------------------------------------------------
REM  Termina de sacar el bot de WhatsApp.
REM
REM  El codigo que lo llamaba ya se saco de main.cjs, preload.cjs, App.jsx,
REM  Sidebar.jsx y BackupManager.jsx. Faltan dos cosas que solo se pueden
REM  hacer desde tu maquina:
REM
REM    1. apartar los dos archivos del bot
REM    2. desinstalar baileys y qrcode
REM
REM  Los archivos NO se borran: se mueven a _eliminado-whatsapp\, asi que
REM  si algo sale mal los volves a poner en su lugar sin depender de git.
REM ---------------------------------------------------------------------

chcp 65001 >nul 2>nul
cd /d "%~dp0"

if not exist "package.json" (
  echo   Este .bat no esta en la carpeta del proyecto.
  echo.
  pause
  exit /b 1
)

echo.
echo  ===============================================================
echo   Sacando el bot de WhatsApp
echo  ===============================================================
echo.

if not exist "_eliminado-whatsapp\src\components\screens" mkdir "_eliminado-whatsapp\src\components\screens"
if not exist "_eliminado-whatsapp\electron" mkdir "_eliminado-whatsapp\electron"

echo   [1/3] Apartando los archivos del bot...

if exist "electron\whatsappBot.cjs" (
  move /Y "electron\whatsappBot.cjs" "_eliminado-whatsapp\electron\" >nul
  echo         electron\whatsappBot.cjs                      movido
) else (
  echo         electron\whatsappBot.cjs                      ya no estaba
)

if exist "src\components\screens\WhatsAppBotScreen.jsx" (
  move /Y "src\components\screens\WhatsAppBotScreen.jsx" "_eliminado-whatsapp\src\components\screens\" >nul
  echo         src\...\WhatsAppBotScreen.jsx                 movido
) else (
  echo         src\...\WhatsAppBotScreen.jsx                 ya no estaba
)

echo.
echo   [2/3] Desinstalando baileys y qrcode ^(tarda un poco^)...
echo.
call npm uninstall @whiskeysockets/baileys qrcode
if errorlevel 1 (
  echo.
  echo   No se pudieron desinstalar. Cerra VS Code y volve a probar,
  echo   o corre a mano:  npm uninstall @whiskeysockets/baileys qrcode
  echo.
  pause
  exit /b 1
)

echo.
echo   [3/3] Corriendo los tests...
echo.
call npm test
if errorlevel 1 (
  echo.
  echo   Hay tests que fallan. Mandale la salida de arriba a Claude.
  echo.
  pause
  exit /b 1
)

echo.
echo  ===============================================================
echo   Listo
echo  ===============================================================
echo.
echo   El bot ya no arranca ni existe en el proyecto.
echo   Lo que SI sigue andando: los botones que abren WhatsApp con el
echo   mensaje escrito ^(wa.me^). Eso nunca fue el bot y no daba fallas.
echo.
echo   Los archivos viejos quedaron en  _eliminado-whatsapp\
echo   Borra esa carpeta a mano cuando estes seguro.
echo.
echo   Ahora corre CONSTRUIR-APP.bat para el instalador nuevo.
echo   Deberia bajar de 113 MB a alrededor de 70 MB.
echo.
pause
