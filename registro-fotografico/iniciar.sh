#!/bin/sh
# Abre un servidor local en http://localhost:8000 (Ctrl+C para detener)
cd "$(dirname "$0")" || exit 1
echo "Servidor local en http://localhost:8000  (Ctrl+C para detener)"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 8000
elif command -v python >/dev/null 2>&1; then
  python -m http.server 8000
else
  echo "No se encontro Python. Instala Python o usa la extension Live Server de VS Code."
fi
