#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="/var/www/weatherwise"
SITE="weatherwise"

if [ -z "$REPO_URL" ]; then
  echo "Usage: sudo bash deploy.sh <git-repository-url>" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo." >&2
  exit 1
fi

echo "==> Installing Nginx, Git and curl"
apt-get update -y
apt-get install -y nginx git curl ca-certificates

NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node -v)"

echo "==> Fetching the application into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Installing npm dependencies"
cd "$APP_DIR"
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating .env from .env.example (edit it to add an API key)"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi
chown -R www-data:www-data "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> Installing and starting the weatherwise service"
cp "$APP_DIR/deploy/weatherwise.init" /etc/init.d/weatherwise
chmod 755 /etc/init.d/weatherwise
update-rc.d weatherwise defaults >/dev/null 2>&1 || true
service weatherwise restart

echo "==> Installing the Nginx site"
cp "$APP_DIR/deploy/nginx/weatherwise.conf" "/etc/nginx/sites-available/$SITE"
ln -sf "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"

if [ -e /etc/nginx/sites-enabled/default ]; then
  echo "    Disabling the stock 'default' site (kept in sites-available)"
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
service nginx restart

echo "==> Done. Quick check from this server:"
sleep 2
curl -s http://localhost/api/health || true
echo
curl -sI http://localhost/ | grep -iE "^HTTP|x-served-by" || true
