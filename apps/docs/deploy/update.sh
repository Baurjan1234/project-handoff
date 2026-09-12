#!/usr/bin/env bash
# Update the docs site. Run on the server, from anywhere in the checkout:
#   sudo bash apps/docs/deploy/update.sh
set -euo pipefail

ROOT="/var/www/docs.the-handoff.xyz"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

git -C "$REPO" checkout main
git -C "$REPO" pull --ff-only
cp "$REPO"/apps/docs/public/*.html "$ROOT/"
chown -R www-data:www-data "$ROOT"

curl -sS -o /dev/null -w 'https://docs.the-handoff.xyz/ -> %{http_code}\n' \
     https://docs.the-handoff.xyz/
