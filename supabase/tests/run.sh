#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh   (needs a scratch database)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-isp_test}"
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f tests/00_bootstrap_local.sql 2>/dev/null || true
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/01_behavior.sql 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED" 
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/02_subscriptions_balance.sql 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED"
