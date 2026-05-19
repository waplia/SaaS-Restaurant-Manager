#!/bin/bash
set -e

# Install dependencies (allow lockfile updates from merges; fall back to offline cache when possible).
pnpm install --prefer-offline --silent --config.confirmModulesPurge=false

# Apply any new raw SQL migrations (idempotent).
node scripts/apply-migrations.mjs || echo "[post-merge] apply-migrations reported an error (continuing)"

# Sync any schema-defined tables/columns the SQL migrations missed.
TSX_CLI=$(ls node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs 2>/dev/null | head -1)
if [ -n "$TSX_CLI" ] && [ -f "lib/db/sync-schema.mjs" ]; then
  (cd lib/db && node "../../$TSX_CLI" sync-schema.mjs) || echo "[post-merge] schema sync reported an error (continuing)"
fi
