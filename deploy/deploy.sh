#!/usr/bin/env bash
# Weatherwise: deploy to ONE web server (run it on Web01, then again on Web02).
#
# Usage, on the server:
#   sudo bash deploy.sh https://github.com/<your-username>/<your-repo>.git
#
# What it does:
#   1. installs Nginx, Git and Node.js 20 if they are missing
#   2. clones the repository into /var/www/weatherwise (or pulls the latest version)
#   3. installs the server's npm dependencies
#   4. creates .env from .env.example if there is none (this is where an API key goes)
#   5. installs the "weatherwise" init script and starts it with "service"
#      (these servers have no systemd, so everything is managed with "service")
#   6. installs the Nginx site that forwards port 80 to Express, and reloads Nginx
#
# Safe to run again: re-running it updates the app to the newest commit.

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

# Node.js 18 or newer is required (the server uses the built-in fetch).
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
chmod 600 "$APP_DIR/.env"   # only the service user may read the secrets

echo "==> Installing and starting the weatherwise service"
cp "$APP_DIR/deploy/weatherwise.init" /etc/init.d/weatherwise
chmod 755 /etc/init.d/weatherwise
# Register it to start at boot where the machine has a normal init. Harmless if not.
update-rc.d weatherwise defaults >/dev/null 2>&1 || true
service weatherwise restart

echo "==> Installing the Nginx site"
cp "$APP_DIR/deploy/nginx/weatherwise.conf" "/etc/nginx/sites-available/$SITE"
ln -sf "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"

# Only one site can be the default on port 80. The stock "default" site is only
# switched off (its file in sites-available is kept). To bring it back:
#   sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
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
