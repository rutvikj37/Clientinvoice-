#!/usr/bin/env bash
# Pull the latest code from GitHub, rebuild and restart:  sudo bash /opt/clientinvoice/deploy/update.sh
# Private repo: sudo GITHUB_TOKEN=... bash /opt/clientinvoice/deploy/update.sh
set -euo pipefail
[ -x /opt/node24/bin/node ] && export PATH="/opt/node24/bin:$PATH"
APP_DIR=/opt/clientinvoice; APP_USER=clientinvoice; BRANCH="${BRANCH:-main}"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
REPO=$(git -c safe.directory="$APP_DIR" -C "$APP_DIR" remote get-url origin)
URL="$REPO"; [ -n "${GITHUB_TOKEN:-}" ] && URL="${REPO/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"
echo "==> Backing up database"; /etc/cron.daily/clientinvoice-backup || true
echo "==> Pulling $BRANCH"; git -c safe.directory="$APP_DIR" -C "$APP_DIR" fetch "$URL" "$BRANCH" && git -c safe.directory="$APP_DIR" -C "$APP_DIR" reset --hard FETCH_HEAD
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
echo "==> Installing & building"
sudo -u "$APP_USER" -H env PATH="$PATH" bash -c "cd '$APP_DIR/server' && npm ci --omit=dev --no-audit --no-fund"
sudo -u "$APP_USER" -H env PATH="$PATH" bash -c "cd '$APP_DIR/client' && npm ci --no-audit --no-fund && npm run build"
systemctl restart clientinvoice
sleep 2 && curl -fsS http://127.0.0.1:${PORT:-4000}/api/health >/dev/null && echo "✔ Updated and running" || { echo "!! Not healthy: journalctl -u clientinvoice -n 50"; exit 1; }
