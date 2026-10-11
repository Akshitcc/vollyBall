#!/bin/sh
# Launch prep: container start = run pending migrations (under a MySQL named lock, so several
# instances can start at once), then the API. Set MIGRATE_ON_DEPLOY=0 to skip (e.g. when the platform
# runs `node dist/server/src/db/migrate-cli.js` as a separate release/pre-deploy step).
set -e
if [ "${MIGRATE_ON_DEPLOY:-1}" = "1" ]; then
  node dist/server/src/db/migrate-cli.js
fi
exec node dist/server/src/index.js
