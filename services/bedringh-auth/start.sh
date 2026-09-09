#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Запуск Bedringh Auth Server (без sudo) ==="

# Завершаем старый процесс, если был запущен
pkill -f "dist/index.js" || true

npm run build

nohup node dist/index.js > server.log 2>&1 &
PID=$!

echo "🚀 Сервер и Telegram-бот запущены в фоне! (PID: $PID)"
echo "Ждем 2 секунды для проверки логов..."
sleep 2

tail -n 15 server.log
