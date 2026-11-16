#!/usr/bin/env bash
# One-command install on a fresh Ubuntu 22.04 / 24.04 (or Debian 12) VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/rutvikj37/Clientinvoice-/main/deploy/setup-vps.sh -o setup.sh
#   sudo DOMAIN=invoice.example.com EMAIL=you@example.com bash setup.sh
#
# Variables (all optional):
#   DOMAIN        domain pointing to this VPS (A record). Without it the app runs on http://<server-ip>
#   EMAIL         email for the free Let's Encrypt HTTPS certificate (needed with DOMAIN)
#   REPO          git URL (default: this project's GitHub repo)
#   BRANCH        default main
#   GITHUB_TOKEN  only if the repo is private (fine-grained token with read access to this repo)
#   PORT          internal app port, default 4000
#   SEED_DEMO=1   load demo data (admin@motioncrest.test / demo123), for testing only
set -euo pipefail

REPO="${REPO:-https://github.com/rutvikj37/Clientinvoice-.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4000}"
APP_USER=clientinvoice
APP_DIR=/opt/clientinvoice
DATA_DIR=/var/lib/clientinvoice
BACKUP_DIR=/var/backups/clientinvoice
SERVICE=clientinvoice

log() { echo -e "\n\033[1;34m==> $*\033[0m"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
if [ -n "${DOMAIN:-}" ] && [ -z "${EMAIL:-}" ]; then echo "Set EMAIL=you@example.com together with DOMAIN (for the HTTPS certificate)"; exit 1; fi

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx build-essential python3 sqlite3 ufw ca-certificates gnupg

# The app needs Node 24+. If the system Node is older, install a private copy under /opt/node24
# instead of upgrading the system one, so other apps on the same server are not affected.
NODE_DIR=/opt/node24
SYS_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${SYS_MAJOR:-0}" -ge 24 ]; then
  NODE_BIN_DIR=$(dirname "$(command -v node)")
else
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    log "Installing private Node.js 24 in $NODE_DIR (system Node left untouched)"
    case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
    NODE_VER=$(curl -fsS https://nodejs.org/dist/index.json | python3 -c 'import json,sys; print([v["version"] for v in json.load(sys.stdin) if v["version"].startswith("v24.")][0])')
    mkdir -p "$NODE_DIR"
    curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$ARCH.tar.xz" | tar -xJ -C "$NODE_DIR" --strip-components=1
  fi
  NODE_BIN_DIR="$NODE_DIR/bin"
fi
export PATH="$NODE_BIN_DIR:$PATH"
node -v

log "Creating app user and folders"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$APP_USER --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

log "Getting the code ($BRANCH)"
CLONE_URL="$REPO"
if [ -n "${GITHUB_TOKEN:-}" ]; then CLONE_URL="${REPO/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"; fi
if [ -d "$APP_DIR/.git" ]; then
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" fetch "$CLONE_URL" "$BRANCH" && git -c safe.directory="$APP_DIR" -C "$APP_DIR" reset --hard FETCH_HEAD
else
  rm -rf "$APP_DIR" && git clone --branch "$BRANCH" "$CLONE_URL" "$APP_DIR"
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" remote set-url origin "$REPO"   # never keep the token on disk
fi

log "Configuring server/.env"
ENV_FILE="$APP_DIR/server/.env"
if [ -n "${DOMAIN:-}" ]; then PUBLIC_URL="https://$DOMAIN"; else PUBLIC_URL="http://$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"; fi
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=$PORT
HOST=127.0.0.1
JWT_SECRET=$(openssl rand -hex 32)
PUBLIC_URL=$PUBLIC_URL
DATA_DIR=$DATA_DIR
ENV
else
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$PUBLIC_URL#" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

log "Installing dependencies and building the web app"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
sudo -u "$APP_USER" -H env PATH="$PATH" bash -c "cd '$APP_DIR/server' && npm ci --omit=dev --no-audit --no-fund"
sudo -u "$APP_USER" -H env PATH="$PATH" bash -c "cd '$APP_DIR/client' && npm ci --no-audit --no-fund && npm run build"
if [ "${SEED_DEMO:-0}" = "1" ]; then sudo -u "$APP_USER" -H env PATH="$PATH" bash -c "cd '$APP_DIR/server' && node src/seed.js"; fi

log "Creating systemd service"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Client Invoice (invoicing, PO, inventory)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN_DIR/node src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now $SERVICE
systemctl restart $SERVICE

log "Configuring Nginx"
cat > /etc/nginx/sites-available/$SERVICE <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};
    client_max_body_size 25m;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
[ -z "${DOMAIN:-}" ] && rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Only turn the firewall on for a fresh server; on a shared server it could block other apps' ports.
if [ "${SKIP_FIREWALL:-0}" != "1" ] && ! ufw status | grep -q "Status: active"; then
  OTHER_SITES=$(ls /etc/nginx/sites-enabled | grep -vE "^($SERVICE|default)$" || true)
  if [ -z "$OTHER_SITES" ]; then
    log "Firewall: allowing SSH, HTTP, HTTPS"
    ufw allow OpenSSH >/dev/null
    ufw allow 'Nginx Full' >/dev/null
    ufw --force enable >/dev/null
  else
    log "Other sites found on this server, leaving the firewall as it is"
  fi
fi

if [ -n "${DOMAIN:-}" ]; then
  log "Getting free HTTPS certificate for $DOMAIN"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
    echo "!! Certificate failed. Check that $DOMAIN's DNS A record points to this server, then run: certbot --nginx -d $DOMAIN"
fi

log "Daily database backup (02:30, keeps 14 days)"
cat > /etc/cron.daily/clientinvoice-backup <<'CRON'
#!/bin/sh
set -e
TS=$(date +%F)
sqlite3 /var/lib/clientinvoice/app.db ".backup '/var/backups/clientinvoice/app-$TS.db'"
tar -czf /var/backups/clientinvoice/uploads-$TS.tgz -C /var/lib/clientinvoice uploads
find /var/backups/clientinvoice -type f -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/clientinvoice-backup

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo -e "\n\033[1;32m✔ Live at $PUBLIC_URL\033[0m"
  echo "  Open it and click 'Create an account' to make the first admin (sign-up closes after that)."
  echo "  Logs:    journalctl -u $SERVICE -f"
  echo "  Update:  sudo bash $APP_DIR/deploy/update.sh"
else
  echo "!! App did not start. See: journalctl -u $SERVICE -n 50"; exit 1
fi
