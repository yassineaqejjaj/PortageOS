#!/usr/bin/env bash
# Active la connexion du rôle applicatif (mot de passe fourni par env, jamais commité).
set -euo pipefail
: "${DATABASE_URL:?}"; : "${APP_DB_PASSWORD:?}"
psql "$DATABASE_URL" -v pw="$APP_DB_PASSWORD" -c "ALTER ROLE portage_app LOGIN PASSWORD :'pw'"
