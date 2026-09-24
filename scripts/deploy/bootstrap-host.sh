#!/usr/bin/env bash
# One-command preparation of a fresh deployment host.
#
#   APP_DOMAIN=app.example.com bash scripts/deploy/bootstrap-host.sh
#
# Idempotent: re-running it leaves an existing checkout and .env untouched.
# Everything after this is the pipeline's job (push to `production`).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kc-cb-digital-base}"
REPO_URL="${REPO_URL:-https://github.com/KcDevVanness/kc-cb-digital-base-main.git}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-4096}"
# Caddy requests a certificate for this exact name and Let's Encrypt will not
# issue for a bare IP, so there is no usable default.
APP_DOMAIN="${APP_DOMAIN:?set APP_DOMAIN to the public hostname, e.g. app.example.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-superadmin@kc-cb-digital.com}"

log() { printf '\n=== %s ===\n' "$*"; }

log "swap (${SWAP_SIZE_MB} MB)"
if swapon --show | grep -q '/swapfile'; then
  echo "swapfile already active"
else
  if [ ! -f /swapfile ]; then
    # fallocate leaves holes swapon rejects on some filesystems; dd is safe everywhere.
    sudo dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE_MB}" status=none
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
  fi
  sudo swapon /swapfile
  echo "swapfile enabled"
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
# Prefer RAM; fall back to swap only under real pressure.
sudo sysctl -w vm.swappiness=10 >/dev/null
printf 'vm.swappiness=10\n' | sudo tee /etc/sysctl.d/99-kc-swap.conf >/dev/null

log "docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker --version
  docker compose version
else
  # Ubuntu 26.04 (resolute) ships no docker.io at all, so this uses Docker's own
  # apt repository, pinned to the detected codename (which it publishes).
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

log "checkout ${APP_DIR}"
sudo mkdir -p "${APP_DIR}"
sudo chown "${USER}:${USER}" "${APP_DIR}"
if [ -d "${APP_DIR}/.git" ]; then
  echo "repository already cloned; leaving the working tree to the pipeline"
else
  git clone "${REPO_URL}" "${APP_DIR}"
fi

log "environment file"
cd "${APP_DIR}"
if [ -f .env ]; then
  echo ".env already exists; leaving it alone (change the domain with set-domain.sh)"
else
  # Secrets are generated here and never leave the host.
  rand() { openssl rand -hex "${1:-32}"; }
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

  umask 077
  cat > .env <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) on this host. NOT in git.
# Rotating a value takes effect on the next \`docker compose up -d\`.

DEPLOY_ENV=production
# Caddy owns 80/443 and terminates TLS; the app binds loopback only.
APP_DOMAIN=${APP_DOMAIN}
APP_PORT=3000
# Must match the real public origin: the framework sets Secure cookies in
# production, so a browser only holds a session over https.
APP_URL=https://${APP_DOMAIN}

POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(rand 24)
POSTGRES_DB=open-mercato

# Session signing. Production startup exits 1 on a placeholder or short value.
JWT_SECRET=$(rand 32)
AUTH_SECRET=$(rand 32)
NEXTAUTH_SECRET=$(rand 32)

# Tenant field encryption + lookup-hash pepper. Losing these makes existing
# encrypted columns unreadable, so back this file up before rotating.
TENANT_DATA_ENCRYPTION=yes
TENANT_DATA_ENCRYPTION_FALLBACK_KEY=$(rand 32)
LOOKUP_HASH_PEPPER=$(rand 32)

MEILISEARCH_MASTER_KEY=$(rand 32)

DEMO_MODE=false
SELF_SERVICE_ONBOARDING_ENABLED=false

ADMIN_EMAIL=${ADMIN_EMAIL}
OM_INIT_SUPERADMIN_EMAIL=${ADMIN_EMAIL}
OM_INIT_SUPERADMIN_PASSWORD=${ADMIN_PASSWORD}

# Small instance: keep V8, the pg pool and redis proportional to real RAM.
# Raise these together with the instance size.
NODE_OPTIONS=--max-old-space-size=1024
DB_POOL_MAX=5
REDIS_MAXMEMORY=128mb
EOF
  chmod 600 .env

  cat > .admin-credentials <<EOF
Superadmin created by the first initialization:
  email:    ${ADMIN_EMAIL}
  password: ${ADMIN_PASSWORD}
Change the password after the first login.
EOF
  chmod 600 .admin-credentials
  echo "wrote .env and .admin-credentials (mode 600)"
fi

log "result"
docker --version
docker compose version
swapon --show
free -m | head -2
df -h / | tail -1
git -C "${APP_DIR}" log --oneline -1
echo
echo "Next: add DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY as repository secrets,"
echo "then push to the production branch. See docs/deploy/cicd.md."
