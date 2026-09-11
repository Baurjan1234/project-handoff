#!/usr/bin/env bash
# Update the docs site. Run on the server, from the repo root:
#   sudo bash apps/docs/deploy/update.sh
set -euo pipefail

ROOT="/var/www/docs.the-handoff.xyz"

git pull
cp apps/docs/public/*.html "$ROOT/"
chown -R www-data:www-data "$ROOT"

curl -sS -o /dev/null -w 'https://docs.the-handoff.xyz/ -> %{http_code}\n' \
     https://docs.the-handoff.xyz/
