@echo off
cd /d "%~dp0"
echo Servidor local en http://localhost:8000  (Ctrl+C para detener)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8000
  py -m http.server 8000
  goto fin
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8000
  python -m http.server 8000
  goto fin
)
echo No se encontro Python. Instala Python o usa la extension "Live Server" de Visual Studio Code.
:fin
pause
