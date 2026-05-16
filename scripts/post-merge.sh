#!/bin/bash
set -e
pnpm install --frozen-lockfile --prefer-offline --silent
timeout 15 pnpm --filter db push --force 2>&1 | tail -5 || echo "drizzle push skipped/timed out (schema likely already in sync)"
