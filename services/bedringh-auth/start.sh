#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Запуск Bedringh Auth Server (без sudo) ==="

# Завершаем старый процесс, если был запущен
pkill -f "dist/index.js" || true

npm run build

nohup node dist/index.js > server.log 2>&1 &
PID=$!
echo "[Bedringh Auth] Сервер запускается в фоне (PID: $PID)..."
sleep 2

if ps -p $PID > /dev/null; then
  echo "[Bedringh Auth] Процесс активен (PID: $PID)!"
else
  echo "[Bedringh Auth] Внимание: процесс завершился с ошибкой! Проверьте логи ниже:"
fi

echo "--- Последние строки server.log ---"
tail -n 20 server.log

