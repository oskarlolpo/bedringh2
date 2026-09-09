#!/bin/bash
set -e

echo "=== Развертывание Bedringh Auth Server на Ubuntu ==="

# 1. Проверка и установка Node.js
if ! command -v node &> /dev/null; then
    echo ">>> Установка Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js версия: $(node -v)"
echo "npm версия: $(npm -v)"

# 2. Установка зависимостей сборки (для SQLite)
sudo apt-get update
sudo apt-get install -y build-essential python3 nginx certbot python3-certbot-nginx

# 3. Установка зависимостей проекта и сборка
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ">>> Установка npm зависимостей..."
npm install

echo ">>> Компиляция TypeScript..."
npm run build

# 4. Настройка systemd сервиса
SERVICE_FILE="/etc/systemd/system/bedringh-auth.service"
echo ">>> Создание systemd сервиса в $SERVICE_FILE..."

sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=Bedringh Launcher Auth Service and Telegram Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$(which node) $DIR/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl enable bedringh-auth
sudo systemctl restart bedringh-auth

echo ">>> Статус сервиса bedringh-auth:"
sudo systemctl status bedringh-auth --no-pager

# 5. Настройка Nginx
DOMAIN="oskarlolpo.play2go.cloud"
NGINX_CONF="/etc/nginx/sites-available/bedringh"

echo ">>> Настройка Nginx для $DOMAIN..."
sudo bash -c "cat <<EOF > $NGINX_CONF
server {
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
    }
}
EOF"

sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 6. Получение SSL сертификата через Certbot
echo ">>> Получение бесплатного HTTPS сертификата для $DOMAIN..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || echo "Внимание: Проверьте, направлен ли домен на IP сервера."

echo "=== Готово! Сервер авторизации Bedringh успешно запущен и работает! ==="
