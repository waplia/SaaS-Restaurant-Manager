#!/bin/bash
set -e
pnpm install --frozen-lockfile --prefer-offline --silent
pnpm --filter @workspace/db exec node ../../scripts/apply-migrations.mjs || echo "[post-merge] migration apply step reported an error (continuing)"
